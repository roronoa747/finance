import { describe, expect, it } from 'vitest'
import { capitalStats, creditBalance, creditOutlook, creditSplit, debtsOverview, inSalaries, monthPlan, monthsBetween, planForecast, type MonthPlanCtx, type MonthPlanState } from './finance'
import { planFamilyDoc, planOf, T0 } from '@/test/planFamily'
import type { Payment, SyncDoc } from '@/types/finance'

/**
 * PN-04 (понятность Р-3): статистика плашки Капитала против плана месяца и ручного расчёта (правило 6 — числа в
 * комментариях). Семья `planFamilyDoc`, сентябрь 2026: доход 700 000 + 500 000 = 1 200 000; аренда 220 000; кредит
 * 1 000 000 под 33 % платёж 58 000 (проценты 27 500, тело 30 500), кредитка 300 000 под 40 % платёж 25 000 (проценты
 * 10 000, тело 15 000), рассрочка 240 000 без процентов платёж 20 000 (всё тело). Карточка долга 40 000 в месяц —
 * досрочка в самый дорогой (кредитка). Взносы целей — что даст очередь (`given`), проверяем тождеством с планом.
 */

const KEY = '2026-09'
const ctx: MonthPlanCtx = { key: KEY, totals: [], spendCategories: [], uploads: [] }

function stateOf(extra: Partial<SyncDoc> = {}): MonthPlanState & SyncDoc {
  const doc = planFamilyDoc({ debtCard: { monthly: 40_000, payer: 'a', updatedAt: T0 }, ...extra })
  return { ...doc, credits: doc.credits }
}

const statsOf = (state: MonthPlanState & SyncDoc) => {
  const plan = monthPlan(state, ctx)
  return { plan, stats: capitalStats(plan, { ...state, plans: state.plans }, KEY) }
}
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0)
const by = (parts: { key: string; amount: number }[], key: string) => parts.find((p) => p.key === key)?.amount ?? 0
const givenOf = (plan: ReturnType<typeof monthPlan>, kind: 'debt' | 'goals') => sum(plan.queue.filter((q) => (kind === 'debt') === (q.kind === 'debt')).map((q) => q.given))
const pay = (p: Partial<Payment> & Pick<Payment, 'id' | 'kind' | 'targetId' | 'period' | 'amount'>): Payment => ({
  accountId: 'card', by: 'a', at: '2026-09-15T10:00:00Z', updatedAt: '2026-09-15T10:00:00Z', ...p,
})
/** Как стор отдаёт кредиты экранам: остаток — из отметок (`derivedCredits`). */
const derived = (state: MonthPlanState & SyncDoc) => ({ ...state, credits: state.credits!.map((c) => ({ ...c, principal: creditBalance(c, state.payments) })) })

describe('capitalStats — доли дохода', () => {
  it('четыре доли = план месяца: кредиты (график + досрочка карточки), платежи, в цели (given), остаётся; тождество и проценты', () => {
    const { plan, stats } = statsOf(stateOf())
    expect(stats.income).toBe(1_200_000)
    expect(stats.parts.map((p) => p.key)).toEqual(['credits', 'payments', 'goals', 'rest'])
    const debtGiven = plan.queue.filter((q) => q.kind === 'debt').reduce((a, q) => a + q.given, 0)
    expect(debtGiven).toBe(40_000)
    // 58 000 + 25 000 + 20 000 + 40 000 = 143 000; аренда 220 000.
    expect(by(stats.parts, 'credits')).toBe(143_000)
    expect(by(stats.parts, 'payments')).toBe(220_000)
    const goalsGiven = plan.queue.filter((q) => q.kind !== 'debt').reduce((a, q) => a + q.given, 0)
    expect(goalsGiven).toBeGreaterThan(0)
    expect(by(stats.parts, 'goals')).toBe(goalsGiven)
    expect(by(stats.parts, 'rest')).toBe(1_200_000 - 143_000 - 220_000 - goalsGiven)
    // Тождество: сумма четырёх = max(доход, кредиты + платежи + в цели); нехватки нет.
    expect(sum(stats.parts.map((p) => p.amount))).toBe(Math.max(stats.income, 143_000 + 220_000 + goalsGiven))
    expect(stats.short).toBe(plan.short)
    expect(stats.short).toBe(0)
    // Проценты — целые, от дохода, в сумме 100 ± 1; доли 0…1 в сумме 1.
    for (const p of stats.parts) {
      expect(Number.isInteger(p.pct)).toBe(true)
      expect(p.pct).toBe(Math.round((p.amount / 1_200_000) * 100))
      expect(p.share).toBeGreaterThanOrEqual(0)
      expect(p.share).toBeLessThanOrEqual(1)
    }
    expect(Math.abs(sum(stats.parts.map((p) => p.pct)) - 100)).toBeLessThanOrEqual(1)
    expect(sum(stats.parts.map((p) => p.share))).toBeCloseTo(1, 9)
  })

  it('не хватает на платежи: «остаётся» 0, short > 0, полоска заполнена (доли в сумме 1, больше дохода)', () => {
    // Доход 100 000 + 50 000 = 150 000 < платежей 323 000.
    const base = stateOf()
    const { plan, stats } = statsOf(stateOf({ people: base.people.map((p) => ({ ...p, salary: p.id === 'a' ? 100_000 : 50_000 })) }))
    expect(plan.short).toBeGreaterThan(0)
    expect(stats.short).toBe(plan.short)
    expect(by(stats.parts, 'rest')).toBe(0)
    expect(by(stats.parts, 'goals')).toBe(0)
    expect(sum(stats.parts.map((p) => p.amount))).toBe(323_000)
    expect(sum(stats.parts.map((p) => p.share))).toBeCloseTo(1, 9)
    expect(sum(stats.parts.map((p) => p.pct))).toBeGreaterThan(100)
  })

  it('дохода нет: долей нет, переплата в зарплатах — null; остальное считается', () => {
    const base = stateOf()
    const { stats } = statsOf(stateOf({ people: base.people.map((p) => ({ ...p, salary: 0 })) }))
    expect(stats.income).toBe(0)
    expect(stats.parts).toEqual([])
    expect(stats.overpay.amount).not.toBeNull()
    expect(stats.overpay.salaries).toBeNull()
    expect(stats.growth).toBeGreaterThan(0)
    expect(stats.debtFree.month).not.toBeNull()
  })

  it('без кредитов: трёх долей, «кредиты» нет; срок null, переплата 0', () => {
    const { stats } = statsOf(stateOf({ credits: [] }))
    expect(stats.parts.map((p) => p.key)).toEqual(['payments', 'goals', 'rest'])
    expect(stats.debtFree).toEqual({ month: null, months: null, salaries: null })
    expect(stats.overpay).toEqual({ amount: 0, salaries: 0 })
  })
})

describe('capitalStats — рост, срок и переплата', () => {
  it('рост = тело кредитов по аннуитету (вручную) + досрочка карточки + взносы целей', () => {
    const { plan, stats } = statsOf(stateOf())
    // Кредит: 1 000 000 × 0,33 / 12 = 27 500 процентов → тело 30 500; кредитка: 300 000 × 0,4 / 12 = 10 000 → тело
    // 15 000; рассрочка 0 % — 20 000 целиком. Тело 65 500 + досрочка 40 000 + взносы целей.
    expect(creditSplit(1_000_000, 0.33, 58_000).body).toBe(30_500)
    expect(creditSplit(300_000, 0.4, 25_000).body).toBe(15_000)
    expect(creditSplit(240_000, 0, 20_000).body).toBe(20_000)
    const goalsGiven = plan.queue.filter((q) => q.kind !== 'debt').reduce((a, q) => a + q.given, 0)
    expect(stats.growth).toBe(65_500 + 40_000 + goalsGiven)
    expect(Number.isInteger(stats.growth)).toBe(true)
  })

  it('долг человеку без процентов — платёж целиком в рост; досрочки карточки нет без неё', () => {
    const base = stateOf({ debtCard: null })
    const bro = { id: 'bro', name: 'Брату', note: '', principal: 300_000, annualRate: 0, payment: 50_000, day: 25, person: true, updatedAt: T0 }
    const { plan, stats } = statsOf({ ...base, credits: [...base.credits!, bro] })
    expect(plan.queue.filter((q) => q.kind === 'debt').reduce((a, q) => a + q.given, 0)).toBe(0)
    const goalsGiven = plan.queue.filter((q) => q.kind !== 'debt').reduce((a, q) => a + q.given, 0)
    expect(by(stats.parts, 'credits')).toBe(58_000 + 25_000 + 20_000 + 50_000)
    expect(stats.growth).toBe(65_500 + 50_000 + goalsGiven)
  })

  it('срок — месяц из debtsOverview, месяцы и зарплаты (ритм — месяц)', () => {
    const state = stateOf()
    const { stats } = statsOf(state)
    const o = debtsOverview({ ...state, plans: state.plans }, KEY)
    expect(o.freeMonth).not.toBeNull()
    expect(stats.debtFree.month).toBe(o.freeMonth)
    expect(stats.debtFree.months).toBe(monthsBetween(KEY, o.freeMonth!))
    expect(stats.debtFree.salaries).toBe(stats.debtFree.months)
    expect(stats.debtFree.months).toBeGreaterThan(0)
  })

  it('переплата — сумма creditOutlook процентных долгов (рассрочка 0 % не считается), в зарплатах с одной десятой', () => {
    const state = stateOf()
    const { stats } = statsOf(state)
    const loan = creditOutlook(state.credits!.find((c) => c.id === 'loan')!)
    const cc = creditOutlook(state.credits!.find((c) => c.id === 'cc')!)
    expect(loan.closes && cc.closes).toBe(true)
    expect(stats.overpay.amount).toBe(loan.overpay + cc.overpay)
    expect(stats.overpay.salaries).toBe(Math.round(((loan.overpay + cc.overpay) / 1_200_000) * 10) / 10)
  })

  it('кредит не закрывается при нынешнем платеже → переплата null; срок тоже null', () => {
    const base = stateOf()
    // Кредитка 300 000 под 40 %: проценты 10 000 в месяц, платёж 9 000 — тело не уменьшается.
    const { stats } = statsOf(stateOf({ credits: base.credits!.map((c) => (c.id === 'cc' ? { ...c, payment: 9_000 } : c)) }))
    expect(stats.overpay).toEqual({ amount: null, salaries: null })
    expect(stats.debtFree.month).toBeNull()
  })

  it('с планом «Сначала долги» — переплата минус его экономия (planForecast.savedInterest), срок — из плана', () => {
    const state = stateOf({ plans: [planOf()] })
    const { stats } = statsOf(state)
    const without = statsOf(stateOf()).stats
    const fc = planForecast(planOf(), { ...state }, KEY)
    expect(fc.savedInterest).not.toBeNull()
    expect(fc.savedInterest).toBeGreaterThan(0)
    expect(stats.overpay.amount).toBe(Math.max(0, without.overpay.amount! - fc.savedInterest!))
    expect(stats.debtFree.month).toBe(debtsOverview({ ...state, plans: state.plans }, KEY).freeMonth)
    expect(stats.debtFree.month).not.toBe(without.debtFree.month)
  })

  it('inSalaries: 450 000 при доходе 300 000 — 1,5; одна десятая; дохода нет — null', () => {
    expect(inSalaries(450_000, 300_000)).toBe(1.5)
    expect(inSalaries(130_598, 1_211_310)).toBe(0.1)
    expect(inSalaries(0, 300_000)).toBe(0)
    expect(inSalaries(100, 0)).toBeNull()
  })
})

describe('capitalStats — отметки месяца (критик Блока 2): кредиты стора уже без тела этого месяца', () => {
  it('кредит оплачен в этом месяце: тело — как в отметке (от остатка на начало месяца), не от уменьшенного; доля «кредиты» — сумма отметки', () => {
    const state = derived(stateOf({ payments: [pay({ id: 'l', kind: 'credit', targetId: 'loan', period: KEY, amount: 58_000, principal: 30_500 })] }))
    expect(state.credits!.find((c) => c.id === 'loan')!.principal).toBe(969_500)
    const { plan, stats } = statsOf(state)
    // От уменьшенного остатка 969 500 тело вышло бы 31 339 (проценты 26 661) — на 839 ₸ больше, чем ушло в долг.
    expect(creditSplit(969_500, 0.33, 58_000).body).toBe(31_339)
    expect(givenOf(plan, 'debt')).toBe(40_000)
    expect(stats.growth).toBe(30_500 + 15_000 + 20_000 + 40_000 + givenOf(plan, 'goals'))
    expect(by(stats.parts, 'credits')).toBe(143_000)
  })

  it('кредит закрыт платежом этого месяца: в доле «кредиты» и в росте — его тело целиком; из срока и переплаты он ушёл', () => {
    const state = derived(stateOf({ payments: [pay({ id: 'i', kind: 'credit', targetId: 'inst', period: KEY, amount: 240_000, principal: 240_000 })] }))
    expect(state.credits!.find((c) => c.id === 'inst')!.principal).toBe(0)
    const { plan, stats } = statsOf(state)
    // Платёж месяца закрытого долга в бюджете остаётся (`creditMonthPayment`), а остаток 0 дал бы тело 0.
    expect(plan.dues.find((d) => d.targetId === 'inst')?.amount).toBe(240_000)
    expect(creditSplit(0, 0, 240_000).body).toBe(0)
    expect(givenOf(plan, 'debt')).toBe(40_000)
    expect(by(stats.parts, 'credits')).toBe(58_000 + 25_000 + 240_000 + 40_000)
    expect(stats.growth).toBe(30_500 + 15_000 + 240_000 + 40_000 + givenOf(plan, 'goals'))
    const o = debtsOverview({ ...state, plans: state.plans }, KEY)
    expect(o.rows.map((r) => r.creditId).sort()).toEqual(['cc', 'loan'])
    expect(stats.debtFree.month).toBe(o.freeMonth)
    const open = state.credits!.filter((c) => c.principal > 0)
    expect(stats.overpay.amount).toBe(sum(open.map((c) => creditOutlook(c).overpay)))
  })

  it('долг человеку без ежемесячного платежа не закрывается: срок и переплата null вместе (как debtsOverview) — экран скажет «не закрываются»', () => {
    const base = stateOf()
    const bro = { id: 'bro', name: 'Брату', note: '', principal: 300_000, annualRate: 0, payment: 0, day: 25, person: true, updatedAt: T0 }
    const state = { ...base, credits: [...base.credits!, bro] }
    const { plan, stats } = statsOf(state)
    expect(plan.dues.some((d) => d.targetId === 'bro')).toBe(false)
    expect(creditOutlook(bro).closes).toBe(false)
    expect(debtsOverview({ ...state, plans: state.plans }, KEY).freeMonth).toBeNull()
    expect(stats.debtFree.month).toBeNull()
    expect(stats.overpay).toEqual({ amount: null, salaries: null })
  })

  it('только беспроцентная рассрочка: срок — по графику (12 платежей), переплата 0 — строки на экране нет; «кредиты» и рост — её платёж', () => {
    const base = stateOf()
    const state = { ...base, credits: base.credits!.filter((c) => c.id === 'inst') }
    const { plan, stats } = statsOf(state)
    expect(givenOf(plan, 'debt')).toBe(0)
    expect(stats.overpay).toEqual({ amount: 0, salaries: 0 })
    expect(stats.debtFree.month).toBe(debtsOverview({ ...state, plans: state.plans }, KEY).freeMonth)
    expect(stats.debtFree.months).toBe(12)
    expect(by(stats.parts, 'credits')).toBe(20_000)
    expect(stats.growth).toBe(20_000 + givenOf(plan, 'goals'))
  })
})
