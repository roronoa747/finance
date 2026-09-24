import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import {
  budgetAmounts,
  salaryAt,
  nextSalaryChange,
  nextChange,
  goalMonths,
  prepayment,
} from '../src/lib/finance'
import { monthKey } from '../src/lib/dates'
import { money, plain } from '../src/lib/money'
import Budget from '../src/views/Budget.vue'
import Ritual from '../src/views/Ritual.vue'

describe('e2e / block-4 — Сквозной сценарий Бюджета (План, Календарь, Список) и Ритуала высвобождения', () => {
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

  it('сквозной сценарий: настройка семьи -> работа с бюджетом -> изменение оклада и лимитов -> ритуал высвобождения', async () => {
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()
    const key = monthKey()

    // 1. Авторизация и начальное состояние казны
    authStore.setAuthData({
      token: 'jwt-token-family',
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
    financeStore.finishSetup()

    // Настраиваем данные казны: 2 участника, аренда, кредит, цель, лимит на быт
    financeStore.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Динара', salary: 500_000, payday: 20, updatedAt: '' },
    ]
    financeStore.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда квартиры',
        note: 'ежемесячно',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 250_000 }],
        updatedAt: '',
      },
    ]
    financeStore.householdDoc.credits = [
      {
        id: 'cr-auto',
        name: 'Автокредит',
        note: 'до 2028',
        principal: 2_500_000,
        annualRate: 0.18,
        payment: 70_000,
        day: 15,
        updatedAt: '',
      },
    ]
    financeStore.householdDoc.goals = [
      {
        id: 'g-trip',
        name: 'Отпуск в горах',
        need: 600_000,
        seed: 100_000,
        have: 100_000,
        monthly: 50_000,
        hue: 'teal',
        planPct: 0.16,
        movements: [],
        updatedAt: '',
      },
    ]
    financeStore.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 250_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 70_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 630_000, updatedAt: '' },
    ]

    // 2. Переход на экран «Бюджет» (/budget)
    await router.push('/budget')
    expect(router.currentRoute.value.path).toBe('/budget')

    // 3. Проверка режима «План»
    let amounts = budgetAmounts(financeStore.householdDoc)
    expect(amounts.income).toBe(1_200_000)
    expect(amounts.d1).toBe(250_000)
    expect(amounts.d2).toBe(70_000)
    expect(amounts.d3).toBe(50_000)
    expect(amounts.d4).toBe(200_000)
    expect(amounts.d5).toBe(630_000) // 1 200 000 - (250k + 70k + 50k + 200k) = 630 000

    // Рендер режима «План»
    const appPlan = createSSRApp(Budget, { initialView: 'plan' })
    appPlan.use(router)
    const htmlPlan = await renderToString(appPlan)
    expect(htmlPlan).toContain('Доход семьи · оклады без бонусов')
    expect(htmlPlan).toContain(money(1_200_000))
    expect(htmlPlan).toContain('Ильяс')
    expect(htmlPlan).toContain('Динара')
    expect(htmlPlan).toContain('Куда уходит')
    expect(htmlPlan).toContain(money(630_000)) // Свободный остаток

    // 4. Изменение лимита статьи «Еда и быт» (d4)
    financeStore.setCategoryAmount('d4', 280_000)
    amounts = budgetAmounts(financeStore.householdDoc)
    expect(amounts.d4).toBe(280_000)
    expect(amounts.d5).toBe(550_000) // 630k - 80k = 550 000

    // 5. Управление окладом: исправление текущего и планирование повышения
    financeStore.correctSalary('a', 750_000)
    expect(salaryAt(financeStore.people[0], key)).toBe(750_000)

    // Планируем повышение через 6 месяцев
    financeStore.amendSalary('a', '2028-06', 900_000, 'Новый грейд')
    const change = nextSalaryChange(financeStore.people[0], key)
    expect(change).not.toBeNull()
    expect(change?.amount).toBe(900_000)
    expect(change?.delta).toBe(150_000)

    // 6. Проверка режима «Календарь»
    const appCalendar = createSSRApp(Budget, { initialView: 'calendar' })
    appCalendar.use(router)
    const htmlCalendar = await renderToString(appCalendar)
    expect(htmlCalendar).toContain('Отложено')
    expect(htmlCalendar).toContain('На обязательства')
    expect(htmlCalendar).toContain('Нагрузка на доход')

    // 7. Проверка режима «Список»
    const appList = createSSRApp(Budget, { initialView: 'list' })
    appList.use(router)
    const htmlList = await renderToString(appList)
    expect(htmlList).toContain('Аренда квартиры')
    expect(htmlList).toContain('Автокредит')
    expect(htmlList).toContain('Зарплата · Ильяс')
    expect(htmlList).toContain('Зарплата · Динара')

    // 8. Сценарий Ритуала (/ritual):
    // А) Нет запланированного снижения
    await router.push('/ritual')
    expect(router.currentRoute.value.path).toBe('/ritual')

    const appRitualEmpty = createSSRApp(Ritual)
    appRitualEmpty.use(router)
    const htmlRitualEmpty = await renderToString(appRitualEmpty)
    expect(htmlRitualEmpty).toContain('Сейчас нет запланированных изменений, которые высвобождают деньги')

    // Б) Появляется будущее снижение аренды на 50 000 ₸
    financeStore.householdDoc.obligations[0].versions.push({
      from: '2027-01',
      amount: 200_000, // было 250_000, снижение на 50 000 ₸
    })

    const freed = nextChange(financeStore.householdDoc.obligations[0], key)
    expect(freed).not.toBeNull()
    expect(freed?.delta).toBe(-50_000)

    // Рендер активного экрана ритуала
    const appRitualActive = createSSRApp(Ritual)
    appRitualActive.use(router)
    const htmlRitualActive = await renderToString(appRitualActive)
    expect(htmlRitualActive).toContain('Куда направить 50 000 ₸')
    expect(htmlRitualActive).toContain('Отпуск в горах')
    expect(htmlRitualActive).toContain('Досрочно по кредиту')
    expect(htmlRitualActive).toContain('Качество жизни')

    // В) Распределение высвобожденных денег: 30 000 в цель, 20 000 на качество жизни
    const goalBefore = financeStore.goals[0]
    expect(goalBefore.monthly).toBe(50_000)

    financeStore.setGoalMonthly(goalBefore.id, goalBefore.monthly + 30_000)
    expect(financeStore.goals[0].monthly).toBe(80_000)

    // Проверяем математику ускорения цели
    const remainingGoal = goalBefore.need - goalBefore.have
    const monthsOld = goalMonths(remainingGoal, 50_000)
    const monthsNew = goalMonths(remainingGoal, 80_000)
    expect(monthsOld).toBe(10) // 500 000 / 50 000
    expect(monthsNew).toBe(7)  // 500 000 / 80 000 = 6.25 -> 7
    expect(monthsOld - monthsNew).toBe(3) // На 3 месяца быстрее
  })
})
