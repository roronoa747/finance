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
} from './finance'
import { plain, money, moneyShort, parseMoney, pct, ratePct } from './money'
import { clean, caretAt, sigBefore } from './num'
import { monthKey, parseMonthKey, addMonths, daysInMonth, leadingBlanks } from './dates'

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
