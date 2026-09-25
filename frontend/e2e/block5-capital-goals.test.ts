import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import {
  netWorth,
  liquidCash,
  prepayment,
  debtCost,
  goalMonths,
  contributionStreak,
  deposit,
  realRate,
} from '../src/lib/finance'

describe('e2e / block-5 — Сквозной сценарий Капитала, Целей, Депозитов и Сквозной приёмки', () => {
  const storageMap = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, String(val)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  }

  let router = createAppRouter()

  beforeEach(async () => {
    vi.stubGlobal('localStorage', mockLocalStorage)
    mockLocalStorage.clear()
    setActivePinia(createPinia())
    router = createAppRouter()
  })

  it('сквозной сценарий: настройка семьи -> расчет совокупного капитала -> досрочка по кредиту -> цели и вишлист -> сложный процент депозита', async () => {
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    // 1. Авторизация пользователя
    authStore.setAuthData({
      token: 'jwt-token-block5',
      user: { id: 'u-ilyas', email: 'ilyas@example.com', created_at: '2026-09-24T08:00:00Z' },
      household: { id: 'h-family', name: 'Семья Ильясовых', created_by: 'u-ilyas', created_at: '2026-09-24T08:00:00Z' },
      member: {
        joined_at: '2026-09-24T08:00:00Z',
        household_id: 'h-family',
        user_id: 'u-ilyas',
        display_name: 'Ильяс',
        role: 'member',
        slot: 'a',
      },
    })
    financeStore.finishSetup()

    // 2. Инициализация счетов (общие + приватные), кредитов и целей
    financeStore.addAccount({
      name: 'Kaspi Gold',
      amount: 500_000,
      currency: 'KZT',
      kind: 'card',
    }, false)

    financeStore.addAccount({
      name: 'Депозит Kaspi',
      amount: 1_200_000,
      currency: 'KZT',
      kind: 'deposit',
    }, false)

    financeStore.addAccount({
      name: 'Личный криптокошелек',
      amount: 300_000,
      currency: 'KZT',
      // Не для расходов — из видов счёта это только «вклад».
      kind: 'deposit',
    }, true)

    financeStore.addCredit({
      name: 'Автокредит',
      principal: 2_400_000,
      annualRate: 0.18,
      payment: 120_000,
      day: 15,
    })

    financeStore.addGoal({
      name: 'Поездка в Японию',
      need: 2_000_000,
      have: 600_000,
      monthly: 100_000,
      hue: 'ochre',
    })

    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (year: number, month: number) => `${year}-${pad(month + 1)}-10`

    const japanGoal = financeStore.goals.find((g) => g.name === 'Поездка в Японию')!
    japanGoal.movements = [
      { id: 'm-1', date: fmt(y, m), amount: 100_000, by: 'a' },
      { id: 'm-2', date: fmt(y, m - 1), amount: 100_000, by: 'a' },
      { id: 'm-3', date: fmt(y, m - 2), amount: 100_000, by: 'a' },
    ]

    // 3. Проверка расчета совокупного капитала и ликвидности
    // Net Worth = (500k + 1200k + 300k счета) + 600k (цели) - 2400k (кредит) = 200k
    const currentNetWorth = netWorth(
      financeStore.accounts,
      financeStore.credits,
      financeStore.goals
    )
    expect(currentNetWorth).toBe(200_000)

    const liquid = liquidCash(financeStore.accounts)
    // Ликвидные средства (карта 500k; депозит и криптокошелёк — вклады, не кэш)
    expect(liquid).toBe(500_000)

    // 4. Симулятор досрочного погашения кредита (MGV-12)
    const prepayRes = prepayment(2_400_000, 0.18, 120_000, 50_000)
    expect(prepayRes.monthsSaved).toBeGreaterThan(0)
    expect(prepayRes.saved).toBeGreaterThan(0)
    expect(prepayRes.monthsAfter).toBeLessThan(prepayRes.monthsNow)

    // Стоимость долга и переплата
    const cost = debtCost(2_400_000, 0.18, 120_000)
    expect(cost.monthlyInterest).toBeGreaterThan(0)
    expect(cost.overpay).toBeGreaterThan(0)
    expect(cost.closes).toBe(true)

    // 5. Проверка целей и непрерывной серии пополнений (MGV-13)
    const remaining = japanGoal.need - japanGoal.have
    const monthsNeeded = goalMonths(remaining, japanGoal.monthly)
    expect(monthsNeeded).toBe(14)

    const streak = contributionStreak(japanGoal.movements)
    expect(streak).toBe(3)

    // Пополнение цели со счета Kaspi Gold
    const kaspiAcc = financeStore.householdAccounts.find((a) => a.name === 'Kaspi Gold')!
    financeStore.contribute(japanGoal.id, 150_000, 'a', 'На билеты')
    financeStore.setAccountAmount(kaspiAcc.id, kaspiAcc.amount - 150_000)
    const updatedGoal = financeStore.goals.find((g) => g.id === japanGoal.id)!
    const updatedAcc = financeStore.householdAccounts.find((a) => a.id === kaspiAcc.id)!
    expect(updatedGoal.have).toBe(1_050_000)
    expect(updatedAcc.amount).toBe(350_000)

    // Частичное снятие с цели на счет Kaspi Gold
    financeStore.withdraw(japanGoal.id, 50_000, 'a', 'Форс-мажор')
    financeStore.setAccountAmount(kaspiAcc.id, updatedAcc.amount + 50_000)
    expect(updatedGoal.have).toBe(1_000_000)
    // Стор отдаёт счёт копией с остатком из отметок (RP-06) — перечитываем.
    expect(financeStore.householdAccounts.find((a) => a.id === kaspiAcc.id)!.amount).toBe(400_000)

    // 6. Сложный процент с капитализацией (Deposit.vue, MGV-13)
    const depositCalc = deposit({
      principal: 1_000_000,
      annualRate: 0.14,
      months: 12,
      monthlyTopUp: 50_000,
      capitalize: true,
    })
    expect(depositCalc.future).toBeGreaterThan(1_600_000)
    expect(depositCalc.interest).toBeGreaterThan(0)

    // Реальная ставка с поправкой на инфляцию 8%
    const realYield = realRate(0.14, 0.08)
    expect(realYield).toBeCloseTo(0.0555, 3)

    // 7. Проверка роутера и навигации без PlaceholderView
    await router.push('/capital')
    expect(router.currentRoute.value.path).toBe('/capital')

    await router.push('/capital?income=1')
    expect(router.currentRoute.value.query.income).toBe('1')

    await router.push('/goals')
    expect(router.currentRoute.value.path).toBe('/goals')

    await router.push('/goals?tab=wish')
    expect(router.currentRoute.value.query.tab).toBe('wish')

    await router.push('/goals/g-japan')
    expect(router.currentRoute.value.path).toBe('/goals/g-japan')

    await router.push('/capital/acc-depo')
    expect(router.currentRoute.value.path).toBe('/capital/acc-depo')
  })
})
