import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import {
  budgetAmounts,
  totalIncome,
  netWorth,
  cushionMonths,
  untilPayday,
} from '../src/lib/finance'

describe('e2e / block-3 — Сквозной сценарий навигации, Access, Setup и Overview', () => {
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

  it('сквозной сценарий: неавторизованный вход -> регистрация -> прохождение мастера Setup -> экран Overview -> присоединение партнёра', async () => {
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    // 1. Неавторизованный пользователь пытается открыть главную страницу
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/access')

    // 2. Регистрация нового домохозяйства (Ильяс, Семья Ильясовых)
    authStore.setAuthData({
      token: 'jwt-token-ilyas',
      user: { id: 'u-ilyas', email: 'ilyas@example.com', created_at: '2026-09-23T10:00:00Z' },
      household: { id: 'h-family', name: 'Семья Ильясовых', created_at: '2026-09-23T10:00:00Z' },
      member: {
        id: 'm-1',
        household_id: 'h-family',
        user_id: 'u-ilyas',
        display_name: 'Ильяс',
        role: 'member',
        slot: 'a',
      },
    })
    expect(authStore.isAuthenticated).toBe(true)

    // 3. После входа без настроенного бюджета роутер перенаправляет на /setup
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/setup')

    // 4. Прохождение мастера первоначальной настройки (Setup)
    // Шаг 1: Доход
    financeStore.setPerson('a', {
      name: 'Ильяс',
      salary: 700_000,
      payday: 10,
      onboardedAt: '2026-09-23T10:05:00Z',
    })

    // Шаг 2: Жилье (Аренда 250 000 ₸, день 5; Коммуналка 30 000 ₸)
    financeStore.addObligation({
      name: 'Аренда квартиры',
      day: 5,
      category: 'd1',
      amount: 250_000,
    })
    financeStore.addObligation({
      name: 'Коммуналка',
      day: 15,
      category: 'd1',
      estimate: true,
      amount: 30_000,
    })
    financeStore.setCategoryAmount('d1', 280_000)

    // Шаг 3: Кредит (остаток 800 000 ₸, платёж 45 000 ₸, день 12)
    financeStore.addCredit({
      name: 'Потребительский кредит',
      principal: 800_000,
      annualRate: 0.22,
      payment: 45_000,
      day: 12,
    })
    financeStore.setCategoryAmount('d2', 45_000)

    // Шаг 4: Цель (Накопления на отпуск, нужно 600 000 ₸, уже есть 100 000 ₸, взнос 50 000 ₸)
    financeStore.addGoal({
      name: 'Семейный отпуск',
      need: 600_000,
      have: 100_000,
      monthly: 50_000,
      hue: 'teal',
    })
    financeStore.setCategoryAmount('d3', 50_000)

    // Еда и быт (категория d4)
    financeStore.setCategoryAmount('d4', 150_000)

    // Завершение мастера настройки
    financeStore.finishSetup()
    expect(financeStore.setupDone).toBe(true)

    // 5. Переход на главную страницу (Overview)
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')

    // 6. Проверка финансовой математики Overview
    const overviewAmounts = budgetAmounts({
      categories: financeStore.categories,
      obligations: financeStore.obligations,
      credits: financeStore.credits,
      goals: financeStore.goals,
      people: financeStore.people,
    })

    // Доход: 700 000
    expect(overviewAmounts.income).toBe(700_000)
    // Расходы: Жилье (280 000) + Кредиты (45 000) + Цели (50 000) + Быт (150 000) = 525 000
    // Свободно: 700 000 - 525 000 = 175 000
    expect(overviewAmounts.d1).toBe(280_000)
    expect(overviewAmounts.d2).toBe(45_000)
    expect(overviewAmounts.d3).toBe(50_000)
    expect(overviewAmounts.d4).toBe(150_000)
    expect(overviewAmounts.d5).toBe(175_000)

    // Капитал: цели (100 000) - кредит (800 000) = -700 000
    const net = netWorth(financeStore.accounts, financeStore.credits, financeStore.goals)
    expect(net).toBe(-700_000)

    // До зарплаты: следующий платёж Ильяса
    const nextPay = untilPayday({
      people: financeStore.people,
      obligations: financeStore.obligations,
      credits: financeStore.credits,
      accounts: financeStore.accounts,
    })
    expect(nextPay).not.toBeNull()
    expect(nextPay?.who.name).toBe('Ильяс')
    expect(nextPay?.income).toBe(700_000)

    // 7. Сценарий второго партнёра (Аруна присоединяется по коду)
    authStore.setAuthData({
      token: 'jwt-token-aruna',
      user: { id: 'u-aruna', email: 'aruna@example.com', created_at: '2026-09-23T11:00:00Z' },
      household: { id: 'h-family', name: 'Семья Ильясовых', created_at: '2026-09-23T10:00:00Z' },
      member: {
        id: 'm-2',
        household_id: 'h-family',
        user_id: 'u-aruna',
        display_name: 'Аруна',
        role: 'member',
        slot: 'b',
      },
    })
    expect(authStore.slot).toBe('b')

    // Аруна вносит свой доход (слот b)
    financeStore.setPerson('b', {
      name: 'Аруна',
      salary: 500_000,
      payday: 20,
      onboardedAt: '2026-09-23T11:05:00Z',
    })

    // Теперь в семье 2 участника, общий доход 1 200 000 ₸
    expect(financeStore.people).toHaveLength(2)
    const combinedIncome = totalIncome(financeStore.people)
    expect(combinedIncome).toBe(1_200_000)

    const updatedAmounts = budgetAmounts({
      categories: financeStore.categories,
      obligations: financeStore.obligations,
      credits: financeStore.credits,
      goals: financeStore.goals,
      people: financeStore.people,
    })
    // Свободно выросло на доход Аруны: 175 000 + 500 000 = 675 000 ₸
    expect(updatedAmounts.income).toBe(1_200_000)
    expect(updatedAmounts.d5).toBe(675_000)
  })
})
