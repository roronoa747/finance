import { describe, expect, it } from 'vitest'
import { allInDebt, creditOutlook, monthPlan, monthPlanPast, planFromSource, planSave, type MonthPlanCtx, type MonthPlanState } from './finance'
import { addMonths } from './dates'
import type { Allocation, Goal } from '@/types/finance'

/**
 * B2C-86: план месяца против ручного расчёта (правило 6 — числа в комментариях).
 *
 * Октябрь 2026. Доход: Ильяс 1 500 € — пришла на евро-счёт, обменял 500 € по 512 (256 000) + 1 000 € по курсу
 * дня зарплаты 518 (518 000) = 774 000; Аруна 450 000 ₸ — ждём 25-го. Итого 1 224 000.
 * Платежи: квартира 250 000 (Аруна), кредит 80 000 (Ильяс; 1 000 000 под 24 %: проценты 20 000, тело 60 000),
 * подписка $15 по 480 = 7 200 (плательщика нет → первый участник, Ильяс). Итого 337 200.
 * Траты: Ильяс — такси 80 000 + кафе 60 000 = 140 000 (коммуналка 30 000 — раздел платежей, не планируется);
 * Аруна — продукты 150 000 + покупки 40 000 = 190 000. Итого 330 000.
 * Свободно: 1 224 000 − 337 200 − 330 000 = 556 800. Месяц трат (порог фондов): 337 200 + 330 000 = 667 200.
 * Очередь (сверху вниз, каждой не больше взноса и остатка):
 *   Япония (Ильяс)  нужно 1 800 000, есть 840 000, взнос 60 000  → 60 000   (остаток 496 800)
 *   Запас (Ильяс)   порог 1 × 667 200, есть 310 000, взнос 50 000 → 50 000   (446 800)
 *   Долг (Аруна)    карточка 80 000 в месяц                        → 80 000   (366 800)
 *   Машина (Ильяс)  нужно 5 000 000, есть 1 900 000, взнос 100 000 → 100 000 (266 800)
 *   Подушка (Аруна) копилка, порог 3 × 667 200 = 2 001 600, есть 620 000, взнос 40 000 → 40 000 (226 800)
 *   Свадьба (Аруна) нужно 1 500 000, есть 200 000, взнос 200 000  → 200 000 (26 800)
 * Очередь 530 000, остаток 26 800. Проверка: 337 200 + 330 000 + 530 000 + 26 800 = 1 224 000.
 * Хватает ли: Ильяс 774 000 − 87 200 − 140 000 − 210 000 = 336 800; Аруна 450 000 − 250 000 − 190 000 − 320 000 =
 * −310 000. Сумма = 26 800 = остаток.
 * Даты (всем хватает каждый месяц): Япония 960 000 / 60 000 = 16 мес. → январь 2028; Запас 357 200 / 50 000 → 8 →
 * май 2027; Машина 3 100 000 / 100 000 = 31 → апрель 2029; Подушка 1 381 600 / 40 000 → 35 → август 2029; Свадьба
 * 1 300 000 / 200 000 → 7 → апрель 2027; долг — платёж 80 000 + 80 000 в месяц: 7 месяцев → апрель 2027.
 */

const KEY = '2026-10'
const T0 = '2026-09-01T00:00:00.000Z'
const goal = (id: string, name: string, need: number, have: number, monthly: number, extra: Partial<Goal> = {}): Goal => ({
  id, name, need, seed: have, have, monthly, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})

function family(extra: Partial<MonthPlanState> = {}): MonthPlanState {
  return {
    people: [
      { id: 'a', name: 'Ильяс', salary: 750_000, payday: 10, updatedAt: T0, salaryVersions: [{ from: '2025-10', amount: 1_500, currency: 'EUR', rate: 506 }] },
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 25, updatedAt: T0 },
    ],
    obligations: [
      { id: 'flat', name: 'Квартира', note: '', day: 5, category: 'd1', versions: [{ from: '2026-01', amount: 250_000 }], payer: 'b', updatedAt: T0 },
      { id: 'sub', name: 'Подписка', note: '', day: 10, category: 'd4', versions: [{ from: '2026-01', amount: 15, currency: 'USD', rate: 470 }], updatedAt: T0 },
    ],
    credits: [{ id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.24, payment: 80_000, day: 15, payer: 'a', updatedAt: T0 }],
    goals: [
      goal('trip', 'Япония', 1_800_000, 840_000, 60_000, { payer: 'a' }),
      goal('res', 'Запас', 0, 310_000, 50_000, { fund: 'reserve', payer: 'a' }),
      goal('car', 'Машина', 5_000_000, 1_900_000, 100_000, { payer: 'a' }),
      goal('pot', 'Подушка', 1_500_000, 620_000, 40_000, { payer: 'b' }),
      goal('wed', 'Свадьба', 1_500_000, 200_000, 200_000, { payer: 'b' }),
    ],
    payments: [
      { id: 'sal-a', kind: 'salary', targetId: 'a', period: KEY, amount: 777_000, foreign: 1_500, currency: 'EUR', accountId: 'eur', by: 'a', at: '2026-10-10T05:00:00.000Z', updatedAt: T0 },
    ],
    fxExchanges: [
      { id: 'x1', by: 'a', accountId: 'eur', toAccountId: 'kzt', currency: 'EUR', foreign: 500, rate: 512, tenge: 256_000, period: KEY, at: '2026-10-10T06:00:00.000Z', updatedAt: T0 },
    ],
    book: { EUR: { '2026-10-09': 518 }, USD: { '2026-10-09': 480 } },
    moneySettings: { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'pot', updatedAt: T0 },
    spendPlans: [
      { id: 'a:sc_transport', by: 'a', categoryId: 'sc_transport', amount: 80_000, updatedAt: T0 },
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 60_000, updatedAt: T0 },
      { id: 'a:sc_utilities', by: 'a', categoryId: 'sc_utilities', amount: 30_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
      { id: 'b:sc_shopping', by: 'b', categoryId: 'sc_shopping', amount: 40_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['trip', 'res', 'debt', 'car', 'pot', 'wed'], updatedAt: T0 },
    debtCard: { monthly: 80_000, payer: 'b', updatedAt: T0 },
    ...extra,
  }
}

const ctx: MonthPlanCtx = {
  key: KEY,
  // Выписка Ильяса за октябрь: такси 52 000, кафе 31 400, коммуналка 25 000 (раздел платежей — не трата), не разобрано 5 000.
  totals: [
    { id: 'a:month:2026-10:sc_transport', by: 'a', kind: 'month', period: KEY, categoryId: 'sc_transport', amount: 52_000, ops: 9, updatedAt: T0 },
    { id: 'a:month:2026-10:sc_cafe', by: 'a', kind: 'month', period: KEY, categoryId: 'sc_cafe', amount: 31_400, ops: 6, updatedAt: T0 },
    { id: 'a:month:2026-10:sc_utilities', by: 'a', kind: 'month', period: KEY, categoryId: 'sc_utilities', amount: 25_000, ops: 1, updatedAt: T0 },
    { id: 'a:month:2026-10:unknown', by: 'a', kind: 'month', period: KEY, categoryId: 'unknown', amount: 5_000, ops: 2, updatedAt: T0 },
  ],
  spendCategories: [],
  uploads: [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-20' }],
}

const byId = (p: ReturnType<typeof monthPlan>, id: string) => p.queue.find((q) => q.id === id)!
const given = (p: ReturnType<typeof monthPlan>) => Object.fromEntries(p.queue.map((q) => [q.id, q.given]))

describe('monthPlan — ручной расчёт семьи', () => {
  const plan = monthPlan(family(), ctx)

  it('доход, платежи, траты — до тенге', () => {
    expect(plan.income.byPerson).toEqual([
      { person: 'a', name: 'Ильяс', amount: 774_000, came: true },
      { person: 'b', name: 'Аруна', amount: 450_000, came: false },
    ])
    expect(plan.income.total).toBe(1_224_000)
    expect(plan.dues.map((d) => [d.targetId, d.amount, d.payer])).toEqual([['flat', 250_000, 'b'], ['sub', 7_200, 'a'], ['loan', 80_000, 'a']])
    expect(plan.duesTotal).toBe(337_200)
    expect(plan.spend.map((s) => [s.by, s.plan, s.fact])).toEqual([['a', 140_000, 88_400], ['b', 190_000, null]])
    expect(plan.spend[0].rows).toEqual([
      { categoryId: 'sc_transport', name: 'Транспорт', plan: 80_000, fact: 52_000 },
      { categoryId: 'sc_cafe', name: 'Кафе и рестораны', plan: 60_000, fact: 31_400 },
    ])
    expect(plan.spendTotal).toBe(330_000)
    expect(plan.outTotal).toBe(plan.duesTotal + plan.spendTotal)
    expect(plan.free).toBe(556_800)
  })

  it('очередь сверху вниз, остаток, хватает ли каждому; сумма частей = доход', () => {
    expect(given(plan)).toEqual({ trip: 60_000, res: 50_000, debt: 80_000, car: 100_000, pot: 40_000, wed: 200_000 })
    expect(plan.queue.map((q) => [q.id, q.kind, q.payer])).toEqual([
      ['trip', 'goal', 'a'], ['res', 'fund', 'a'], ['debt', 'debt', 'b'], ['car', 'goal', 'a'], ['pot', 'fund', 'b'], ['wed', 'goal', 'b'],
    ])
    expect(byId(plan, 'res')).toMatchObject({ fund: 'reserve', need: 667_200, have: 310_000 })
    expect(byId(plan, 'pot')).toMatchObject({ fund: 'cushion', need: 2_001_600, have: 620_000 })
    expect(byId(plan, 'debt')).toMatchObject({ creditId: 'loan', have: 1_000_000 })
    expect(plan.queueTotal).toBe(530_000)
    expect(plan.rest).toBe(26_800)
    expect(plan.short).toBe(0)
    expect(plan.duesTotal + plan.spendTotal + plan.queueTotal + plan.rest - plan.short).toBe(plan.income.total)
    expect(plan.byPerson.map((p) => [p.person, p.dues, p.spend, p.queue, p.left])).toEqual([
      ['a', 87_200, 140_000, 210_000, 336_800],
      ['b', 250_000, 190_000, 320_000, -310_000],
    ])
    expect(plan.byPerson.reduce((s, p) => s + p.left, 0)).toBe(plan.rest)
  })

  it('даты с учётом очереди; долг — как creditOutlook с доплатой', () => {
    expect(Object.fromEntries(plan.queue.map((q) => [q.id, q.doneMonth]))).toEqual({
      trip: '2028-01', res: '2027-05', debt: '2027-04', car: '2029-04', pot: '2029-08', wed: '2027-04',
    })
    const o = creditOutlook({ principal: 1_000_000, annualRate: 0.24, payment: 160_000 })
    expect(byId(plan, 'debt').doneMonth).toBe(addMonths(KEY, o.months - 1))
  })
})

describe('monthPlan — не хватает', () => {
  it('доход меньше платежей и трат: очередь 0, нехватка; сумма частей сходится', () => {
    // Аруна тратит 1 000 000 на продукты: свободно 1 224 000 − 337 200 − 1 040 000 = −153 200.
    const p = monthPlan(family({ spendPlans: [{ id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 1_040_000, updatedAt: T0 }] }), ctx)
    expect(p.free).toBe(-153_200)
    expect(p.queueTotal).toBe(0)
    expect(p.rest).toBe(0)
    expect(p.short).toBe(153_200)
    expect(p.duesTotal + p.spendTotal + p.queueTotal + p.rest - p.short).toBe(p.income.total)
  })

  it('остатка на часть очереди: верх получает первым, следующая — сколько осталось', () => {
    // Траты Аруны +486 800: свободно 70 000 → Япония 60 000, Запас 10 000 из 50 000, дальше 0.
    const p = monthPlan(family({ spendPlans: [...family().spendPlans!, { id: 'b:sc_fun', by: 'b', categoryId: 'sc_fun', amount: 486_800, updatedAt: T0 }] }), ctx)
    expect(p.free).toBe(70_000)
    expect(given(p)).toEqual({ trip: 60_000, res: 10_000, debt: 0, car: 0, pot: 0, wed: 0 })
    // Порог Запаса — месяц трат: 337 200 + 816 800 = 1 154 000, не хватает 844 000. Пока собирается Япония
    // (16 месяцев), Запас получает 10 000: 160 000; с 17-го месяца — 50 000: 684 000 / 50 000 → 14 → 30-й месяц
    // от октября 2026 — март 2029. Долг закрывается по графику (80 000 при 2 % в месяц — 15 платежей, декабрь 2027)
    // раньше, чем до него дойдут деньги очереди.
    expect(byId(p, 'res')).toMatchObject({ need: 1_154_000, want: 50_000, given: 10_000 })
    expect(byId(p, 'res').doneMonth).toBe('2029-03')
    // Машина получает деньги только когда выше всё собрано: позже Запаса и закрытия долга.
    const car = byId(p, 'car').doneMonth!
    expect(car > byId(p, 'res').doneMonth! && car > byId(p, 'debt').doneMonth!).toBe(true)
    expect(byId(p, 'debt').doneMonth).toBe('2027-12')
    expect(byId(p, 'debt').doneMonth).toBe(addMonths(KEY, creditOutlook({ principal: 1_000_000, annualRate: 0.24, payment: 80_000 }).months - 1))
  })
})

describe('вкл/выкл (Р-83) и «всё в долг»', () => {
  const tight = family({ spendPlans: [...family().spendPlans!, { id: 'b:sc_fun', by: 'b', categoryId: 'sc_fun', amount: 486_800, updatedAt: T0 }] })

  it('выключил верхнюю — следующая получает её деньги, дата сдвигается', () => {
    const off = monthPlan({ ...tight, goals: tight.goals!.map((g) => (g.id === 'trip' ? { ...g, pausedAt: '2026-10-04T08:00:00.000Z' } : g)) }, ctx)
    expect(byId(off, 'trip')).toMatchObject({ given: 0, paused: 'off', doneMonth: null })
    // 70 000: Запас 50 000, долг 20 000. Запасу 844 000 по 50 000 → 17 месяцев — февраль 2028 (было март 2029).
    expect(given(off)).toEqual({ trip: 0, res: 50_000, debt: 20_000, car: 0, pot: 0, wed: 0 })
    expect(byId(off, 'res').doneMonth).toBe('2028-02')
  })

  it('карточка долга на паузе — 0, но дата закрытия по графику остаётся', () => {
    const p = monthPlan({ ...family(), debtCard: { monthly: 80_000, payer: 'b', pausedAt: T0, updatedAt: T0 } }, ctx)
    expect(byId(p, 'debt')).toMatchObject({ given: 0, paused: 'off' })
    expect(byId(p, 'debt').doneMonth).toBe(addMonths(KEY, creditOutlook({ principal: 1_000_000, annualRate: 0.24, payment: 80_000 }).months - 1))
    expect(p.rest).toBe(26_800 + 80_000)
  })

  it('allInDebt: весь свободный остаток в досрочку — закроете к ноябрю 2026', () => {
    // 1 000 000: октябрь — проценты 20 000, тело 60 000, досрочка 556 800 → 383 200; ноябрь — проценты 7 664,
    // тело 72 336 → 310 864, досрочка закрывает.
    expect(allInDebt(family(), ctx)).toEqual({ month: '2026-11', creditId: 'loan', extra: 556_800 })
    const o = creditOutlook({ principal: 1_000_000, annualRate: 0.24, payment: 80_000 + 556_800 })
    expect(addMonths(KEY, o.months - 1)).toBe('2026-11')
    // Без процентных долгов — null.
    expect(allInDebt(family({ credits: [{ ...family().credits![0], annualRate: 0 }] }), ctx)).toBeNull()
  })
})

describe('плательщик (Р-80)', () => {
  it('перенос квартиры на Ильяса: «хватает» обоих меняется, общий итог тот же', () => {
    const base = monthPlan(family(), ctx)
    const moved = monthPlan(family({ obligations: family().obligations!.map((o) => (o.id === 'flat' ? { ...o, payer: 'a' } : o)) }), ctx)
    expect(moved.byPerson.map((p) => p.left)).toEqual([336_800 - 250_000, -310_000 + 250_000])
    expect(moved.rest).toBe(base.rest)
    expect(moved.queueTotal).toBe(base.queueTotal)
  })
})

describe('planSave — «Отложить по плану»', () => {
  const at = '2026-10-10T07:00:00.000Z'
  const saved = (rec: Partial<Allocation> = {}): Allocation => ({
    id: 'rec', source: 'salary', sourceId: 'a', period: KEY, by: 'a', at, total: 774_000, parts: [], updatedAt: at, kind: 'plan', ...rec,
  })

  it('пишет цели и фонды плательщика; чужая карточка долга и неприщедшая зарплата — нет', () => {
    const plan = monthPlan(family(), ctx)
    expect(planSave(plan, 'a')).toEqual({
      record: { source: 'salary', sourceId: 'a', period: KEY },
      total: 774_000,
      contributions: [{ goalId: 'trip', amount: 60_000 }, { goalId: 'res', amount: 50_000 }, { goalId: 'car', amount: 100_000 }],
      prepay: null,
      parts: [{ target: 'trip', amount: 60_000 }, { target: 'res', amount: 50_000 }, { target: 'car', amount: 100_000 }],
    })
    expect(planSave(plan, 'b')).toBeNull()
  })

  it('после записи — план тот же (взносы от начала месяца), второй вызов пуст', () => {
    const before = monthPlan(family(), ctx)
    const move = (amount: number) => ({ id: `m${amount}`, date: at, amount, by: 'a' as const })
    const after = family({
      goals: family().goals!.map((g) => (g.id === 'trip' ? { ...g, have: 900_000, movements: [move(60_000)] } : g)),
      allocations: [saved()],
    })
    const plan = monthPlan(after, ctx)
    expect(given(plan)).toEqual(given(before))
    expect(byId(plan, 'trip')).toMatchObject({ have: 840_000, put: 60_000, doneMonth: '2028-01' })
    // «✓ Отложено» — взносы месяца по очереди: только «Отпуск» 60 000 (критик).
    expect(plan.putTotal).toBe(60_000)
    expect(before.putTotal).toBe(0)
    expect(planSave(plan, 'a')).toBeNull()
  })

  it('отложенное руками в этом месяце не кладётся второй раз; досрочка — шагом карточки плательщика', () => {
    const plan = monthPlan(family({
      goals: family().goals!.map((g) => (g.id === 'trip' ? { ...g, have: 860_000, movements: [{ id: 'm', date: '2026-10-03', amount: 20_000, by: 'a' }] } : g)),
      debtCard: { monthly: 80_000, payer: 'a', updatedAt: T0 },
    }), ctx)
    const s = planSave(plan, 'a')!
    expect(s.contributions[0]).toEqual({ goalId: 'trip', amount: 40_000 })
    expect(s.prepay).toEqual({ creditId: 'loan', amount: 80_000 })
    expect(s.parts).toContainEqual({ target: 'prepay:loan', amount: 80_000 })
  })

  it('запись старого разбора месяца (Блок 11) — план считается как был, второй раз не пишется', () => {
    const plan = monthPlan(family({ allocations: [saved({ kind: 'breakdown', parts: [{ target: 'dreams', amount: 100_000 }] })] }), ctx)
    expect(given(plan)).toEqual(given(monthPlan(family(), ctx)))
    expect(plan.saved.a?.kind).toBe('breakdown')
    expect(planSave(plan, 'a')).toBeNull()
  })
})

describe('planFromSource — прочие источники (Р-86)', () => {
  it('остались деньги: разово по очереди сверху вниз до суммы цели, порога фонда', () => {
    // 1 000 000: Япония до суммы — 960 000, Запас — 40 000 из 357 200 до порога.
    const r = planFromSource(family(), ctx, { from: 'rest', amount: 1_000_000, period: '2026-09' })
    expect(r).toMatchObject({
      mode: 'once', amount: 1_000_000, left: 0, prepay: null, recorded: null,
      record: { source: 'rest', sourceId: '2026-09', period: '2026-09' },
      contributions: [{ goalId: 'trip', amount: 960_000 }, { goalId: 'res', amount: 40_000 }],
    })
  })

  it('долг закрыт: его платёж — разово по очереди', () => {
    // Рассрочка 50 000 закрыта октябрьским платежом: 50 000 — в Японию.
    const kaspi = { id: 'kaspi', name: 'Рассрочка', note: '', principal: 50_000, principalSetAt: T0, annualRate: 0, payment: 50_000, day: 20, updatedAt: T0 }
    const doc = family({
      credits: [...family().credits!, kaspi],
      payments: [...family().payments!, { id: 'pk', kind: 'credit', targetId: 'kaspi', period: KEY, amount: 50_000, principal: 50_000, accountId: null, by: 'b', at: '2026-10-20T05:00:00.000Z', updatedAt: T0 }],
    })
    const r = planFromSource({ ...doc, credits: [family().credits![0], { ...kaspi, principal: 0 }] }, { ...ctx, rawCredits: doc.credits }, { from: 'credit', creditId: 'kaspi' })
    expect(r).toMatchObject({ mode: 'once', amount: 50_000, contributions: [{ goalId: 'trip', amount: 50_000 }], record: { source: 'freed', sourceId: 'kaspi', period: KEY } })
  })

  it('освободится: +N к взносу первой включённой цели с месяца освобождения; даты «к X, а не к Y»', () => {
    // Абонемент 20 000 заканчивается с декабря: Япония 60 000 → 80 000. В декабре в ней 840 000:
    // без прибавки 960 000 / 60 000 = 16 → март 2028, с ней 960 000 / 80 000 = 12 → ноябрь 2027.
    const gym = { id: 'gym', name: 'Абонемент', note: '', day: 3, category: 'd4' as const, versions: [{ from: '2026-01', amount: 20_000 }, { from: '2026-12', amount: 0 }], updatedAt: T0 }
    const r = planFromSource(family({ obligations: [...family().obligations!, gym] }), ctx, { from: 'freed' })
    expect(r).toEqual({
      mode: 'monthly', amount: 20_000, add: 20_000, goalId: 'trip', name: 'Япония', before: '2028-03', after: '2027-11', recorded: null,
      record: { source: 'freed', sourceId: 'gym', period: '2026-12' },
    })
    expect(planFromSource(family(), ctx, { from: 'freed' })).toBeNull()
  })
})

describe('monthPlanPast — сентябрь сводкой', () => {
  it('пришло, оплачено, отложено, потрачено — из записей; прошлый разбор читается', () => {
    const sep = '2026-09'
    const breakdown: Allocation = { id: 'bd', kind: 'breakdown', source: 'salary', sourceId: 'b', period: sep, by: 'b', at: '2026-09-25T06:00:00.000Z', total: 450_000, parts: [{ target: 'dreams', amount: 40_000 }], updatedAt: T0 }
    const doc = {
      ...family(),
      payments: [
        { id: 's', kind: 'salary' as const, targetId: 'b', period: sep, amount: 450_000, accountId: null, by: 'b' as const, at: '2026-09-25T05:00:00.000Z', updatedAt: T0 },
        { id: 'f', kind: 'obligation' as const, targetId: 'flat', period: sep, amount: 250_000, accountId: null, by: 'b' as const, at: '2026-09-05T05:00:00.000Z', updatedAt: T0 },
        { id: 'p', kind: 'prepay' as const, targetId: 'loan', period: sep, amount: 30_000, principal: 30_000, accountId: null, by: 'a' as const, at: '2026-09-12T05:00:00.000Z', updatedAt: T0 },
      ],
      goals: family().goals!.map((g) => (g.id === 'wed' ? { ...g, movements: [{ id: 'm', date: '2026-09-25T06:00:00.000Z', amount: 40_000, by: 'b' as const }] } : g)),
      allocations: [breakdown],
      spendTotals: [
        { id: 'b:month:2026-09:sc_food', by: 'b' as const, kind: 'month' as const, period: sep, categoryId: 'sc_food', amount: 120_000, ops: 20, updatedAt: T0 },
        { id: 'b:month:2026-09:sc_rent', by: 'b' as const, kind: 'month' as const, period: sep, categoryId: 'sc_rent', amount: 250_000, ops: 1, updatedAt: T0 },
      ],
    }
    expect(monthPlanPast(doc, sep)).toEqual({
      key: sep, came: 450_000, cameBy: [{ person: 'b', amount: 450_000 }], paid: 250_000, saved: 40_000, prepaid: 30_000, spent: 120_000,
      // 450 000 − 250 000 − 120 000 − 40 000 − 30 000 = 10 000 (руками).
      left: 10_000,
      goals: [{ goalId: 'wed', name: doc.goals.find((g) => g.id === 'wed')!.name, amount: 40_000 }],
      records: [breakdown],
    })
    expect(monthPlanPast({}, sep)).toMatchObject({ came: 0, paid: 0, saved: 0, spent: null, left: 0, goals: [], records: [] })
  })
})
