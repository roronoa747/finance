// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { debtsOverview, isPeoplePayment, isSubscription, liveObligations, monthPlan, monthSubscriptions, monthlyAmount, peopleGroup, planStep } from '../src/lib/finance'
import { authAs, planFamilyDoc } from '../src/test/planFamily'

/**
 * Блок 2 «мелочи» (ML-18): «Кредиты шире» на семье `planFamilyDoc` через настоящий стор и функции расчёта. Завели долг
 * брату и платёж маме → оба в «Долгах» (строка и «Людям · 1»), «Отдал» уменьшает остаток и сдвигает «без долгов — к»,
 * план «Сначала долги» брата не досрочит, платёж маме в сумму долгов не входит, а в плане месяца — обычный платёж.
 * Числа — ручной расчёт в комментариях.
 */

const MONTH = '2026-10'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T07:00:00.000Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function family() {
  setActivePinia(createPinia())
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  return store
}
const overview = (store: ReturnType<typeof useFinanceStore>) => debtsOverview({ ...store.planState(), plans: store.plans }, MONTH)
const people = (store: ReturnType<typeof useFinanceStore>) =>
  peopleGroup(
    liveObligations(store.obligations).filter(isPeoplePayment).map((o) => ({ obligation: o, amount: monthlyAmount(o, MONTH), paid: false, day: o.day })),
    store.obligations,
  )

describe('Блок 2 «мелочи» — долг человеку и платёж людям', () => {
  it('завёл брату и маме — оба в «Долгах»; мама не в сумме долгов, в плане месяца — обычный платёж', () => {
    const store = family()
    const before = overview(store)
    // Кредиты семьи: 1 000 000 + 300 000 + 240 000 = 1 540 000.
    expect(before.total).toBe(1_540_000)
    const bro = store.addCredit({ name: 'Брату', principal: 1_500_000, annualRate: 0, payment: 50_000, day: 25, person: true })
    const mom = store.addObligation({ name: 'Маме', day: 5, category: 'd4', amount: 100_000, people: true })

    const after = overview(store)
    // 1 540 000 + 1 500 000 = 3 040 000; «Маме» 100 000 — не остаток.
    expect(after.total).toBe(3_040_000)
    expect(after.rows.find((r) => r.creditId === bro)).toMatchObject({ person: true, rate: 0, left: 1_500_000, payment: 50_000 })
    expect(people(store)).toMatchObject({ count: 1, total: 100_000 })
    // Маме — не подписка: в плане месяца строкой платежа со своим «Оплатил».
    const momRaw = store.obligations.find((o) => o.id === mom)!
    expect(isSubscription(momRaw)).toBe(false)
    const dues = monthPlan(store.householdDoc, { key: MONTH, totals: [], spendCategories: [], uploads: [] }).dues
    const { rest, subs } = monthSubscriptions(dues, store.obligations)
    expect(rest.some((d) => d.targetId === mom)).toBe(true)
    expect(subs).toBeNull()
  })

  it('«без долгов — к» учитывает брата; «Отдал» уменьшает остаток и сдвигает месяц', () => {
    const store = family()
    const without = overview(store).freeMonth!
    const bro = store.addCredit({ name: 'Брату', principal: 1_500_000, annualRate: 0, payment: 50_000, day: 25, person: true })
    // 1 500 000 / 50 000 = 30 платежей → апрель 2029 — позже кредитов семьи.
    expect(overview(store).freeMonth).toBe('2029-04')
    expect(without < '2029-04').toBe(true)

    store.markPaid('credit', bro, 'a', { period: MONTH, accountId: 'card' })
    // Отдал 50 000: остаток 1 450 000 → 29 платежей → март 2029; сумма долгов 3 040 000 − 50 000.
    expect(store.credits.find((c) => c.id === bro)!.principal).toBe(1_450_000)
    expect(overview(store).total).toBe(2_990_000)
    expect(overview(store).freeMonth).toBe('2029-03')
    // Одна отметка на месяц: второе «Отдал» той же записью.
    store.markPaid('credit', bro, 'a', { period: MONTH, accountId: 'card' })
    expect(store.payments.filter((p) => p.targetId === bro && !p.deletedAt)).toHaveLength(1)
  })

  it('план «Сначала долги» брата не досрочит: в плане только кредиты с процентами, шаг — не брату', () => {
    const store = family()
    const bro = store.addCredit({ name: 'Брату', principal: 500_000, annualRate: 0, payment: 50_000, day: 25, person: true })
    const plan = store.choosePlan({ keptGoalIds: [], cushionGoalId: null, months: 24, lump: 0 }, 'a')!
    expect(plan.creditIds).not.toContain(bro)
    expect(plan.creditIds.sort()).toEqual(['cc', 'loan'])
    const step = planStep(plan, store.planState(), MONTH)
    expect('creditId' in step ? step.creditId : null).not.toBe(bro)
    // С планом «без долгов» — не раньше конца графика брата: 500 000 / 50 000 = 10 платежей → август 2027.
    expect(overview(store).freeMonth! >= '2027-08').toBe(true)
  })
})
