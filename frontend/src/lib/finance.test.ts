import { describe, it, expect } from 'vitest'
import {
  annuityPayment,
  annuityMonths,
  annuityTotal,
  rateFromSchedule,
  scheduleMismatch,
  installmentMonths,
  prepayment,
  lumpSum,
  halfOverpayExtra,
  deposit,
  realRate,
  goalMonths,
  goalMonthly,
  goalHave,
  indexedNeed,
  INFLATION,
  emergencyTarget,
  emergencyCoverage,
  debtCost,
  simulateStrategy,
  strategyInputs,
  strategyGain,
  creditSplit,
  creditResplit,
  creditDueAmount,
  creditDueIn,
  countedPayments,
  paidFor,
  accountBalance,
  shiftedBase,
  payableAccounts,
  creditBalance,
  nextObligationDue,
  nextCreditDue,
  lastAccountFor,
  untilPayday,
  monthDues,
  duesTotal,
  lumpPlan,
  prepaySaved,
  budgetAmounts,
  openCredits,
  costliestCredits,
  dueIn,
  groupTotal,
  groupChildren,
  isSubscription,
  keepQuestions,
  KEEP_ASK_DAYS,
} from './finance'
import { plain, money, moneyShort, parseMoney, pct, ratePct } from './money'
import { clean, caretAt, sigBefore } from './num'
import { plural } from './utils'
import { monthKey, parseMonthKey, addMonths, daysInMonth, leadingBlanks, today, atLabel } from '@/lib/dates'
import type { Account, Credit, Goal, Obligation, Payment, Person } from '@/types/finance'

describe('finance.ts — аннуитет и кредитные расчёты', () => {
  it('annuityPayment — корректный расчёт платежа при нулевой и положительной ставке', () => {
    // 0% годовых: 1 200 000 на 12 месяцев = 100 000
    expect(annuityPayment(1_200_000, 0, 12)).toBe(100_000)

    // 1 000 000 на 12 месяцев под 12% годовых (1% в месяц)
    // Формула: P * i * (1+i)^n / ((1+i)^n - 1)
    const p = annuityPayment(1_000_000, 0.12, 12)
    expect(Math.round(p)).toBe(88849)
  })

  it('annuityMonths — расчёт количества месяцев и Infinity при недостаточном платеже', () => {
    // 0% ставка
    expect(annuityMonths(100_000, 0, 10_000)).toBe(10)

    // 1 000 000 под 12% годовых при платеже 88 849 должно быть ~12 месяцев
    const m = annuityMonths(1_000_000, 0.12, 88849)
    expect(Math.round(m)).toBe(12)

    // Платёж меньше начисленных процентов: 1 000 000 * (0.12 / 12) = 10 000 в месяц
    expect(annuityMonths(1_000_000, 0.12, 9_000)).toBe(Infinity)
  })

  it('annuityTotal — общая сумма выплат', () => {
    const total = annuityTotal(1_000_000, 0.12, 88849)
    expect(total).toBeCloseTo(88849 * 12, -1)
    expect(annuityTotal(1_000_000, 0.12, 5_000)).toBe(Infinity)
  })

  it('rateFromSchedule — подбор процентной ставки из графика платежей', () => {
    // Если платежа не хватает даже на тело долга:
    expect(rateFromSchedule(1_200_000, 50_000, 12)).toBeNull()
    expect(rateFromSchedule(-100, 10, 10)).toBeNull()

    // 1 000 000, платёж 88 849, 12 месяцев -> ставка должна быть ~12% (0.12)
    const rate = rateFromSchedule(1_000_000, 88849, 12)
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo(0.12, 3)
  })

  it('prepayment — расчёт выгоды досрочного погашения увеличением ежемесячного платежа', () => {
    const prep = prepayment(1_000_000, 0.18, 50_000, 20_000)
    expect(prep.monthsNow).toBeGreaterThan(prep.monthsAfter)
    expect(prep.monthsSaved).toBe(prep.monthsNow - prep.monthsAfter)
    expect(prep.saved).toBeGreaterThan(0)
  })

  it('lumpSum — разовое досрочное погашение', () => {
    const res = lumpSum(1_000_000, 0.18, 50_000, 300_000)
    expect(res.monthsAfter).toBeLessThan(res.monthsNow)
    expect(res.saved).toBeGreaterThan(0)

    // Если разовый взнос больше или равен телу долга: долг сразу закрывается
    const closeRes = lumpSum(500_000, 0.18, 30_000, 600_000)
    expect(closeRes.monthsAfter).toBe(0)
    expect(closeRes.overpayAfter).toBe(0)
  })

  it('halfOverpayExtra — подбор добавки для снятия половины переплаты', () => {
    const extra = halfOverpayExtra(500_000, 0.24, 30_000, 1000)
    expect(extra).not.toBeNull()
    expect(extra!).toBeGreaterThan(0)
    expect(extra! % 1000).toBe(0)
  })
})

describe('finance.ts — депозиты, цели, подушка безопасности', () => {
  it('deposit — простые и капитализируемые проценты', () => {
    // Без капитализации
    const simple = deposit({
      principal: 1_000_000,
      annualRate: 0.15,
      months: 12,
      monthlyTopUp: 0,
      capitalize: false,
    })
    expect(simple.contributed).toBe(1_000_000)
    expect(Math.round(simple.interest)).toBe(150_000)
    expect(simple.future).toBe(1_150_000)
    expect(simple.effectiveRate).toBe(0.15)

    // С ежемесячной капитализацией
    const compound = deposit({
      principal: 1_000_000,
      annualRate: 0.12,
      months: 12,
      monthlyTopUp: 0,
      capitalize: true,
    })
    expect(compound.interest).toBeGreaterThan(120_000)
    expect(compound.effectiveRate).toBeGreaterThan(0.12)
  })

  it('realRate — расчёт реальной доходности по формуле Фишера', () => {
    // При ставке 15% и инфляции 10%: (1 + 0.15) / (1 + 0.10) - 1 ≈ 4.545%
    const r = realRate(0.15, 0.1)
    expect(r).toBeCloseTo(0.04545, 4)
  })

  it('goalMonths и goalMonthly — планирование накоплений на цели', () => {
    expect(goalMonths(1_000_000, 200_000)).toBe(5)
    expect(goalMonths(1_000_000, 0)).toBe(Infinity)

    expect(goalMonthly(1_000_000, 5)).toBe(200_000)
    expect(goalMonthly(1_000_000, 0)).toBe(1_000_000)
  })

  it('emergencyTarget и emergencyCoverage — целевой размер и покрытие подушки', () => {
    // Обязательные расходы 400 000, доход партнёра 250 000 (дефицит 150 000)
    // floor 3 месяца = 1 200 000; scenario 6 месяцев = 900 000 -> target = max(1.2M, 900k) = 1.2M
    const target = emergencyTarget({
      mandatoryMonthly: 400_000,
      partnerIncome: 250_000,
      floorMonths: 3,
      scenarioMonths: 6,
    })
    expect(target).toBe(1_200_000)

    const coverage = emergencyCoverage(1_200_000, 400_000)
    expect(coverage).toBe(3)
    expect(emergencyCoverage(1_000_000, 0)).toBe(0)
  })

  it('debtCost — анализ стоимости долга', () => {
    const cost = debtCost(1_000_000, 0.24, 50_000)
    expect(cost.monthlyInterest).toBe(20_000)
    expect(cost.interestShare).toBe(20_000 / 50_000)
    expect(cost.closes).toBe(true)
  })

  it('simulateStrategy — лавинное погашение долгов против базового накопления', () => {
    const debts = [
      { principal: 300_000, annualRate: 0.30, payment: 30_000 },
      { principal: 500_000, annualRate: 0.18, payment: 25_000 },
      { principal: 200_000, annualRate: 0, payment: 20_000 }, // рассрочка 0%
    ]

    // Базовое накопление (payDebts: false)
    const base = simulateStrategy({
      debts,
      saving: 50_000,
      keep: 20_000,
      payDebts: false,
      start: 100_000,
      months: 24,
    })

    // Стратегия «сначала долги» (payDebts: true)
    const avalanche = simulateStrategy({
      debts,
      saving: 50_000,
      keep: 20_000,
      payDebts: true,
      start: 100_000,
      months: 24,
    })

    // При лавинном погашении проценты, отданные банку, должны быть меньше
    expect(avalanche.interestTotal).toBeLessThan(base.interestTotal)
    // Итоговый net капитал (накопления - долг) должен быть выше
    expect(avalanche.net).toBeGreaterThan(base.net)
  })
})

describe('money.ts & num.ts & dates.ts — форматирование и парсинг', () => {
  it('money.ts форматирование', () => {
    const NB = ' '
    expect(plain(1050000)).toBe(`1${NB}050${NB}000`)
    expect(money(1050000)).toBe(`1${NB}050${NB}000${NB}₸`)
    expect(moneyShort(1200000)).toBe(`1,2${NB}млн${NB}₸`)
    expect(moneyShort(250000)).toBe(`250${NB}тыс.${NB}₸`)
    expect(parseMoney(`1${NB}050${NB}000 ₸`)).toBe(1050000)
    expect(pct(25, 100)).toBe(25)
    expect(ratePct(0.165, 1)).toBe('16,5%')
  })

  it('utils.ts plural: склонение слова при числе', () => {
    const w = (n: number) => plural(n, 'платёж', 'платежа', 'платежей')
    expect([1, 21, 101].map(w)).toEqual(['платёж', 'платёж', 'платёж'])
    expect([2, 4, 24, 102].map(w)).toEqual(['платежа', 'платежа', 'платежа', 'платежа'])
    expect([0, 5, 11, 12, 14, 18, 111, 25].map(w)).toEqual(Array(8).fill('платежей'))
  })

  it('num.ts разбор полей ввода (clean, caretAt, sigBefore)', () => {
    const NB = ' '
    expect(clean('05', 'money')).toBe('5')
    expect(clean('0', 'money')).toBe('0')
    expect(clean('250000', 'money')).toBe(`250${NB}000`)
    expect(clean('16.5', 'rate')).toBe('16,5')
    expect(clean('16,5,3', 'rate')).toBe('16,53')
    expect(sigBefore('12')).toBe(2)
    expect(caretAt(clean('12000', 'money'), 2)).toBe(2)
  })

  it('dates.ts даты и календарь', () => {
    expect(monthKey(new Date(2026, 8, 1))).toBe('2026-09')
    const { year, month } = parseMonthKey('2026-09')
    expect(year).toBe(2026)
    expect(month).toBe(8)
    expect(addMonths('2026-09', 3)).toBe('2026-12')
    expect(daysInMonth('2026-02')).toBe(28)
    expect(leadingBlanks('2026-09')).toBeGreaterThanOrEqual(0)
  })
})

describe('RP-06 — отметки оплат и остатки из них', () => {
  const T0 = '2026-09-01T00:00:00Z'
  const pay = (p: Partial<Payment> & Pick<Payment, 'id' | 'kind' | 'targetId' | 'period' | 'amount'>): Payment => ({
    accountId: 'card',
    by: 'a',
    at: '2026-09-05T10:00:00Z',
    updatedAt: '2026-09-05T10:00:00Z',
    ...p,
  })
  const card: Account = { id: 'card', name: 'Kaspi', note: '', amount: 500_000, kind: 'card', updatedAt: T0 }
  const rent: Obligation = {
    id: 'rent',
    name: 'Аренда',
    note: '',
    day: 5,
    category: 'd1',
    versions: [{ from: '2000-01', amount: 220_000 }],
    updatedAt: T0,
  }
  // Живой случай: кредит под 33% годовых.
  const loan: Credit = {
    id: 'loan',
    name: 'Кредит',
    note: '',
    principal: 1_000_000,
    annualRate: 0.33,
    payment: 58_000,
    day: 15,
    updatedAt: T0,
  }

  it('разбивка аннуитета: тело по графику = исходный долг, всё целое, последний платёж не больше остатка с процентами', () => {
    const P0 = 1_000_000
    const payment = Math.round(annuityPayment(P0, 0.33, 24))
    let left = P0
    let bodies = 0
    const amounts: number[] = []
    for (let i = 0; i < 100 && left > 0; i++) {
      const s = creditSplit(left, 0.33, payment)
      for (const v of [s.amount, s.interest, s.body]) expect(Number.isInteger(v)).toBe(true)
      expect(s.interest + s.body).toBe(s.amount)
      bodies += s.body
      left -= s.body
      amounts.push(s.amount)
    }
    expect(left).toBe(0)
    expect(bodies).toBe(P0)
    // Округление платежа до тенге сдвигает хвост не больше чем на один маленький платёж.
    expect(amounts.length).toBeGreaterThanOrEqual(24)
    expect(amounts.length).toBeLessThanOrEqual(25)
    expect(amounts.slice(0, -1).every((a) => a === payment)).toBe(true)
    expect(amounts[amounts.length - 1]).toBeLessThanOrEqual(payment)

    // Первый месяц: проценты = 1 000 000 × 0,33 / 12 = 27 500.
    expect(creditSplit(P0, 0.33, 58_000)).toEqual({ amount: 58_000, interest: 27_500, body: 30_500 })
  })

  it('разбивка: платёж меньше процентов тело не двигает; рассрочка 0% — всё в тело; больше долга не берётся', () => {
    expect(creditSplit(1_000_000, 0.33, 20_000)).toEqual({ amount: 20_000, interest: 20_000, body: 0 })
    expect(creditSplit(300_000, 0, 50_000)).toEqual({ amount: 50_000, interest: 0, body: 50_000 })
    // Остаток 10 000 под 12%: проценты 100, закрывающий платёж 10 100, а не 50 000.
    expect(creditSplit(10_000, 0.12, 50_000)).toEqual({ amount: 10_100, interest: 100, body: 10_000 })
    expect(creditDueAmount({ ...loan, principal: 10_000, annualRate: 0.12 })).toBe(10_100)
  })

  it('двойная отметка одной пары считается один раз — ранняя, при равенстве — меньший id; досрочки не схлопываются', () => {
    const late = pay({ id: 'a1', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000, at: '2026-09-05T10:05:00Z' })
    const early = pay({ id: 'z9', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000, at: '2026-09-05T10:00:00Z' })
    expect(countedPayments([late, early]).map((p) => p.id)).toEqual(['z9'])
    expect(countedPayments([early, late]).map((p) => p.id)).toEqual(['z9'])

    const tieB = { ...late, id: 'b', at: early.at }
    expect(countedPayments([early, tieB]).map((p) => p.id)).toEqual(['b'])

    const pre1 = pay({ id: 'p1', kind: 'prepay', targetId: 'loan', period: '2026-09', amount: 100_000, principal: 100_000 })
    const pre2 = pay({ id: 'p2', kind: 'prepay', targetId: 'loan', period: '2026-09', amount: 50_000, principal: 50_000 })
    expect(countedPayments([pre1, pre2])).toHaveLength(2)

    expect(paidFor([late, early], 'obligation', 'rent', '2026-09')?.id).toBe('z9')
    expect(paidFor([late, early], 'obligation', 'rent', '2026-10')).toBeNull()
  })

  it('остаток счёта: база минус списания после сверки; снятая отметка возвращает деньги; пара — один раз', () => {
    const r = pay({ id: 'r', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000 })
    const l = pay({ id: 'l', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, principal: 30_500 })
    expect(accountBalance(card, [])).toBe(500_000)
    expect(accountBalance(card, [r, l])).toBe(222_000)
    // Отметка с другого телефона той же пары — не второе списание.
    expect(accountBalance(card, [r, { ...r, id: 'r2', at: '2026-09-05T11:00:00Z' }])).toBe(280_000)
    // Надгробие — деньги вернулись.
    expect(accountBalance(card, [{ ...r, deletedAt: '2026-09-06T00:00:00Z' }])).toBe(500_000)
    // «Не списывать» и чужой счёт остаток не трогают.
    expect(accountBalance(card, [{ ...r, accountId: null }, { ...l, accountId: 'other' }])).toBe(500_000)
    // Сверка после отметки: отметка уже в введённой сумме.
    expect(accountBalance({ ...card, amountSetAt: '2026-09-05T12:00:00Z' }, [r])).toBe(500_000)
    expect(accountBalance({ ...card, amountSetAt: '2026-09-05T09:00:00Z' }, [r])).toBe(280_000)
  })

  it('двойная пара, где ранняя отметка до сверки, а поздняя после, — не списывается вовсе', () => {
    const early = pay({ id: 'e', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000, at: '2026-09-05T10:00:00Z' })
    const late = { ...early, id: 'l', at: '2026-09-05T12:00:00Z' }
    expect(accountBalance({ ...card, amountSetAt: '2026-09-05T11:00:00Z' }, [early, late])).toBe(500_000)
  })

  it('остаток долга: база минус тело по отметкам и досрочкам после ручного ввода', () => {
    const m = pay({ id: 'm', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, principal: 30_500 })
    const pre = pay({ id: 'p', kind: 'prepay', targetId: 'loan', period: '2026-09', amount: 100_000, principal: 100_000 })
    const rentMark = pay({ id: 'r', kind: 'obligation', targetId: 'loan', period: '2026-09', amount: 1 })
    expect(creditBalance(loan, [m])).toBe(969_500)
    expect(creditBalance(loan, [m, pre, rentMark])).toBe(869_500)
    expect(creditBalance(loan, [{ ...m, deletedAt: '2026-09-06T00:00:00Z' }])).toBe(1_000_000)
    expect(creditBalance({ ...loan, principalSetAt: '2026-09-06T00:00:00Z' }, [m, pre])).toBe(1_000_000)
    expect(creditBalance({ ...loan, principal: 20_000 }, [pre])).toBe(0)
  })

  it('следующий платёж: ежемесячный, годовой, кредит, короткий месяц', () => {
    const now = { day: 20, key: '2026-09' }
    expect(nextObligationDue(rent, [], now)).toEqual({
      kind: 'obligation', targetId: 'rent', period: '2026-09', day: 5, amount: 220_000,
    })
    const paidSep = pay({ id: 'r', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000 })
    expect(nextObligationDue(rent, [paidSep], now)?.period).toBe('2026-10')
    // Снятая отметка — снова этот месяц.
    expect(nextObligationDue(rent, [{ ...paidSep, deletedAt: T0 }], now)?.period).toBe('2026-09')

    const insurance: Obligation = { ...rent, id: 'ins', every: 'year', month: 11, day: 31, versions: [{ from: '2000-01', amount: 90_000 }] }
    expect(nextObligationDue(insurance, [], now)).toMatchObject({ period: '2026-11', day: 30, amount: 90_000 })
    const paidNov = pay({ id: 'i', kind: 'obligation', targetId: 'ins', period: '2026-11', amount: 90_000 })
    expect(nextObligationDue(insurance, [paidNov], now)?.period).toBe('2027-11')

    const feb = { ...rent, day: 31 }
    expect(nextObligationDue(feb, [], { day: 1, key: '2027-02' })?.day).toBe(28)

    // Сумма — по графику месяца платежа: повышение с октября.
    const raised = { ...rent, versions: [...rent.versions, { from: '2026-10', amount: 250_000 }] }
    expect(nextObligationDue(raised, [paidSep], now)?.amount).toBe(250_000)

    expect(nextCreditDue(loan, [], now)).toEqual({
      kind: 'credit', targetId: 'loan', period: '2026-09', day: 15, amount: 58_000,
    })
    const paidLoan = pay({ id: 'l', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, principal: 30_500 })
    expect(nextCreditDue(loan, [paidLoan], now)?.period).toBe('2026-10')
    expect(nextCreditDue({ ...loan, principal: 0 }, [], now)).toBeNull()
    // Последний платёж: 10 000 + 10 000 × 0,33 / 12 = 10 275.
    expect(nextCreditDue({ ...loan, principal: 10_000 }, [], now)?.amount).toBe(10_275)
  })

  it('счёт по умолчанию — прошлой оплаты этой цели; «не списывать» запоминается; нет счёта — спросить', () => {
    const accounts = [card, { ...card, id: 'cash', kind: 'cash' as const }]
    const r1 = pay({ id: 'r1', kind: 'obligation', targetId: 'rent', period: '2026-08', amount: 1, accountId: 'cash', at: '2026-08-05T10:00:00Z' })
    const r2 = pay({ id: 'r2', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 1, accountId: 'card', at: '2026-09-05T10:00:00Z' })
    expect(lastAccountFor([], 'rent', accounts)).toBeUndefined()
    expect(lastAccountFor([r1, r2], 'rent', accounts)).toBe('card')
    expect(lastAccountFor([r2, r1], 'rent', accounts)).toBe('card')
    expect(lastAccountFor([r1, { ...r2, deletedAt: T0 }], 'rent', accounts)).toBe('cash')
    expect(lastAccountFor([{ ...r2, accountId: null }], 'rent', accounts)).toBeNull()
    // Счёт удалён или это личный счёт партнёра — спросить заново.
    expect(lastAccountFor([r2], 'rent', [{ ...card, deletedAt: T0 }])).toBeUndefined()
    expect(lastAccountFor([r2], 'rent', [])).toBeUndefined()
    // Досрочка — тоже оплата этого кредита.
    const pre = pay({ id: 'p', kind: 'prepay', targetId: 'loan', period: '2026-09', amount: 1, accountId: 'cash' })
    expect(lastAccountFor([pre], 'loan', accounts)).toBe('cash')
  })

  it('до зарплаты: оплаченное в своём месяце не входит, счёт — с остатком из отметок', () => {
    const people: Person[] = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 20, updatedAt: T0 }]
    const now = { day: 3, key: '2026-09' }
    const before = untilPayday({ people, obligations: [rent], credits: [loan], accounts: [card] }, now)!
    expect(before.due.map((x) => x.id)).toEqual(['rent', 'loan'])
    expect(before.dueTotal).toBe(278_000)
    expect(before.shortfall).toBe(222_000)

    const r = pay({ id: 'r', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000 })
    const payments = [r]
    const after = untilPayday(
      {
        people,
        obligations: [rent],
        credits: [loan],
        accounts: [{ ...card, amount: accountBalance(card, payments) }],
        payments,
      },
      now,
    )!
    // Аренда уже ушла со счёта: в «заплатить» её нет, а счёт уменьшен — запас тот же.
    expect(after.due.map((x) => x.id)).toEqual(['loan'])
    expect(after.onAccounts).toBe(280_000)
    expect(after.shortfall).toBe(before.shortfall)

    // Отметка прошлого месяца не снимает платёж этого; закрытый кредит платежа не ждёт.
    const old = { ...r, period: '2026-08' }
    const closed = untilPayday(
      { people, obligations: [rent], credits: [{ ...loan, principal: 0 }], accounts: [card], payments: [old] },
      now,
    )!
    expect(closed.due.map((x) => x.id)).toEqual(['rent'])
  })

  it('правка отметки кредита: проценты — из исходной записи, тело = сумма − проценты, не больше остатка', () => {
    // Отметка сентября: 58 000, из них тело 30 500 → проценты 27 500.
    const old = pay({ id: 'l', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, principal: 30_500 })
    // Остаток без этой отметки — 1 000 000: заплатили 60 000, тело 32 500.
    expect(creditResplit(old, 60_000, 1_000_000)).toEqual({ amount: 60_000, interest: 27_500, body: 32_500 })
    // Остаток с тех пор уменьшили отметки следующих месяцев — проценты не пересчитываются
    // (creditSplit от 900 000 дал бы 24 750).
    expect(creditResplit(old, 60_000, 900_000)).toEqual({ amount: 60_000, interest: 27_500, body: 32_500 })
    expect(creditSplit(900_000, 0.33, 60_000).interest).toBe(24_750)
    // Сумма больше остатка с процентами урезается до закрывающей.
    expect(creditResplit(old, 60_000, 10_000)).toEqual({ amount: 37_500, interest: 27_500, body: 10_000 })
    // Сумма меньше процентов — тело 0, всё ушло банку.
    expect(creditResplit(old, 20_000, 1_000_000)).toEqual({ amount: 20_000, interest: 20_000, body: 0 })
    // Долга уже нет: в тело ничего, берутся только проценты месяца.
    expect(creditResplit(old, 58_000, 0)).toEqual({ amount: 27_500, interest: 27_500, body: 0 })
    // Дробная сумма округляется до тенге.
    expect(creditResplit(old, 60_000.4, 1_000_000)).toEqual({ amount: 60_000, interest: 27_500, body: 32_500 })
  })

  it('сдвиг остатка: база ± дельта, якорь прежний, видимый остаток ниже нуля не уводится', () => {
    expect(shiftedBase(card, [], 100_000)).toBe(600_000)
    expect(shiftedBase(card, [], -100_000)).toBe(400_000)
    expect(shiftedBase(card, [], 100_000.4)).toBe(600_000)

    // Отметка после якоря: видимый 280 000 — снять больше нельзя, база уходит ровно в видимый 0.
    const anchored = { ...card, amountSetAt: '2026-09-05T09:00:00Z' }
    const r = pay({ id: 'r', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000 })
    expect(accountBalance(anchored, [r])).toBe(280_000)
    expect(shiftedBase(anchored, [r], -300_000)).toBe(220_000)
    expect(accountBalance({ ...anchored, amount: shiftedBase(anchored, [r], -300_000) }, [r])).toBe(0)
    expect(shiftedBase(anchored, [r], -80_000)).toBe(420_000)
    expect(accountBalance({ ...anchored, amount: 420_000 }, [r])).toBe(200_000)

    // Отметка до якоря в видимый не входит (уже в базе) и сдвигу не мешает: снять можно все 500 000.
    const beforeAnchor = { ...r, at: '2026-09-05T08:00:00Z' }
    expect(accountBalance(anchored, [beforeAnchor])).toBe(500_000)
    expect(shiftedBase(anchored, [beforeAnchor], -600_000)).toBe(0)
    expect(shiftedBase(anchored, [beforeAnchor], 50_000)).toBe(550_000)
    // Снятие такой отметки остатка не меняет — и после сдвига тоже.
    expect(accountBalance({ ...anchored, amount: 550_000 }, [{ ...beforeAnchor, deletedAt: T0 }])).toBe(550_000)

    // Видимый уже в минусе: списать нельзя ничего, пополнить — можно.
    const low = { ...card, amount: 100_000 }
    expect(accountBalance(low, [r])).toBe(-120_000)
    expect(shiftedBase(low, [r], -50_000)).toBe(100_000)
    expect(shiftedBase(low, [r], 50_000)).toBe(150_000)
  })

  it('закрытый кредит платежа не ждёт — кроме месяца, где его закрыли; платёж 0 — не ждёт', () => {
    // Последний платёж сентября закрыл долг 10 000 под 12%: 10 100, тело 10 000.
    const small = { ...loan, principal: 10_000, annualRate: 0.12 }
    const last = pay({ id: 'x', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 10_100, principal: 10_000 })
    const closed = { ...small, principal: creditBalance(small, [last]) }
    expect(closed.principal).toBe(0)
    expect(creditDueAmount(closed)).toBe(0)
    expect(creditDueIn(closed, [last], '2026-09')).toBe(true)
    expect(creditDueIn(closed, [last], '2026-10')).toBe(false)
    expect(creditDueIn(closed, [last], '2026-08')).toBe(false)
    expect(nextCreditDue(closed, [last], { day: 20, key: '2026-09' })).toBeNull()
    // Снятая отметка — долг снова жив и ждёт.
    const undone = [{ ...last, deletedAt: T0 }]
    expect(creditDueIn({ ...small, principal: creditBalance(small, undone) }, undone, '2026-09')).toBe(true)

    // В «до зарплаты» месяца закрытия — в оплаченном, не в «заплатить».
    const people: Person[] = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 20, updatedAt: T0 }]
    const sep = untilPayday({ people, credits: [closed], payments: [last] }, { day: 3, key: '2026-09' })!
    expect(sep.due).toEqual([])
    expect(sep.paid.map((x) => [x.id, x.value])).toEqual([['loan', 10_100]])
    const oct = untilPayday({ people, credits: [closed], payments: [last] }, { day: 3, key: '2026-10' })!
    expect([...oct.due, ...oct.paid]).toEqual([])

    // Остаток есть, а платёж 0 (не заполнен): ждать нечего.
    const noPay = { ...loan, payment: 0 }
    expect(creditDueAmount(noPay)).toBe(0)
    expect(creditDueIn(noPay, [], '2026-09')).toBe(false)
    expect(nextCreditDue(noPay, [], { day: 20, key: '2026-09' })).toBeNull()
  })

  it('остаток долга — только по отметкам кредита и досрочкам: отметка обязательства с тем же targetId не считается', () => {
    const m = pay({ id: 'm', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, principal: 30_500 })
    // Запись обязательства с телом — битая или чужая: остаток не двигает.
    const stray = pay({ id: 'o', kind: 'obligation', targetId: 'loan', period: '2026-09', amount: 50_000, principal: 50_000 })
    expect(creditBalance(loan, [stray])).toBe(1_000_000)
    expect(creditBalance(loan, [m, stray])).toBe(969_500)
    const pre = pay({ id: 'p', kind: 'prepay', targetId: 'loan', period: '2026-09', amount: 100_000, principal: 100_000 })
    expect(creditBalance(loan, [m, stray, pre])).toBe(869_500)
  })

  it('до зарплаты через месяц: платёж следующего месяца, оплаченный заранее, — в paid, не в due и не в сумме', () => {
    // Сегодня 20 сентября, зарплата 5-го: окно — остаток сентября и октябрь до 5-го.
    const people: Person[] = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 5, updatedAt: T0 }]
    const lateLoan = { ...loan, day: 25 }
    const now = { day: 20, key: '2026-09' }
    const before = untilPayday({ people, obligations: [rent], credits: [lateLoan], accounts: [card] }, now)!
    expect(before.key).toBe('2026-10')
    expect(before.due.map((x) => x.id)).toEqual(['loan', 'rent@next'])
    expect(before.dueTotal).toBe(278_000)

    // Аренду октября заплатили заранее, другой суммой.
    const early = pay({ id: 'r', kind: 'obligation', targetId: 'rent', period: '2026-10', amount: 215_000 })
    const after = untilPayday({ people, obligations: [rent], credits: [lateLoan], accounts: [card], payments: [early] }, now)!
    expect(after.due.map((x) => x.id)).toEqual(['loan'])
    expect(after.paid.map((x) => [x.id, x.when, x.value])).toEqual([['rent@next', '2026-10', 215_000]])
    expect(after.dueTotal).toBe(58_000)
    // Отметка сентября аренду октября не снимает.
    const sepMark = { ...early, period: '2026-09' }
    expect(untilPayday({ people, obligations: [rent], credits: [lateLoan], payments: [sepMark] }, now)!.due.map((x) => x.id)).toEqual(['loan', 'rent@next'])
  })

  it('платежи месяца (monthDues): одно правило для «до зарплаты», Бюджета и «Впереди»; итог = сумма строк', () => {
    const yearly: Obligation = { ...rent, id: 'ivi', name: 'Иви', every: 'year', month: 10, versions: [{ from: '2000-01', amount: 12_000 }] }
    const group: Obligation = { ...rent, id: 'fun', name: 'Досуг', group: true, versions: [{ from: '2000-01', amount: 9_999 }] }
    const gone: Obligation = { ...rent, id: 'old', deletedAt: T0 }
    const small = { ...loan, id: 'small', principal: 10_000, annualRate: 0.12 }
    const obligations = [rent, yearly, group, gone]
    const credits = [loan, small]

    // Сентябрь без отметок: годовая (октябрь), группа и удалённое — не платежи месяца.
    const sep = monthDues({ obligations, credits }, '2026-09')
    expect(sep.map((d) => [d.kind, d.targetId, d.amount, d.paid])).toEqual([
      ['obligation', 'rent', 220_000, false],
      ['credit', 'loan', 58_000, false],
      // Последний платёж — остаток с процентами, а не полный платёж.
      ['credit', 'small', 10_100, false],
    ])
    expect(duesTotal(sep)).toBe(288_100)
    expect(monthDues({ obligations, credits }, '2026-10').map((d) => d.targetId)).toEqual(['rent', 'ivi', 'loan', 'small'])

    // Отмечено другой суммой — сумма из отметки; кредит, закрытый этим месяцем, остаётся оплаченным.
    const r = pay({ id: 'r', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 215_000 })
    const last = pay({ id: 'x', kind: 'credit', targetId: 'small', period: '2026-09', amount: 10_100, principal: 10_000 })
    const payments = [r, last]
    const closed = [loan, { ...small, principal: creditBalance(small, payments) }]
    const paid = monthDues({ obligations, credits: closed, payments }, '2026-09')
    expect(paid.map((d) => [d.targetId, d.amount, d.paid])).toEqual([
      ['rent', 215_000, true],
      ['loan', 58_000, false],
      ['small', 10_100, true],
    ])
    expect(duesTotal(paid)).toBe(283_100)
    // В октябре закрытого кредита уже нет.
    expect(monthDues({ obligations, credits: closed, payments }, '2026-10').map((d) => d.targetId)).toEqual(['rent', 'ivi', 'loan'])

    // «До зарплаты» строится на том же правиле: окно с 1-го по 20-е сентября — все строки месяца.
    const people: Person[] = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 20, updatedAt: T0 }]
    const payday = untilPayday({ people, obligations, credits: closed, payments }, { day: 1, key: '2026-09' })!
    expect([...payday.due, ...payday.paid].map((x) => [x.targetId, x.value, x.paid])).toEqual(
      paid.map((d) => [d.targetId, d.amount, d.paid]).sort((a, b) => Number(a[2]) - Number(b[2])),
    )
  })

  it('счета для оплаты — только живые в тенге; день отметки — по Алматы', () => {
    const accounts: Account[] = [
      card,
      { ...card, id: 'kzt', currency: 'KZT' },
      { ...card, id: 'usd', currency: 'USD' },
      { ...card, id: 'gone', deletedAt: T0 },
    ]
    expect(payableAccounts(accounts).map((a) => a.id)).toEqual(['card', 'kzt'])
    expect(payableAccounts([])).toEqual([])

    // 19:30 UTC 30 сентября — 00:30 1 октября в Алматы; 18:30 — ещё 23:30 30-го.
    expect(atLabel('2026-09-30T19:30:00Z')).toBe('1 октября')
    expect(atLabel('2026-09-30T18:30:00Z')).toBe('30 сентября')
  })

  it('граница месяца — по Алматы (UTC+5), а не по поясу телефона', () => {
    // 23:30 UTC 31 августа — в Алматы уже 04:30 1 сентября.
    const lateUtc = new Date(Date.UTC(2026, 7, 31, 23, 30))
    expect(monthKey(lateUtc)).toBe('2026-09')
    expect(today(lateUtc)).toEqual({ day: 1, key: '2026-09' })
    // 18:59 UTC — 23:59 в Алматы, ещё август; через минуту — сентябрь.
    expect(today(new Date(Date.UTC(2026, 7, 31, 18, 59)))).toEqual({ day: 31, key: '2026-08' })
    expect(monthKey(new Date(Date.UTC(2026, 7, 31, 19, 0)))).toBe('2026-09')
    // Новый год.
    expect(monthKey(new Date(Date.UTC(2026, 11, 31, 20, 0)))).toBe('2027-01')
  })
})

describe('RP-08 — применить досрочку', () => {
  // Живой случай: кредит 1 000 000 под 33% годовых, платёж 58 000, разовый взнос 200 000.
  const P = 1_000_000
  const R = 0.33
  const PAY = 58_000
  const LUMP = 200_000

  /**
   * Независимая сверка: помесячный график, как его ведёт приложение, — `creditSplit`
   * каждый месяц (проценты от остатка, округлённые до тенге, последний платёж —
   * остаток с процентами) до закрытия долга. Возвращает проценты банку и число платежей.
   */
  function schedule(principal: number, rate: number, payment: number) {
    let left = principal
    let interest = 0
    let n = 0
    for (; n < 1000 && left > 0; n++) {
      const s = creditSplit(left, rate, payment)
      interest += s.interest
      left -= s.body
    }
    return { interest, n }
  }

  /**
   * Экономия по графику: проценты до взноса минус проценты после.
   *
   * `lumpPlan.saved` считается в непрерывных месяцах (платёж × дробный срок − долг):
   * последний неполный месяц там — доля платежа, а в графике — остаток с процентами
   * за целый месяц; плюс проценты графика округляются до тенге каждый месяц. Поэтому
   * до тенге они не совпадают. Допуск — для входов этого файла (живой случай и
   * крайние ниже): на них расхождение ≤ 103 ₸ (≤ 0,18%), допуск — 0,3% и не больше
   * 150 ₸, больше — значит сломана формула. Это не общее свойство `saved`: на
   * реальных кредитах расхождение доходит до нескольких процентов, на коротких и
   * дорогих — больше (JSDoc `lumpPlan`).
   */
  function expectSavedMatchesSchedule(P0: number, rate: number, pay: number, plan: { left: number; payment: number; saved: number }) {
    const byMonths = schedule(P0, rate, pay).interest - schedule(plan.left, rate, plan.payment).interest
    const diff = Math.abs(byMonths - plan.saved)
    expect(diff).toBeLessThanOrEqual(150)
    expect(diff / plan.saved).toBeLessThan(0.003)
  }

  it('«снизить платёж»: новый платёж = аннуитет на остаток и прежний срок; экономия ≥ 0 и меньше, чем у «сократить срок»', () => {
    const n = annuityMonths(P, R, PAY)
    const lower = lumpPlan(P, R, PAY, LUMP, 'payment')!
    const shorter = lumpPlan(P, R, PAY, LUMP, 'term')!

    expect(lower.left).toBe(800_000)
    expect(lower.payment).toBe(Math.ceil((PAY * 800_000) / P))
    // При том же сроке платёж пропорционален долгу: 58 000 × 0,8.
    expect(lower.payment).toBe(46_400)
    expect(lower.months).toBe(Math.ceil(n))
    expect(lower.months).toBe(lower.monthsBefore)

    expect(shorter.payment).toBe(PAY)
    expect(shorter.months).toBeLessThan(shorter.monthsBefore)
    expect(shorter.months).toBe(Math.ceil(annuityMonths(800_000, R, PAY)))
    expect(shorter.saved).toBe(Math.round(lumpSum(P, R, PAY, LUMP).saved))

    expect(lower.saved).toBeGreaterThanOrEqual(0)
    expect(lower.saved).toBeLessThan(shorter.saved)
    for (const plan of [lower, shorter]) {
      for (const v of Object.values(plan)) expect(Number.isInteger(v)).toBe(true)
    }

    // Сверка помесячным графиком: экономия — разница процентов до и после (допуск — у хелпера).
    expectSavedMatchesSchedule(P, R, PAY, shorter)
    expectSavedMatchesSchedule(P, R, PAY, lower)
  })

  /** Непрерывный срок и переплата — формулой, без `annuityMonths`/`lumpSum`. */
  function continuous(principal: number, rate: number, payment: number) {
    const i = rate / 12
    const n = -Math.log(1 - (principal * i) / payment) / Math.log(1 + i)
    return { n, overpay: payment * n - principal }
  }

  it('живой случай до тенге: «сократить срок» 200 000 — 18 платежей вместо 24, не отдадим 154 457', () => {
    expect(lumpPlan(P, R, PAY, LUMP, 'term')).toEqual({
      paid: 200_000, left: 800_000, payment: 58_000, months: 18, monthsBefore: 24, saved: 154_457,
    })
    // Независимо: экономия — разница переплат в непрерывных месяцах при том же платеже.
    const before = continuous(P, R, PAY)
    const after = continuous(800_000, R, PAY)
    expect(Math.ceil(before.n)).toBe(24)
    expect(Math.ceil(after.n)).toBe(18)
    expect(Math.round(before.overpay - after.overpay)).toBe(154_457)
    // По графику платежей — тоже 24 и 18.
    expect(schedule(P, R, PAY).n).toBe(24)
    expect(schedule(800_000, R, PAY).n).toBe(18)
  })

  it('живой случай до тенге: «снизить платёж» 200 000 — 46 400 и 74 820; после — 800 000, «снизить платёж» 100 000 — 50 750 и 27 456', () => {
    // Первый шаг — «сократить срок» (154 457), второй — «снизить платёж» по новому остатку
    // с прежним платежом 58 000; счётчик в браузере — 154 457 + 27 456 = 181 913 (Handoff).
    const lower = lumpPlan(P, R, PAY, LUMP, 'payment')!
    expect(lower).toEqual({ paid: 200_000, left: 800_000, payment: 46_400, months: 24, monthsBefore: 24, saved: 74_820 })
    const second = lumpPlan(800_000, R, PAY, 100_000, 'payment')!
    expect(second).toEqual({ paid: 100_000, left: 700_000, payment: 50_750, months: 18, monthsBefore: 18, saved: 27_456 })
    expect(lumpPlan(P, R, PAY, LUMP, 'term')!.saved + second.saved).toBe(181_913)

    for (const [debt, lump, plan] of [[P, LUMP, lower], [800_000, 100_000, second]] as const) {
      const before = continuous(debt, R, PAY)
      const left = debt - lump
      // Платёж — аннуитет на остаток на прежний непрерывный срок (формула в лоб)…
      const i = R / 12
      const annuity = (left * i) / (1 - Math.pow(1 + i, -before.n))
      expect(Math.abs(plan.payment - annuity)).toBeLessThan(1)
      // …а при том же сроке он пропорционален долгу: 58 000 × остаток / долг, вверх до тенге.
      expect(plan.payment).toBe(Math.ceil((PAY * left) / debt))
      // Экономия: n × (прежний − новый) − взнос = взнос × переплата / долг.
      expect(plan.saved).toBe(Math.round((lump * before.overpay) / debt))
    }
    expectSavedMatchesSchedule(800_000, R, PAY, second)
    expectSavedMatchesSchedule(800_000, R, PAY, lumpPlan(800_000, R, PAY, 100_000, 'term')!)
  })

  it('сверка с графиком: 3 000 000 под 24% на 36 месяцев — треть и почти весь долг, оба режима', () => {
    const P3 = 3_000_000
    const R3 = 0.24
    const PAY3 = 117_699
    expect(PAY3).toBe(Math.round(annuityPayment(P3, R3, 36)))

    const third = { term: lumpPlan(P3, R3, PAY3, 1_000_000, 'term')!, payment: lumpPlan(P3, R3, PAY3, 1_000_000, 'payment')! }
    expect(third.term).toEqual({ paid: 1_000_000, left: 2_000_000, payment: PAY3, months: 21, monthsBefore: 36, saved: 768_832 })
    expect(third.payment).toEqual({ paid: 1_000_000, left: 2_000_000, payment: 78_466, months: 36, monthsBefore: 36, saved: 412_380 })

    // Взнос почти во весь долг: остаток 10 000.
    const almost = { term: lumpPlan(P3, R3, PAY3, 2_990_000, 'term')!, payment: lumpPlan(P3, R3, PAY3, 2_990_000, 'payment')! }
    expect(almost.term).toEqual({ paid: 2_990_000, left: 10_000, payment: PAY3, months: 1, monthsBefore: 36, saved: 1_237_033 })
    // 117 699 × 10 000 / 3 000 000 = 392,33 → 393: платёж 392 растянул бы долг на 37-й платёж.
    expect(almost.payment).toEqual({ paid: 2_990_000, left: 10_000, payment: 393, months: 36, monthsBefore: 36, saved: 1_233_017 })
    expect(Math.ceil(annuityMonths(10_000, R3, 392))).toBe(37)
    expect(Math.ceil(annuityMonths(10_000, R3, 393))).toBe(36)
    // «Сократить срок» с остатком 10 000 — один закрывающий платёж: 10 000 + 2% = 10 200.
    expect(creditSplit(10_000, R3, PAY3)).toEqual({ amount: 10_200, interest: 200, body: 10_000 })

    for (const plan of [third.term, third.payment, almost.term, almost.payment]) {
      expectSavedMatchesSchedule(P3, R3, PAY3, plan)
      expect(plan.saved).toBeLessThanOrEqual(Math.round(continuous(P3, R3, PAY3).overpay))
      for (const v of Object.values(plan)) expect(Number.isInteger(v)).toBe(true)
    }
    expect(third.payment.saved).toBeLessThan(third.term.saved)
    expect(almost.payment.saved).toBeLessThan(almost.term.saved)
  })

  it('«снизить платёж» у кредита с банковским платежом — срок в строке кредита не вырос (платёж вверх)', () => {
    // 1 000 000 под 18% на 12 месяцев: банк округлил аннуитет 91 679,99 вверх — 91 680.
    const R18 = 0.18
    const BANK = 91_680
    expect(BANK).toBe(Math.ceil(annuityPayment(1_000_000, R18, 12)))
    const plan = lumpPlan(1_000_000, R18, BANK, 10_000, 'payment')!
    expect(plan.monthsBefore).toBe(12)
    // 91 680 × 990 000 / 1 000 000 = 90 763,2 → 90 764; `Math.round` дал бы 90 763 и «13 платежей».
    expect(plan.payment).toBe(90_764)
    expect(Math.ceil(annuityMonths(plan.left, R18, plan.payment))).toBeLessThanOrEqual(plan.monthsBefore)
    expect(Math.ceil(annuityMonths(plan.left, R18, 90_763))).toBe(13)
  })

  it('«снизить платёж» с крошечным остатком — платёж не меньше 1 ₸, а не 0', () => {
    // 100 000 под 20%, платёж 10 000, взнос 99 999: аннуитет на 1 ₸ — доли тенге.
    const plan = lumpPlan(100_000, 0.2, 10_000, 99_999, 'payment')!
    expect(plan.left).toBe(1)
    expect(annuityPayment(1, 0.2, annuityMonths(100_000, 0.2, 10_000))).toBeLessThan(0.5)
    expect(plan.payment).toBe(1)
    expect(plan.months).toBe(plan.monthsBefore)
    // Такой платёж долг закрывает: 1 ₸ под 20% — проценты 0, тело 1.
    expect(creditSplit(plan.left, 0.2, plan.payment)).toEqual({ amount: 1, interest: 0, body: 1 })
  })

  it('взнос больше долга закрывает его; нечего считать — null; рассрочка 0% — экономии нет', () => {
    const closing = lumpPlan(300_000, R, PAY, 500_000, 'payment')!
    expect(closing).toMatchObject({ paid: 300_000, left: 0, payment: 0, months: 0 })
    expect(closing.saved).toBe(Math.round(PAY * annuityMonths(300_000, R, PAY) - 300_000))

    expect(lumpPlan(P, R, PAY, 0, 'term')).toBeNull()
    expect(lumpPlan(0, R, PAY, LUMP, 'term')).toBeNull()
    // Платёж меньше процентов (27 500): срока нет, сохранять нечего.
    expect(lumpPlan(P, R, 20_000, LUMP, 'payment')).toBeNull()

    const free = lumpPlan(600_000, 0, 50_000, 100_000, 'payment')!
    expect(free).toMatchObject({ left: 500_000, payment: 41_667, months: 12, saved: 0 })
  })

  it('счётчик «сэкономлено на процентах» — сумма по живым досрочкам живых кредитов', () => {
    const base = { targetId: 'loan', period: '2026-09', accountId: null, by: 'a' as const, at: '2026-09-05T10:00:00Z', updatedAt: '2026-09-05T10:00:00Z' }
    const list: Payment[] = [
      { ...base, id: 'p1', kind: 'prepay', amount: 200_000, principal: 200_000, saved: 150_000 },
      { ...base, id: 'p2', kind: 'prepay', amount: 50_000, principal: 50_000, saved: 30_000 },
      { ...base, id: 'p3', kind: 'prepay', amount: 10_000, principal: 10_000, saved: 9_000, deletedAt: '2026-09-06T00:00:00Z' },
      { ...base, id: 'm', kind: 'credit', amount: 58_000, principal: 30_500 },
    ]
    const loan: Credit = { id: 'loan', name: 'Кредит', note: '', principal: P, annualRate: R, payment: PAY, day: 15, updatedAt: base.at }
    expect(prepaySaved(list, [loan])).toBe(180_000)
    expect(prepaySaved([], [loan])).toBe(0)

    // Досрочка удалённого кредита в счётчик не входит — как сам кредит в капитал.
    const mistake: Credit = { ...loan, id: 'oops', deletedAt: '2026-09-07T00:00:00Z' }
    const trial: Payment = { ...base, id: 'p4', targetId: 'oops', kind: 'prepay', amount: 100_000, principal: 100_000, saved: 70_000 }
    expect(prepaySaved([...list, trial], [loan, mistake])).toBe(180_000)
    expect(prepaySaved([...list, trial], [loan, { ...mistake, deletedAt: null }])).toBe(250_000)
    // Кредита нет в списке вовсе — тоже не считается.
    expect(prepaySaved(list, [])).toBe(0)
  })
})

describe('RP-09 — группы подписок и «оставить?»', () => {
  const T0 = '2026-01-01T00:00:00Z'
  const sub = (id: string, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
    id, name: id, note: '', day: 10, category: 'd4', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
  })
  const work: Obligation = { id: 'work', name: 'Рабочие', note: '', day: 1, category: 'd4', versions: [], group: true, noAsk: true, updatedAt: T0 }
  const fun: Obligation = { ...work, id: 'fun', name: 'Досуг', noAsk: false }
  const rent = sub('rent', 220_000, { category: 'd1' })
  const util = sub('util', 35_000, { estimate: true })
  const people: Person[] = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 20, updatedAt: T0 }]

  it('итог группы — сумма подписок, годовые — долей месяца, целые', () => {
    const list = [fun, sub('netflix', 4_990, { parentId: 'fun' }), sub('icloud', 11_990, { parentId: 'fun', every: 'year', month: 3 }), sub('gym', 15_000)]
    expect(groupChildren(fun, list).map((o) => o.id)).toEqual(['netflix', 'icloud'])
    // 4 990 + 11 990 / 12 = 5 989,17 → 5 989.
    expect(groupTotal(fun, list, '2026-09')).toBe(5_989)
    // Удалённая подписка в итог не входит.
    expect(groupTotal(fun, [...list.slice(0, 2), { ...list[2], deletedAt: T0 }], '2026-09')).toBe(4_990)
  })

  it('группа не входит в budgetAmounts, dueIn и untilPayday; подписки — входят; бюджет от группировки не меняется', () => {
    // У группы бывает своя сумма: старый PWA Блока 0 групп не знает, покажет её
    // обязательством 0 ₸, и правка «Сумма сейчас» запишет ей versions. С суммой 0
    // тест был бы зелёным и без исключения группы.
    const priced = (g: Obligation): Obligation => ({ ...g, versions: [{ from: '2000-01', amount: 9_999 }] })
    const loose = [rent, sub('netflix', 4_990), sub('slack', 3_000)]
    const grouped = [rent, priced(work), priced(fun), sub('netflix', 4_990, { parentId: 'fun' }), sub('slack', 3_000, { parentId: 'work' })]
    expect(budgetAmounts({ obligations: grouped, people })).toEqual(budgetAmounts({ obligations: loose, people }))
    expect(dueIn(priced(fun), '2026-09')).toBe(false)
    const due = untilPayday({ people, obligations: grouped }, { day: 5, key: '2026-09' })!.due.map((x) => x.id)
    expect(due).toEqual(['rent', 'netflix', 'slack'])
    expect(monthDues({ obligations: grouped }, '2026-09').map((d) => d.targetId)).toEqual(['rent', 'netflix', 'slack'])
    expect(isSubscription(fun)).toBe(false)
    expect(isSubscription(rent)).toBe(false)
    expect(isSubscription(util)).toBe(false)
    expect(isSubscription(sub('netflix', 1))).toBe(true)
  })

  it('годовая досуговая: спрашивает в окне 14 дней до продления, после ответа — до следующего года', () => {
    expect(KEEP_ASK_DAYS).toBe(14)
    // Продление 12 ноября; окно — с 29 октября. Моменты — полдень по Алматы (07:00 UTC).
    const icloud = sub('icloud', 11_990, { every: 'year', month: 11, day: 12, keptAt: '2026-03-01T07:00:00Z' })
    const at = (d: string) => new Date(`${d}T07:00:00Z`)
    expect(keepQuestions([icloud], at('2026-10-28'))).toEqual([])
    expect(keepQuestions([icloud], at('2026-10-29')).map((o) => o.id)).toEqual(['icloud'])
    expect(keepQuestions([icloud], at('2026-11-12')).map((o) => o.id)).toEqual(['icloud'])
    const kept = { ...icloud, keptAt: '2026-10-30T07:00:00Z' }
    expect(keepQuestions([kept], at('2026-11-05'))).toEqual([])
    // После продления до следующего окна тихо; в следующем году — снова.
    expect(keepQuestions([kept], at('2026-11-13'))).toEqual([])
    expect(keepQuestions([kept], at('2027-10-29')).map((o) => o.id)).toEqual(['icloud'])
    // В рабочей группе — никогда.
    expect(keepQuestions([work, { ...icloud, parentId: 'work' }], at('2026-11-01'))).toEqual([])
    // В досуговой группе — как без группы.
    expect(keepQuestions([fun, { ...icloud, parentId: 'fun' }], at('2026-11-01'))).toHaveLength(1)
  })

  it('ежемесячная: раз в квартал; граница квартала и момент ответа — по Алматы', () => {
    const netflix = (keptAt: string | null) => sub('netflix', 4_990, { keptAt })
    // Ответ 30 июня — до начала III квартала: в сентябре спросит.
    expect(keepQuestions([netflix('2026-06-30T07:00:00Z')], new Date('2026-09-10T07:00:00Z'))).toHaveLength(1)
    // 30 июня 20:00 UTC — уже 1 июля 01:00 в Алматы: ответ этого квартала, не спросит.
    expect(keepQuestions([netflix('2026-06-30T20:00:00Z')], new Date('2026-09-10T07:00:00Z'))).toEqual([])
    // 30 сентября 23:30 в Алматы — ещё III квартал; 00:30 1 октября — уже IV, спросит.
    const julyAnswer = netflix('2026-07-02T07:00:00Z')
    expect(keepQuestions([julyAnswer], new Date('2026-09-30T18:30:00Z'))).toEqual([])
    expect(keepQuestions([julyAnswer], new Date('2026-09-30T19:30:00Z'))).toHaveLength(1)
    // Без ответа вовсе (заведена до RP-09) — спросит.
    expect(keepQuestions([netflix(null)], new Date('2026-09-10T07:00:00Z'))).toHaveLength(1)
  })

  it('спрашивает только подписки: аренду, коммуналку и группы — нет; сначала ближайшие годовые, затем дороже', () => {
    const now = new Date('2026-11-01T07:00:00Z')
    const list = [
      rent, util, fun,
      sub('cheap', 1_990), sub('pricey', 9_990),
      sub('icloud', 11_990, { every: 'year', month: 11, day: 12, keptAt: '2026-01-01T07:00:00Z' }),
    ]
    expect(keepQuestions(list, now).map((o) => o.id)).toEqual(['icloud', 'pricey', 'cheap'])
  })
})

describe('PV-01 — закрытый кредит вне плана', () => {
  const T0 = '2026-09-01T00:00:00Z'
  const credit = (id: string, p: Partial<Credit> = {}): Credit => ({
    id,
    name: id,
    note: '',
    principal: 1_000_000,
    annualRate: 0.24,
    payment: 50_000,
    day: 15,
    updatedAt: T0,
    ...p,
  })
  const people: Person[] = [
    { id: 'a', name: 'Аня', salary: 900_000, payday: 10, updatedAt: T0 } as Person,
  ]

  it('openCredits: удалённый и закрытый — вне, беспроцентный с остатком — внутри', () => {
    const list = [
      credit('open'),
      credit('closed', { principal: 0 }),
      credit('gone', { deletedAt: T0 }),
      credit('zero', { annualRate: 0 }),
    ]
    expect(openCredits(list).map((c) => c.id)).toEqual(['open', 'zero'])
  })

  it('costliestCredits: только открытые с процентами, дороже — первым; при равной ставке — больше процентов в месяц', () => {
    const list = [
      credit('cheap', { annualRate: 0.12 }),
      credit('zero', { annualRate: 0 }),
      credit('closed', { annualRate: 0.4, principal: 0 }),
      credit('small', { annualRate: 0.33, principal: 200_000 }),
      credit('big', { annualRate: 0.33, principal: 900_000 }),
    ]
    expect(costliestCredits(list).map((c) => c.id)).toEqual(['big', 'small', 'cheap'])
  })

  it('budgetAmounts: платёж закрытого кредита не входит в «Кредиты» и не уменьшает «Свободно»', () => {
    const open = budgetAmounts({ people, credits: [credit('x'), credit('y', { payment: 30_000 })] })
    const closed = budgetAmounts({ people, credits: [credit('x'), credit('y', { payment: 30_000, principal: 0 })] })
    expect(open.d2).toBe(80_000)
    expect(closed.d2).toBe(50_000)
    expect(closed.d5 - open.d5).toBe(30_000)
    // Беспроцентный с остатком — платится, входит.
    expect(budgetAmounts({ people, credits: [credit('z', { annualRate: 0 })] }).d2).toBe(50_000)
  })
})

describe('PV-02 — калькулятор «копить или гасить»', () => {
  const T0 = '2026-09-01T00:00:00Z'
  const loan = { principal: 1_000_000, annualRate: 0.24, payment: 50_000 }

  it('simulateStrategy: подушка набирается до досрочек — пока она неполна, долг идёт только по графику', () => {
    const run = (payDebts: boolean, months: number) =>
      simulateStrategy({ debts: [loan], saving: 100_000, keep: 0, payDebts, start: 0, buffer: 300_000, months })
    // Три месяца по 100 000 уходят в подушку: долг тот же, что у «копим как сейчас».
    expect(run(true, 1)).toMatchObject({ savings: 100_000, debtLeft: 970_000 })
    expect(run(true, 3).debtLeft).toBeCloseTo(run(false, 3).debtLeft, 6)
    expect(run(true, 3).savings).toBe(300_000)
    // Четвёртый — подушка полна, взнос идёт в долг, накопления стоят.
    expect(run(true, 4).savings).toBe(300_000)
    expect(run(false, 4).debtLeft - run(true, 4).debtLeft).toBeCloseTo(100_000, 6)
    // «Копим как сейчас» подушку не знает — копит всё.
    expect(run(false, 4).savings).toBe(400_000)
  })

  it('simulateStrategy: вложенное накопленное ограничено тем, что есть, и уменьшает накопления', () => {
    const run = (lump: number, payDebts = true) =>
      simulateStrategy({ debts: [loan], saving: 0, keep: 0, payDebts, start: 200_000, lump, months: 1 })
    // Больше, чем накоплено, не вложить: 500 000 → 200 000.
    expect(run(500_000)).toMatchObject({ savings: 0 })
    expect(run(500_000).debtLeft).toBeCloseTo(800_000 * 1.02 - 50_000, 6)
    expect(run(100_000).savings).toBe(100_000)
    expect(run(100_000).debtLeft).toBeCloseTo(900_000 * 1.02 - 50_000, 6)
    // «Копим как сейчас» накопленное не трогает.
    expect(run(500_000, false).savings).toBe(200_000)
  })

  it('simulateStrategy: без процентных долгов — «уже» (0); платёж не больше процентов — null; иначе месяц закрытия', () => {
    const run = (debts: { principal: number; annualRate: number; payment: number }[]) =>
      simulateStrategy({ debts, saving: 0, keep: 0, payDebts: false, start: 0, months: 12 }).debtFreeMonth
    expect(run([])).toBe(0)
    expect(run([{ principal: 200_000, annualRate: 0, payment: 20_000 }])).toBe(0)
    expect(run([{ principal: 1_000_000, annualRate: 0.36, payment: 30_000 }])).toBeNull()
    // 100 000 под 12% платежом 50 000: 51 000 → 1 510 → закрыт в третьем месяце.
    expect(run([{ principal: 100_000, annualRate: 0.12, payment: 50_000 }])).toBe(3)
  })

  const goal = (id: string, monthly: number, have: number, p: Partial<Goal> = {}): Goal => ({
    id, name: id, need: 5_000_000, seed: have, have, monthly, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...p,
  })
  const ob = (id: string, amount: number, p: Partial<Obligation> = {}): Obligation => ({
    id, name: id, note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...p,
  })
  const cr = (id: string, principal: number, annualRate: number, payment: number): Credit => ({
    id, name: id, note: '', principal, annualRate, payment, day: 15, updatedAt: T0,
  })
  const goals = [
    goal('flat', 50_000, 300_000),
    goal('baby', 30_000, 100_000),
    goal('minus', 20_000, -5_000),
    goal('gone', 999, 999, { deletedAt: T0 }),
  ]
  const obligations = [
    ob('rent', 220_000),
    ob('insurance', 60_000, { every: 'year', month: 3 }),
    ob('group', 0, { group: true, category: 'd4' }),
    ob('old', 99_000, { deletedAt: T0 }),
  ]
  const credits = [cr('loan', 1_000_000, 0.24, 50_000), cr('zero', 200_000, 0, 20_000), cr('closed', 0, 0.3, 40_000)]
  const base = { credits, goals, obligations, key: '2026-09', kept: ['baby'], cushion: true, useSaved: false }

  it('strategyInputs: взносы, накопленное, подушка, беспроцентные — по формулам React; всё целое', () => {
    const x = strategyInputs(base)
    expect(x).toMatchObject({
      saving: 100_000,
      keep: 30_000, // только отмеченная цель
      start: 400_000, // минус цели — как 0, удалённая — вне
      movable: 300_000, // без отмеченной
      mandatory: 295_000, // 220 000 + 60 000 / 12 + 50 000 + 20 000; закрытый кредит — вне
      cushionSize: 295_000,
      buffer: 295_000,
      spare: 5_000,
      lump: 0, // галки «вложить» нет
      redirected: 70_000,
    })
    expect(x.debts).toEqual([
      { principal: 1_000_000, annualRate: 0.24, payment: 50_000 },
      { principal: 200_000, annualRate: 0, payment: 20_000 },
    ])
    expect(x.interestFree.map((c) => c.id)).toEqual(['zero'])
    for (const v of [x.saving, x.keep, x.start, x.movable, x.mandatory, x.cushionSize, x.buffer, x.spare, x.lump, x.redirected]) {
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('strategyInputs: без подушки буфер 0, а сумма подушки видна; «вложить» — всё из неотмеченных', () => {
    const x = strategyInputs({ ...base, cushion: false, useSaved: true })
    expect(x).toMatchObject({ cushionSize: 295_000, buffer: 0, spare: 300_000, lump: 300_000 })
    expect(strategyInputs({ ...base, useSaved: true }).lump).toBe(5_000)
    expect(strategyInputs({ ...base, kept: [] })).toMatchObject({ keep: 0, movable: 400_000, redirected: 100_000 })
  })

  it('strategyInputs: подушка — до тысяч, месяц с долей годового — целый', () => {
    const cushion = (list: Obligation[]) => strategyInputs({ ...base, credits: [], obligations: list })
    expect(cushion([ob('a', 220_400)]).cushionSize).toBe(220_000)
    expect(cushion([ob('a', 220_500)]).cushionSize).toBe(221_000)
    // 11 990 в год — 999,17 в месяц.
    expect(cushion([ob('a', 220_000), ob('b', 11_990, { every: 'year' })])).toMatchObject({
      mandatory: 220_999,
      cushionSize: 221_000,
    })
  })

  it('strategyGain: целое, знак — чья стратегия богаче', () => {
    const r = (net: number) => ({ savings: net, debtLeft: 0, net, interest: 0, interestTotal: 0, debtFreeMonth: 0 })
    expect(strategyGain(r(100.4), r(250.9))).toBe(151)
    expect(strategyGain(r(500), r(200))).toBe(-300)
  })
})

describe('PV-03 — долг «по сроку»', () => {
  it('scheduleMismatch: график сходится — null; не хватает на тело — сколько и сколько платежей было бы', () => {
    // 1 000 000 платежом 91 680 за 12 — это 18% годовых, расхождения нет.
    expect(scheduleMismatch(1_000_000, 91_680, 12)).toBeNull()
    expect(scheduleMismatch(1_000_000, 10_000, 12)).toEqual({ paid: 120_000, gap: 880_000, suggest: 100 })
    // Ровно без процентов — сходится (ставка 0), не расхождение.
    expect(scheduleMismatch(120_000, 10_000, 12)).toBeNull()
    for (const [p, pay, n] of [[0, 10_000, 12], [1_000_000, 0, 12], [1_000_000, 10_000, 0], [-1, 10_000, 12]]) {
      expect(scheduleMismatch(p, pay, n)).toBeNull()
    }
  })

  it('rateFromSchedule: срок короче, чем выходит даже при 200%, — потолок 2 («200,0% годовых»)', () => {
    // 1 000 000 платежом 500 000: при 200% годовых закрывается за 3 платежа, а назвали 4.
    expect(rateFromSchedule(1_000_000, 500_000, 4)).toBe(2)
    expect(ratePct(2, 1)).toBe('200,0%')
    expect(ratePct(rateFromSchedule(1_000_000, 91_680, 12)!, 1)).toBe('18,0%')
  })

  it('installmentMonths: платежей без процентов — вверх до целого; без платежа — 0', () => {
    expect(installmentMonths(1_000_000, 10_000)).toBe(100)
    expect(installmentMonths(1_000_000, 30_000)).toBe(34)
    expect(installmentMonths(1_000_000, 0)).toBe(0)
  })
})

describe('PV-04 — накопленное и прогноз цели', () => {
  it('goalHave: seed + движения, не ниже нуля; без движений — seed', () => {
    expect(goalHave(100_000, [{ amount: 50_000 }, { amount: -20_000 }])).toBe(130_000)
    expect(goalHave(100_000, [{ amount: -150_000 }])).toBe(0)
    expect(goalHave(undefined, [{ amount: 30_000 }])).toBe(30_000)
    expect(goalHave(70_000)).toBe(70_000)
  })

  it('indexedNeed: цена цели через N месяцев при инфляции 10,2%; взнос 0 (Infinity) — null; целое', () => {
    expect(INFLATION).toBe(0.102)
    expect(indexedNeed(1_000_000, 24)).toBe(Math.round(1_000_000 * 1.102 ** 2))
    expect(indexedNeed(1_000_000, 24)).toBe(1_214_404)
    expect(indexedNeed(1_000_000, Infinity)).toBeNull()
    const v = indexedNeed(777_777, 7)!
    expect(Number.isInteger(v)).toBe(true)
    expect(indexedNeed(1_000_000, 12, 0.08)).toBe(1_080_000)
  })
})
