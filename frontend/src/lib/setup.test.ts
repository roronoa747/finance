import { describe, it, expect } from 'vitest'
import { setupPlan, setupCreditRate, setupGoalMonthly, type SetupForm } from './setup'
import { goalMonthly, rateFromSchedule } from './finance'

describe('PV-06: setupPlan — что мастер сохраняет на «Готово»', () => {
  // Всё заполнено: аренда, коммуналка, кредит, цель.
  const form: SetupForm = {
    tenure: 'rent',
    housing: '220 000',
    housingDay: '5',
    utilities: '22 000',
    hasCredit: 'yes',
    creditPrincipal: '1 000 000',
    creditPayment: '91 680',
    creditRateMode: 'term',
    creditRate: '',
    creditTerm: '12',
    creditDay: '12',
    goalName: 'Квартира',
    goalNeed: '6 000 000',
    goalHave: '600 000',
    goalMonths: '24',
    goalHue: 'green',
  }
  const none = { housing: false, credit: false, goal: false }

  it('без пропусков — всё заполненное сохраняется, суммы разделов — из тех же чисел', () => {
    const plan = setupPlan(form, none)
    expect(plan.housing).toEqual({
      obligations: [
        { name: 'Аренда', note: 'ежемесячный платёж', day: 5, category: 'd1', amount: 220_000 },
        { name: 'Коммуналка', note: 'плавает по сезону', day: 15, category: 'd1', estimate: true, amount: 22_000 },
      ],
      d1: 242_000,
    })
    expect(plan.credit).toEqual({
      credit: {
        name: 'Кредит',
        note: 'ежемесячный платёж',
        principal: 1_000_000,
        annualRate: rateFromSchedule(1_000_000, 91_680, 12),
        payment: 91_680,
        day: 12,
      },
      d2: 91_680,
    })
    const monthly = goalMonthly(5_400_000, 24)
    expect(plan.goal).toEqual({
      goal: { name: 'Квартира', need: 6_000_000, have: 600_000, monthly, hue: 'green' },
      d3: monthly,
    })
  })

  it('«Пропустить» жильё — ни обязательств, ни d1; остальное сохраняется', () => {
    const plan = setupPlan(form, { ...none, housing: true })
    expect(plan.housing).toBeUndefined()
    expect(plan.credit).toBeDefined()
    expect(plan.goal).toBeDefined()
  })

  it('«Пропустить» кредит — кредита нет; «Кредитов нет» — нет и без флага', () => {
    expect(setupPlan(form, { ...none, credit: true }).credit).toBeUndefined()
    expect(setupPlan({ ...form, hasCredit: 'no' }, none).credit).toBeUndefined()
    expect(setupPlan(form, { ...none, credit: true }).housing).toBeDefined()
  })

  it('«Пока без цели» — цели и d3 нет', () => {
    const plan = setupPlan(form, { ...none, goal: true })
    expect(plan.goal).toBeUndefined()
    expect(plan.housing).toBeDefined()
  })

  it('пустые шаги не сохраняются и без флагов; «Своё» — «Жильё», «содержание»; дни — в пределах 1–28', () => {
    const empty = setupPlan(
      { ...form, housing: '', utilities: '', creditPayment: '', goalNeed: '' },
      none,
    )
    expect(empty).toEqual({})
    const own = setupPlan({ ...form, tenure: 'own', utilities: '', housingDay: '31', creditDay: '0' }, none)
    expect(own.housing!.obligations).toEqual([
      { name: 'Жильё', note: 'содержание', day: 28, category: 'd1', amount: 220_000 },
    ])
    expect(own.credit!.credit.day).toBe(12)
  })

  it('ставка кредита: введённая — из поля, из срока — rateFromSchedule; несходящийся график — 0% в записи', () => {
    expect(setupCreditRate({ ...form, creditRateMode: 'rate', creditRate: '23,4' })).toBeCloseTo(0.234, 10)
    expect(setupCreditRate({ ...form, creditRateMode: 'rate', creditRate: '' })).toBeNull()
    const broken = { ...form, creditPayment: '10 000' }
    expect(setupCreditRate(broken)).toBeNull()
    expect(setupPlan(broken, none).credit!.credit.annualRate).toBe(0)
    expect(setupGoalMonthly({ ...form, goalNeed: '' })).toBe(0)
  })
})
