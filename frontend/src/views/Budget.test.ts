import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import {
  amountAt,
  budgetAmounts,
  dueIn,
  liveCredits,
  liveObligations,
  nextSalaryChange,
  salaryAt,
} from '@/lib/finance'
import { monthKey } from '@/lib/dates'
import { money } from '@/lib/money'
import Budget from './Budget.vue'

describe('views/Budget.vue — План, Календарь, Список и оклады', () => {
  const storageMap = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, String(val)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage)
    mockLocalStorage.clear()
    setActivePinia(createPinia())
  })

  it('корректно формирует и сортирует события календаря по дням', () => {
    const store = useFinanceStore()
    const key = monthKey()

    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Динара', salary: 400_000, payday: 20, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда квартиры',
        note: 'ежемесячно',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 200_000 }],
        updatedAt: '',
      },
      {
        id: 'ob-yearly',
        name: 'Страховка',
        note: 'раз в год',
        day: 15,
        category: 'd1',
        every: 'year',
        month: 1, // если сейчас не январь, dueIn вернет false
        versions: [{ from: '2026-01', amount: 120_000 }],
        updatedAt: '',
      },
    ]
    store.householdDoc.credits = [
      {
        id: 'cr-car',
        name: 'Автокредит',
        note: '',
        principal: 3_000_000,
        annualRate: 0.18,
        payment: 75_000,
        day: 12,
        updatedAt: '',
      },
    ]

    const amounts = budgetAmounts(store.householdDoc)

    // Формируем события как в Budget.vue
    const obligations = liveObligations(store.obligations)
    const credits = liveCredits(store.credits)
    const people = store.people

    const events = [
      ...people.map((p) => ({
        id: `pay-${p.id}`,
        day: p.payday,
        name: `Зарплата · ${p.name}`,
        value: salaryAt(p, key),
        income: true,
      })),
      ...obligations.filter((o) => dueIn(o, key)).map((o) => ({
        id: o.id,
        day: o.day,
        name: o.name,
        value: amountAt(o, key),
        income: false,
      })),
      ...credits.map((c) => ({
        id: c.id,
        day: c.day,
        name: c.name,
        value: c.payment,
        income: false,
      })),
      {
        id: 'goals',
        day: 1,
        name: 'Взносы в цели',
        value: amounts.d3,
        income: false,
      },
    ].sort((a, b) => a.day - b.day)

    // Первым должно идти событие целей (день 1)
    expect(events[0].id).toBe('goals')
    expect(events[0].day).toBe(1)

    // Вторым — аренда (день 5)
    expect(events[1].id).toBe('ob-rent')
    expect(events[1].day).toBe(5)
    expect(events[1].value).toBe(200_000)

    // Третьим — зарплата Ильяса (день 10)
    expect(events[2].id).toBe('pay-a')
    expect(events[2].day).toBe(10)
    expect(events[2].income).toBe(true)

    // Четвертым — автокредит (день 12)
    expect(events[3].id).toBe('cr-car')
    expect(events[3].day).toBe(12)

    // Пятым — зарплата Динары (день 20)
    expect(events[4].id).toBe('pay-b')
    expect(events[4].day).toBe(20)

    // Фильтрация по выбранному дню
    const day5Events = events.filter((e) => e.day === 5)
    expect(day5Events).toHaveLength(1)
    expect(day5Events[0].name).toBe('Аренда квартиры')
  })

  it('изменение лимита категории d4 реактивно пересчитывает свободный остаток d5', () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 500_000, payday: 10, updatedAt: '' },
    ]
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 150_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 100_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 150_000, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-1',
        name: 'Квартира',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 150_000 }],
        updatedAt: '',
      },
    ]

    const before = budgetAmounts(store.householdDoc)
    expect(before.d4).toBe(100_000)
    expect(before.d5).toBe(250_000) // 500k - 150k (housing) - 100k (d4) = 250k

    // Изменяем d4 через метод хранилища
    store.setCategoryAmount('d4', 180_000)

    const after = budgetAmounts(store.householdDoc)
    expect(after.d4).toBe(180_000)
    expect(after.d5).toBe(170_000) // 500k - 150k (housing) - 180k (d4) = 170k
  })

  it('методы управления окладом correctSalary и amendSalary обновляют данные и вычисляют nextSalaryChange', () => {
    const store = useFinanceStore()
    const key = monthKey()

    store.householdDoc.people = [
      {
        id: 'a',
        name: 'Ильяс',
        salary: 500_000,
        salaryVersions: [{ from: '2026-01', amount: 500_000 }],
        payday: 10,
        updatedAt: '',
      },
    ]

    const person = store.people[0]
    expect(salaryAt(person, key)).toBe(500_000)
    expect(nextSalaryChange(person, key)).toBeNull()

    // Исправление оклада сейчас
    store.correctSalary('a', 550_000)
    expect(salaryAt(store.people[0], key)).toBe(550_000)

    // Запланированное повышение в будущем (2028-01)
    store.amendSalary('a', '2028-01', 700_000, 'Повышение в должности')
    const updated = store.people[0]
    const change = nextSalaryChange(updated, key)

    expect(change).not.toBeNull()
    expect(change?.from).toBe('2028-01')
    expect(change?.amount).toBe(700_000)
    expect(change?.delta).toBe(150_000)
    expect(change?.reason).toBe('Повышение в должности')
  })

  it('компонентный рендер Budget.vue отображает основные секции и элементы', async () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Динара', salary: 400_000, payday: 20, updatedAt: '' },
    ]
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 100_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 250_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 400_000, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда жилья',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 200_000 }],
        updatedAt: '',
      },
    ]

    const router = createAppRouter(createMemoryHistory())
    const app = createSSRApp(Budget)
    app.use(router)

    const html = await renderToString(app)

    // Проверяем элементы Segmented
    expect(html).toContain('План')
    expect(html).toContain('Календарь')
    expect(html).toContain('Список')

    // Проверяем дефолтный режим 'План'
    expect(html).toContain('Доход семьи · оклады без бонусов')
    expect(html).toContain(money(1_000_000)) // 600k + 400k
    expect(html).toContain('Ильяс')
    expect(html).toContain('Динара')
    expect(html).toContain('Куда уходит')
    expect(html).toContain('Жильё')
    expect(html).toContain('Еда и быт')
    expect(html).toContain('Свободно')
    expect(html).toContain('Откуда эти суммы')

    // Проверяем рендер в режиме 'Календарь'
    const appCalendar = createSSRApp(Budget, { initialView: 'calendar' })
    appCalendar.use(router)
    const htmlCalendar = await renderToString(appCalendar)
    expect(htmlCalendar).toContain('Отложено')
    expect(htmlCalendar).toContain('На обязательства')
    expect(htmlCalendar).toContain('Пн')
    expect(htmlCalendar).toContain('Вс')
    expect(htmlCalendar).toContain('Нагрузка на доход')
    expect(htmlCalendar).toContain('Кредиты')
    expect(htmlCalendar).toContain('Вместе с жильём')

    // Проверяем рендер в режиме 'Список'
    const appList = createSSRApp(Budget, { initialView: 'list' })
    appList.use(router)
    const htmlList = await renderToString(appList)
    expect(htmlList).toContain('Аренда жилья')
    expect(htmlList).toContain('Зарплата · Ильяс')
    expect(htmlList).toContain('Зарплата · Динара')
    expect(htmlList).toContain('Взносы в цели')
  })
})
