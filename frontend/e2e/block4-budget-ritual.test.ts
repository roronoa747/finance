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
} from '../src/lib/finance'
import { monthKey } from '../src/lib/dates'
import { money, plain } from '../src/lib/money'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import { screenMixin } from '../src/test/screenState'

describe('e2e / block-4 — Сквозной сценарий бюджета («Деньги»: Доход, Платежи) и Ритуала высвобождения', () => {
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
      household: { id: 'h-family', name: 'Семья Ильясовых', created_by: 'u-ilyas', created_at: '2026-09-23T10:00:00Z' },
      member: {
        joined_at: '2026-09-23T10:00:00Z',
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

    // 2. Старый адрес Бюджета — квадрат «Капитал» «Денег» (пивот 3, Р-31); экрана Бюджета нет (B2C-45)
    await router.push('/budget')
    expect(router.currentRoute.value.path).toBe('/money')

    // 3. Проверка режима «План»
    let amounts = budgetAmounts(financeStore.householdDoc)
    expect(amounts.income).toBe(1_200_000)
    expect(amounts.d1).toBe(250_000)
    expect(amounts.d2).toBe(70_000)
    expect(amounts.d3).toBe(50_000)
    expect(amounts.d4).toBe(200_000)
    expect(amounts.d5).toBe(630_000) // 1 200 000 - (250k + 70k + 50k + 200k) = 630 000

    // Бывший режим «План» — виджет «Доход» «Денег» (Р-33): оклады, доли, нагрузка; свободный остаток —
    // долей «остаток по плану 53 %» (630 000 из 1 200 000), сумма — budgetAmounts выше.
    const appPlan = createSSRApp(Money)
    appPlan.use(router)
    const htmlPlan = (await renderToString(appPlan)).replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
    expect(htmlPlan).toContain(money(1_200_000))
    expect(htmlPlan).toContain('Ильяс')
    expect(htmlPlan).toContain('Динара')
    expect(htmlPlan).toContain('остаток по плану 53 %')
    // Нагрузка — жильё и кредиты (250 000 + 70 000) из 1 200 000 = 27 % (бывшая «Нагрузка на доход» календаря).
    expect(htmlPlan).toContain('нагрузка низкая')

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

    // 6–7. Календарь ушёл (Р-39), список платежей — «Платежи» Капитала (Р-32); зарплаты — строками «Дохода».
    const appList = createSSRApp(Money)
    appList.use(router)
    const htmlList = await renderToString(appList)
    // Прежние «Платежи» — под «Подробнее» (Блок 14).
    const more = htmlList.slice(htmlList.indexOf('data-more'))
    const payments = more.slice(more.indexOf('>Платежи<'))
    expect(payments).toContain('Аренда квартиры')
    expect(payments).toContain('Автокредит')
    expect(htmlList).toContain(money(750_000))

    // 8. Освободившиеся деньги (бывший /ritual → разбор → план месяца, Блок 14, Р-86):
    // А) Нет запланированного снижения — карточки в плане нет
    await router.push('/week/salary')
    expect(router.currentRoute.value.path).toBe('/month')

    // Блок 15: «Освободится» — подсказкой у своего платежа в разделе «Платежи» «Месяца».
    const appRitualEmpty = createSSRApp(Month)
    appRitualEmpty.use(router)
    appRitualEmpty.mixin(screenMixin({ opened: 'dues' }))
    const htmlRitualEmpty = await renderToString(appRitualEmpty)
    expect(htmlRitualEmpty).toContain('data-due')
    expect(htmlRitualEmpty).not.toContain('data-freed')

    // Б) Появляется будущее снижение аренды на 50 000 ₸
    financeStore.householdDoc.obligations[0].versions.push({
      from: '2027-01',
      amount: 200_000, // было 250_000, снижение на 50 000 ₸
    })

    const freed = nextChange(financeStore.householdDoc.obligations[0], key)
    expect(freed).not.toBeNull()
    expect(freed?.delta).toBe(-50_000)

    // Рендер активного экрана ритуала
    const appRitualActive = createSSRApp(Month)
    appRitualActive.use(router)
    appRitualActive.mixin(screenMixin({ opened: 'dues' }))
    const htmlRitualActive = await renderToString(appRitualActive)
    // Подсказка у платежа: +50 000 в месяц первой цели очереди, одна кнопка (Р-86).
    expect(htmlRitualActive).toContain('data-freed')
    expect(htmlRitualActive).toContain(`+${plain(50_000)} в месяц`)
    expect(htmlRitualActive).toMatch(/>\s*К «[^»]+»\s*</)

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
