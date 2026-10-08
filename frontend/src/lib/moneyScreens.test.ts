import { describe, expect, it } from 'vitest'
import {
  capitalGoals,
  creditOutlook,
  debtsOverview,
  goalSavings,
  historyMonths,
  monthPlan,
  monthPlanPast,
  monthSalaries,
  netWorth,
  planForecast,
  type MonthPlanState,
} from './finance'
import { addMonths } from './dates'
import type { Operation } from '@/lib/statements/types'
import type { Account, Credit, DebtPlan, Goal, Obligation, Payment } from '@/types/finance'

/**
 * B2C-99: расчёты «Денег» Блока 16 против ручного расчёта (правило 6 — числа в комментариях). Пример — эталон
 * `money-b16.html`: счета Kaspi Gold 820 000, евро-счёт 512 000, депозит 9 400 000; цели Квартира 3 200 000, Машина
 * 600 000, Япония 340 000 и Подушка 400 000 на Kaspi Gold; кредиты Kaspi 1 020 000 и рассрочка 224 000.
 */

const KEY = '2026-10'
const T0 = '2026-09-01T00:00:00.000Z'

const account = (id: string, name: string, amount: number): Account => ({ id, name, note: '', amount, kind: 'card', updatedAt: T0 })
const goal = (id: string, name: string, have: number, extra: Partial<Goal> = {}): Goal => ({
  id, name, need: 5_000_000, seed: have, have, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})
const credit = (id: string, name: string, principal: number, annualRate: number, payment: number): Credit => ({
  id, name, note: '', principal, annualRate, payment, day: 15, updatedAt: T0,
})
const pay = (id: string, p: Partial<Payment>): Payment => ({
  id, kind: 'credit', targetId: 'loan', period: KEY, amount: 85_000, accountId: null, by: 'a', at: '2026-09-15T05:00:00.000Z', updatedAt: T0, ...p,
})

const ACCOUNTS = [account('kaspi', 'Kaspi Gold', 820_000), account('eur', 'Евро-счёт', 512_000), account('dep', 'Депозит Freedom', 9_400_000)]
const GOALS = [
  goal('flat', 'Квартира', 3_200_000),
  goal('pot', 'Подушка', 400_000, { accountId: 'kaspi' }),
  goal('car', 'Машина', 600_000),
  goal('trip', 'Япония', 340_000),
  goal('wed', 'Свадьба', 0),
  goal('old', 'Удалённая', 90_000, { deletedAt: T0 }),
]
const LOAN = credit('loan', 'Kaspi кредит', 1_020_000, 0.185, 85_000)
const PHONE = credit('phone', 'Рассрочка iPhone', 224_000, 0, 32_000)

describe('capitalGoals — «Цели · N» в «Счетах» (Р-109)', () => {
  const g = capitalGoals(GOALS, ACCOUNTS)

  it('цели с накопленным; на счёте — с его именем и вне суммы', () => {
    // Квартира, Машина, Япония — вне счетов: 3 200 000 + 600 000 + 340 000 = 4 140 000; Подушка — на Kaspi Gold.
    expect(g.count).toBe(3)
    expect(g.total).toBe(4_140_000)
    expect(g.items.map((x) => [x.name, x.amount, x.accountName])).toEqual([
      ['Квартира', 3_200_000, null],
      ['Машина', 600_000, null],
      ['Япония', 340_000, null],
      ['Подушка', 400_000, 'Kaspi Gold'],
    ])
  })

  it('total = goalSavings; Счета − Кредиты = Капитал до тенге', () => {
    expect(g.total).toBe(goalSavings(GOALS))
    // Счета: 820 000 + 512 000 + 9 400 000 + 4 140 000 = 14 872 000; кредиты 1 244 000; капитал 13 628 000.
    const accounts = ACCOUNTS.reduce((s, a) => s + a.amount, 0) + g.total
    expect(accounts).toBe(14_872_000)
    expect(accounts - (LOAN.principal + PHONE.principal)).toBe(13_628_000)
    expect(netWorth(ACCOUNTS, [LOAN, PHONE], GOALS)).toBe(13_628_000)
  })

  it('все цели на счетах — группа есть, суммы нет', () => {
    const only = capitalGoals([goal('pot', 'Подушка', 400_000, { accountId: 'kaspi' })], ACCOUNTS)
    expect(only).toEqual({ count: 0, total: 0, items: [{ goalId: 'pot', name: 'Подушка', amount: 400_000, accountName: 'Kaspi Gold' }] })
  })
})

describe('debtsOverview — экран «Долги» (Р-110)', () => {
  const payments = [
    // Тело из отметок кредита: 60 000 по графику + 40 000 досрочкой = 100 000; снятая отметка не считается.
    pay('m1', { principal: 60_000 }),
    pay('pp', { kind: 'prepay', amount: 40_000, principal: 40_000, at: '2026-09-20T05:00:00.000Z' }),
    pay('gone', { period: '2026-08', principal: 70_000, deletedAt: T0 }),
  ]
  const state = { credits: [LOAN, PHONE], payments, goals: GOALS }

  it('сумма, строки и полоса — руками', () => {
    const d = debtsOverview(state, KEY)
    expect(d.total).toBe(1_244_000)
    // Рассрочка: 224 000 / 32 000 = 7 платежей → май 2027. Кредит: n = −ln(1 − 0,185/12 · 1 020 000 / 85 000) /
    // ln(1 + 0,185/12) = 0,2046 / 0,01530 ≈ 13,4 → 14 платежей → декабрь 2027.
    expect(d.rows).toEqual([
      // 100 000 / (1 020 000 + 100 000) = 0,0893.
      { creditId: 'loan', name: 'Kaspi кредит', payment: 85_000, rate: 0.185, rateUnknown: false, person: false, endMonth: '2027-12', left: 1_020_000, paidShare: 100_000 / 1_120_000 },
      { creditId: 'phone', name: 'Рассрочка iPhone', payment: 32_000, rate: 0, rateUnknown: false, person: false, endMonth: '2027-05', left: 224_000, paidShare: null },
    ])
    expect(addMonths(KEY, creditOutlook(LOAN).months)).toBe('2027-12')
  })

  it('без плана — последний месяц по графикам', () => {
    expect(debtsOverview(state, KEY).freeMonth).toBe('2027-12')
  })

  it('с планом «Сначала долги» — его прогноз (беспроцентные — по графику), отличается от «без плана»', () => {
    const plan: DebtPlan = {
      id: 'plan', status: 'active', by: 'a', startedAt: '2026-10-01T05:00:00.000Z', endedAt: null, keptGoalIds: [], cushionGoalId: null,
      creditIds: ['loan'], months: 24, lump: 0, forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null }, result: null, updatedAt: T0,
    }
    const withPlan = { ...state, plans: [plan] }
    const forecast = planForecast(plan, withPlan, KEY).debtFreeMonth!
    // Взносы целей (5 × 50 000) идут в кредит: он закрывается раньше декабря 2027, но не раньше рассрочки (май 2027).
    expect(forecast < '2027-12').toBe(true)
    const d = debtsOverview(withPlan, KEY)
    expect(d.freeMonth).toBe(forecast > '2027-05' ? forecast : '2027-05')
    expect(d.freeMonth).not.toBe('2027-12')
    // Рассрочка длиннее прогноза плана — «без долгов» по ней.
    const longPhone = { ...withPlan, credits: [LOAN, credit('phone', 'Рассрочка iPhone', 960_000, 0, 32_000)] }
    expect(debtsOverview(longPhone, KEY).freeMonth).toBe('2029-04') // 960 000 / 32 000 = 30 платежей
    // Отменённый план не считается.
    expect(debtsOverview({ ...state, plans: [{ ...plan, status: 'cancelled' }] }, KEY).freeMonth).toBe('2027-12')
  })

  it('не закрывается или долгов нет — месяца нет', () => {
    expect(debtsOverview({ ...state, credits: [credit('bad', 'Карта', 1_000_000, 0.4, 20_000)] }, KEY).freeMonth).toBeNull()
    expect(debtsOverview({ credits: [{ ...LOAN, principal: 0 }] }, KEY)).toEqual({ total: 0, freeMonth: null, rows: [] })
  })
})

describe('debtsOverview — долг человеку и платёж людям (мелочи ML-15)', () => {
  // Брату 500 000 по 50 000 в месяц без процентов: 500 000 / 50 000 = 10 платежей → август 2027.
  const BRO: Credit = { ...credit('bro', 'Брату', 500_000, 0, 50_000), person: true }
  const MOM: Obligation = { id: 'mom', name: 'Маме', note: '', day: 5, category: 'd4', people: true, versions: [{ from: '2026-01', amount: 100_000 }], updatedAt: T0 }
  const state = { credits: [LOAN, BRO], obligations: [MOM], goals: GOALS }
  const plan: DebtPlan = {
    id: 'plan', status: 'active', by: 'a', startedAt: '2026-10-01T05:00:00.000Z', endedAt: null, keptGoalIds: [], cushionGoalId: null,
    creditIds: ['loan'], months: 24, lump: 0, forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null }, result: null, updatedAt: T0,
  }

  it('долг брату — в сумме и строкой с person, без ставки; платёж маме в сумму не входит', () => {
    const d = debtsOverview(state, KEY)
    // 1 020 000 + 500 000 = 1 520 000; «Маме» 100 000 — не остаток.
    expect(d.total).toBe(1_520_000)
    expect(d.rows.find((r) => r.creditId === 'bro')).toEqual({
      creditId: 'bro', name: 'Брату', payment: 50_000, rate: 0, rateUnknown: false, person: true, endMonth: '2027-08', left: 500_000, paidShare: null,
    })
    expect(d.rows.find((r) => r.creditId === 'loan')!.person).toBe(false)
    // Капитал: 10 732 000 счетов + 4 140 000 целей − 1 520 000 долгов = 13 352 000.
    expect(netWorth(ACCOUNTS, [LOAN, BRO], GOALS)).toBe(13_352_000)
  })

  it('без плана — «без долгов» по последнему графику: кредит декабрь 2027 позже брата', () => {
    expect(debtsOverview(state, KEY).freeMonth).toBe('2027-12')
    // Брату 1 200 000 по 50 000 = 24 платежа → октябрь 2028: «без долгов» по нему.
    expect(debtsOverview({ ...state, credits: [LOAN, { ...BRO, principal: 1_200_000 }] }, KEY).freeMonth).toBe('2028-10')
  })

  it('с планом — брат по своему графику: не раньше августа 2027, прогноз плана — только кредит', () => {
    const withPlan = { ...state, plans: [plan] }
    const forecast = planForecast(plan, withPlan, KEY).debtFreeMonth!
    const d = debtsOverview(withPlan, KEY)
    expect(d.freeMonth).toBe(forecast > '2027-08' ? forecast : '2027-08')
    expect(d.freeMonth! >= '2027-08').toBe(true)
  })

  it('старый документ без person — прежние строки (person: false)', () => {
    const old = debtsOverview({ credits: [LOAN, PHONE] }, KEY)
    expect(old.rows.map((r) => r.person)).toEqual([false, false])
    expect(old.total).toBe(1_244_000)
  })
})

describe('historyMonths — месяцы «Истории» (Р-111)', () => {
  const sal = (id: string, period: string, amount: number): Payment =>
    pay(id, { kind: 'salary', targetId: 'b', period, amount, at: `${period}-25T05:00:00.000Z` })
  const rent = (id: string, period: string): Payment =>
    pay(id, { kind: 'obligation', targetId: 'flat', period, amount: 250_000, at: `${period}-05T05:00:00.000Z` })
  const state: MonthPlanState & { ops: Operation[] } = {
    people: [{ id: 'b', name: 'Аруна', salary: 450_000, payday: 25, updatedAt: T0 }],
    goals: [goal('trip', 'Япония', 340_000, { movements: [{ id: 'mv', date: '2026-09-25T06:00:00.000Z', amount: 40_000, by: 'b' }] })],
    payments: [sal('s7', '2026-07', 450_000), rent('r7', '2026-07'), sal('s8', '2026-08', 450_000), rent('r9', '2026-09'), sal('s9', '2026-09', 450_000)],
    ops: [],
  }

  it('от прошлого месяца назад до первого месяца данных; числа — monthPlanPast', () => {
    const list = historyMonths(state, KEY)
    expect(list.map((m) => m.key)).toEqual(['2026-09', '2026-08', '2026-07'])
    // Сентябрь: 450 000 − 250 000 − 40 000 = 160 000, отложили 40 000; август: 450 000; июль: 200 000.
    expect(list).toEqual([
      { key: '2026-09', left: 160_000, put: 40_000 },
      { key: '2026-08', left: 450_000, put: 0 },
      { key: '2026-07', left: 200_000, put: 0 },
    ])
    for (const m of list) expect({ left: m.left, put: m.put }).toEqual({ left: monthPlanPast(state, m.key).left, put: monthPlanPast(state, m.key).put })
  })

  it('свои операции раньше отметок двигают границу; не больше max; пусто — пусто', () => {
    const op: Operation = { id: 'o', bank: 'kaspi', date: '2026-05-03', amount: -5_000, kind: 'purchase', merchant: 'Magnum', categoryId: null, internal: false }
    expect(historyMonths({ ...state, ops: [op] }, KEY).map((m) => m.key)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05'])
    expect(historyMonths({ ...state, ops: [op] }, KEY, 2).map((m) => m.key)).toEqual(['2026-09', '2026-08'])
    expect(historyMonths({}, KEY)).toEqual([])
    // Данные только этого месяца — прошлых месяцев нет.
    expect(historyMonths({ payments: [sal('s10', KEY, 450_000)] }, KEY)).toEqual([])
  })
})

describe('monthSalaries — строки зарплат «Месяца» и «Капитала» (Р-108)', () => {
  const state: MonthPlanState = {
    people: [
      { id: 'a', name: 'Ильяс', salary: 761_310, payday: 6, updatedAt: T0 },
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 20, updatedAt: T0 },
    ],
    payments: [pay('sa', { kind: 'salary', targetId: 'a', amount: 761_310, at: '2026-10-06T05:00:00.000Z' })],
  }
  const plan = monthPlan(state, { key: KEY, totals: [], spendCategories: [], uploads: [] })

  it('пришла — сумма и время отметки; ждём — день и «можно отметить» по дню', () => {
    const early = monthSalaries(plan, state, { day: 6, key: KEY })
    expect(early.map((s) => [s.person, s.amount, s.came, s.payday, s.at, s.open, s.foreign])).toEqual([
      ['a', 761_310, true, 6, '2026-10-06T05:00:00.000Z', false, false],
      ['b', 450_000, false, 20, null, false, false],
    ])
    // 20-го день Аруны настал — «Пришла» можно отметить; «хватает ли» — из byPerson плана.
    const due = monthSalaries(plan, state, { day: 20, key: KEY })
    expect(due[1].open).toBe(true)
    expect(due.map((s) => s.left)).toEqual(plan.byPerson.map((p) => p.left))
    // Тенговые оклады — без подписи в валюте.
    expect(due.map((s) => s.fx)).toEqual([null, null])
  })

  it('оклад в евро — подпись в валюте: ждём — оклад месяца, пришла — сколько пришло', () => {
    const eur: MonthPlanState = {
      people: [{ id: 'a', name: 'Ильяс', salary: 750_000, payday: 6, updatedAt: T0, salaryVersions: [{ from: '2026-01', amount: 1_500, currency: 'EUR', rate: 506 }] }],
      book: { EUR: { '2026-10-05': 507 } },
      payments: [],
    }
    const waiting = monthSalaries(monthPlan(eur, { key: KEY, totals: [], spendCategories: [], uploads: [] }), eur, { day: 3, key: KEY })
    expect(waiting[0].fx).toEqual({ amount: 1_500, currency: 'EUR' })
    // Пришло 1 400 € (премия меньше) — подпись по отметке.
    const came = { ...eur, payments: [pay('sa', { kind: 'salary', targetId: 'a', amount: 709_800, foreign: 1_400, currency: 'EUR', at: '2026-10-06T05:00:00.000Z' })] }
    const lines = monthSalaries(monthPlan(came, { key: KEY, totals: [], spendCategories: [], uploads: [] }), came, { day: 7, key: KEY })
    expect(lines[0]).toMatchObject({ came: true, foreign: true, fx: { amount: 1_400, currency: 'EUR' } })
  })
})
