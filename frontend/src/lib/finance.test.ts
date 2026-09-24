import { describe, it, expect } from 'vitest'
import {
  annuityPayment,
  annuityMonths,
  annuityTotal,
  rateFromSchedule,
  prepayment,
  lumpSum,
  halfOverpayExtra,
  deposit,
  realRate,
  goalMonths,
  goalMonthly,
  emergencyTarget,
  emergencyCoverage,
  debtCost,
  simulateStrategy,
  creditSplit,
  creditDueAmount,
  countedPayments,
  paidFor,
  accountBalance,
  creditBalance,
  nextObligationDue,
  nextCreditDue,
  lastAccountFor,
  untilPayday,
} from './finance'
import { plain, money, moneyShort, parseMoney, pct, ratePct } from './money'
import { clean, caretAt, sigBefore } from './num'
import { monthKey, parseMonthKey, addMonths, daysInMonth, leadingBlanks, today } from './dates'
import type { Account, Credit, Obligation, Payment, Person } from '@/types/finance'

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
