import { describe, expect, it } from 'vitest'
import { annuityPayment, canAfford, goalPace, inSalaries, monthPlan, paceMonths, tryCredit, untilPayday, type MonthPlanCtx, type MonthPlanState } from './finance'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Goal, SyncDoc } from '@/types/finance'

/**
 * PN-16 (понятность Р-11): «Прикинуть кредит» и «Хватит?» против плана месяца и ручного расчёта (правило 6 — числа
 * в комментариях). Семья `planFamilyDoc`, сентябрь 2026: доход 1 200 000; платежи — аренда 220 000, кредит 58 000,
 * кредитка 25 000, рассрочка 20 000 = 323 000; на карте 2 000 000.
 */

const KEY = '2026-09'
const ctx: MonthPlanCtx = { key: KEY, totals: [], spendCategories: [], uploads: [] }
const family = (extra: Partial<SyncDoc> = {}): MonthPlanState & SyncDoc => planFamilyDoc(extra)

/**
 * Маленькая семья для ручного прогона очереди: доход 300 000, платежей нет, одна мечта 300 000 с нуля, взнос
 * 100 000 в месяц → собрана в третий месяц (сентябрь, октябрь, ноябрь → «2026-11»).
 */
const dream = (p: Partial<Goal> = {}): Goal => ({
  id: 'trip', name: 'Япония', need: 300_000, seed: 0, have: 0, monthly: 100_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...p,
})
const small = (extra: Partial<SyncDoc> = {}): MonthPlanState & SyncDoc => ({
  ...planFamilyDoc(),
  people: [{ id: 'a', name: 'Ильяс', salary: 300_000, payday: 10, updatedAt: T0 }],
  obligations: [],
  credits: [],
  accounts: [],
  goals: [dream()],
  ...extra,
})

describe('tryCredit — «Прикинуть кредит»', () => {
  it('1 000 000 на 24 месяца под 20 %: платёж — аннуитет вверх до тенге, нагрузка растёт, переплата и зарплаты', () => {
    const state = family()
    const r = tryCredit(state, ctx, { principal: 1_000_000, months: 24, annualRate: 0.2 })
    // Аннуитет 1 000 000 · 20 %/12 на 24 мес. = 50 895,8… → 50 896.
    expect(r.payment).toBe(Math.ceil(annuityPayment(1_000_000, 0.2, 24)))
    expect(r.payment).toBe(50_896)
    // Сейчас 323 000 / 1 200 000 = 26,9 % → 27; с кредитом 373 896 / 1 200 000 = 31,2 % → 31.
    expect(r.loadNowPct).toBe(27)
    expect(r.loadPct).toBe(31)
    expect(r.loadPct!).toBeGreaterThan(r.loadNowPct!)
    // 50 896 × 24 − 1 000 000 = 221 504; в зарплатах 221 504 / 1 200 000 = 0,18… → 0,2.
    expect(r.overpay).toBe(r.payment * 24 - 1_000_000)
    expect(r.overpay).toBe(221_504)
    expect(r.overpaySalaries).toBe(inSalaries(221_504, 1_200_000))
    expect(r.overpaySalaries).toBe(0.2)
    for (const n of [r.payment, r.loadNowPct, r.loadPct, r.overpay]) expect(Number.isInteger(n)).toBe(true)
  })

  it('рассрочка 0 %: платёж — вверх до тенге, переплаты нет', () => {
    const r = tryCredit(family(), ctx, { principal: 1_000_000, months: 3, annualRate: 0 })
    // 1 000 000 / 3 = 333 333,3… → 333 334; ×3 = 1 000 002, но рассрочка — без переплаты.
    expect(r.payment).toBe(333_334)
    expect(r.overpay).toBe(0)
    expect(r.overpaySalaries).toBe(0)
  })

  it('герой: сдвиг — тот же план с кредитом; маленькая семья — руками', () => {
    const state = small()
    // Без кредита: 100 000 в месяц → 300 000 к «2026-11».
    // Рассрочка 1 000 000 на 4 месяца — платёж 250 000 с сентября по декабрь: свободно 50 000 → 4 × 50 000 = 200 000;
    // в январе платежа уже нет — взнос снова 100 000 → 300 000 → «2027-01», на 2 месяца позже (критик Б5: без конца
    // платежа выходило «2027-02» — кредит платился бы вечно).
    const r = tryCredit(state, ctx, { principal: 1_000_000, months: 4, annualRate: 0 })
    expect(r.payment).toBe(250_000)
    expect(r.hero).toEqual({ name: 'Япония', doneBefore: '2026-11', doneAfter: '2027-01', delayMonths: 2 })
    // Тот же ответ даёт сам план с кредитом в платежах, который кончается через 4 месяца.
    const withCredit = monthPlan(
      { ...state, credits: [{ id: 'x', name: 'x', note: '', principal: 1_000_000, annualRate: 0, payment: 250_000, day: 1, updatedAt: T0 }] },
      { ...ctx, ends: [{ amount: 250_000, after: 4 }] },
    )
    expect(withCredit.duesTotal).toBe(250_000)
    expect(withCredit.queue.find((q) => q.goalId === 'trip')!.doneMonth).toBe(r.hero!.doneAfter)
    // Нагрузка: 0 % → 250 000 / 300 000 = 83 %.
    expect(r.loadNowPct).toBe(0)
    expect(r.loadPct).toBe(83)
  })

  it('кредит съедает весь остаток — мечта ждёт его конца; вечный — «не соберётся» (Infinity); маленький — «не сдвинется» (0)', () => {
    // 3 000 000 на 10 месяцев: платёж 300 000 — весь доход; с июля 2027 (10-й месяц) взнос 100 000 → июль, август,
    // сентябрь → «2027-09», на 10 месяцев позже. Не «не соберётся»: кредит кончится.
    const all = tryCredit(small(), ctx, { principal: 3_000_000, months: 10, annualRate: 0 })
    expect(all.payment).toBe(300_000)
    expect(all.hero!.doneAfter).toBe('2027-09')
    expect(all.hero!.delayMonths).toBe(10)
    // Кредит дольше горизонта прогона (600 месяцев) — мечта с ним не соберётся.
    const forever = tryCredit(small(), ctx, { principal: 180_000_000, months: 600, annualRate: 0 })
    expect(forever.hero!.delayMonths).toBe(Infinity)
    expect(forever.hero!.doneAfter).toBeNull()
    // Платёж 1 000: свободно 299 000 ≥ взноса 100 000 — срок прежний.
    const tiny = tryCredit(small(), ctx, { principal: 12_000, months: 12, annualRate: 0 })
    expect(tiny.hero!.delayMonths).toBe(0)
  })

  it('героя нет — hero null; дохода нет — нагрузка и зарплаты null', () => {
    expect(tryCredit(small({ goals: [] }), ctx, { principal: 100_000, months: 10, annualRate: 0.2 }).hero).toBeNull()
    const poor = tryCredit(small({ people: [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }] }), ctx, {
      principal: 100_000, months: 10, annualRate: 0.2,
    })
    expect(poor.loadNowPct).toBeNull()
    expect(poor.loadPct).toBeNull()
    expect(poor.overpaySalaries).toBeNull()
  })

  it('ничего не пишет: состояние после прикидки прежнее', () => {
    const state = family()
    const before = JSON.stringify(state)
    tryCredit(state, ctx, { principal: 1_000_000, months: 24, annualRate: 0.2 })
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('canAfford — «Хватит?»', () => {
  // 5 сентября: до зарплаты Ильяса 10-го — аренда 5-го (220 000); на карте 2 000 000 → 1 780 000.
  const now = { key: KEY, day: 5 }

  it('со счетами — от «до зарплаты»: shortfall − сумма', () => {
    const state = family()
    const up = untilPayday(state, now)!
    expect(up.shortfall).toBe(1_780_000)
    expect(canAfford(state, ctx, 500_000, now)).toEqual({ ok: true, left: 1_280_000, inDays: 5 })
    expect(canAfford(state, ctx, 1_780_000, now)).toEqual({ ok: true, left: 0, inDays: 5 })
  })

  it('на счетах меньше платежей до зарплаты — «Нет» на любую сумму, нехватка с прежней дырой (критик Б5)', () => {
    // На карте 100 000, до зарплаты аренда 220 000 → shortfall −120 000; покупка 1 000 → не хватает 121 000.
    const state = family()
    const poor = { ...state, accounts: state.accounts!.map((a) => ({ ...a, amount: 100_000 })) }
    expect(untilPayday(poor, now)!.shortfall).toBe(-120_000)
    const r = canAfford(poor, ctx, 1_000, now)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.short).toBe(121_000)
  })

  it('без счетов — от остатка плана месяца', () => {
    const state = small()
    // Доход 300 000 − взнос 100 000 = остаток 200 000.
    expect(monthPlan(state, ctx).rest).toBe(200_000)
    expect(canAfford(state, ctx, 150_000, now)).toEqual({ ok: true, left: 50_000, inDays: null })
  })

  it('нехватка меньше месяца взносов — 0 месяцев («почти не сдвинется»)', () => {
    const state = small()
    const r = canAfford(state, ctx, 250_000, now)
    // Остаток 200 000 − 250 000 → не хватает 50 000; темп 100 000 в месяц → 0,5 месяца < 1 → 0.
    expect(r).toEqual({ ok: false, short: 50_000, goal: 'Япония', months: 0 })
    expect(r.ok === false && r.months).toBe(paceMonths(50_000, goalPace(dream(), KEY)))
  })

  it('крупная нехватка — в месяцах взносов главной мечты (владелец Б5: не в днях)', () => {
    const state = small()
    // Не хватает 5 200 000 − 200 000 = 5 000 000; при 100 000 в месяц — 50 месяцев (было бы 1520 дней).
    expect(canAfford(state, ctx, 5_200_000, now)).toEqual({ ok: false, short: 5_000_000, goal: 'Япония', months: 50 })
    // Ровно месяц: не хватает 100 000 → 1; 1,4 месяца → 1; 1,5 → 2 (округление).
    expect(canAfford(state, ctx, 300_000, now)).toMatchObject({ short: 100_000, months: 1 })
    expect(canAfford(state, ctx, 340_000, now)).toMatchObject({ short: 140_000, months: 1 })
    expect(canAfford(state, ctx, 350_000, now)).toMatchObject({ short: 150_000, months: 2 })
  })

  it('paceMonths: граница месяца — меньше одного 0, ровно один 1; без суммы или темпа — null', () => {
    expect(paceMonths(99_999, 100_000)).toBe(0)
    expect(paceMonths(100_000, 100_000)).toBe(1)
    expect(paceMonths(0, 100_000)).toBeNull()
    expect(paceMonths(50_000, 0)).toBeNull()
  })

  it('без героя или без темпа — месяцев нет', () => {
    expect(canAfford(small({ goals: [] }), ctx, 500_000, now)).toEqual({ ok: false, short: 200_000, goal: null, months: null })
    const idle = canAfford(small({ goals: [dream({ monthly: 0 })] }), ctx, 500_000, now)
    expect(idle).toEqual({ ok: false, short: 200_000, goal: 'Япония', months: null })
  })
})
