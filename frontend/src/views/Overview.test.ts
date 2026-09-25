import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import {
  budgetAmounts,
  netWorth,
  cushionMonths,
  liquidCash,
  nextChange,
  untilPayday,
} from '@/lib/finance'
import { planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen } from '@/test/screenState'
import Overview from './Overview.vue'

describe('views/Overview.vue — Финансовые показатели, капитал и подушка безопасности', () => {
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

  it('корректно рассчитывает совокупный капитал (netWorth) при наличии нескольких счетов, депозитов и кредитов', () => {
    const store = useFinanceStore()

    // 1. Активы: 2 карты + 1 депозит
    store.householdDoc.accounts = [
      { id: 'acc-1', name: 'Kaspi Gold', note: '', kind: 'card', amount: 350_000, updatedAt: '' },
      { id: 'acc-2', name: 'Halyk Bonus', note: '', kind: 'card', amount: 150_000, updatedAt: '' },
      { id: 'acc-3', name: 'Депозит Kaspi', note: '', kind: 'deposit', amount: 1_200_000, updatedAt: '' },
    ]

    // 2. Накопления в целях (без привязанного счёта)
    store.householdDoc.goals = [
      {
        id: 'g-vacation',
        name: 'Отпуск',
        need: 800_000,
        seed: 200_000,
        have: 200_000,
        monthly: 50_000,
        hue: 'teal',
        planPct: 0.25,
        movements: [],
        updatedAt: '',
      },
    ]

    // 3. Долги: автокредит и рассрочка
    store.householdDoc.credits = [
      {
        id: 'cr-auto',
        name: 'Автокредит',
        note: '',
        principal: 1_400_000,
        annualRate: 0.19,
        payment: 75_000,
        day: 15,
        updatedAt: '',
      },
      {
        id: 'cr-phone',
        name: 'Рассрочка телефон',
        note: '',
        principal: 200_000,
        annualRate: 0,
        payment: 20_000,
        day: 10,
        updatedAt: '',
      },
    ]

    // Активы: 350k + 150k + 1.2M + 200k (цель) = 1.9M ₸
    // Обязательства по долгам: 1.4M + 200k = 1.6M ₸
    // Капитал: 1.9M - 1.6M = 300 000 ₸
    const total = netWorth(store.accounts, store.credits, store.goals)
    expect(total).toBe(300_000)
  })

  it('корректно рассчитывает месячную дельту (доходы минус расходы) и свободный остаток', () => {
    const store = useFinanceStore()

    // Доходы семьи
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Аруна', salary: 400_000, payday: 20, updatedAt: '' },
    ]

    // Жилье (d1)
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 250_000 }],
        updatedAt: '',
      },
    ]

    // Кредит (d2)
    store.householdDoc.credits = [
      {
        id: 'cr-1',
        name: 'Кредит',
        note: '',
        principal: 500_000,
        annualRate: 0.2,
        payment: 50_000,
        day: 12,
        updatedAt: '',
      },
    ]

    // Цель (d3)
    store.householdDoc.goals = [
      {
        id: 'g-1',
        name: 'Цель',
        need: 600_000,
        seed: 0,
        have: 0,
        monthly: 100_000,
        hue: 'blue',
        planPct: 0,
        movements: [],
        updatedAt: '',
      },
    ]

    // Быт (d4)
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 250_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 100_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 0, updatedAt: '' },
    ]

    // Доход = 700k + 400k = 1 100 000 ₸
    // Расходы: d1(250k) + d2(50k) + d3(100k) + d4(200k) = 600 000 ₸
    // Свободно d5 = 1 100 000 - 600 000 = 500 000 ₸
    const amounts = budgetAmounts(store.householdDoc)
    expect(amounts.income).toBe(1_100_000)
    expect(amounts.d1).toBe(250_000)
    expect(amounts.d2).toBe(50_000)
    expect(amounts.d3).toBe(100_000)
    expect(amounts.d4).toBe(200_000)
    expect(amounts.d5).toBe(500_000)
  })

  it('рассчитывает подушку безопасности (cushionMonths) и статус покрытия', () => {
    const store = useFinanceStore()

    store.householdDoc.accounts = [
      { id: 'a1', name: 'Карта Kaspi', note: '', kind: 'card', amount: 600_000, updatedAt: '' },
      { id: 'a2', name: 'Наличные', note: '', kind: 'cash', amount: 150_000, updatedAt: '' },
      { id: 'a3', name: 'Депозит долгосрочный', note: '', kind: 'deposit', amount: 2_000_000, updatedAt: '' },
    ]

    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '' },
    ]

    // Месяц обязательных расходов — числом (его считает planMandatory; ревью Блока 3 Н-7).
    const mandatory = 400_000

    // Ликвидные средства (карты + нал, без депозита): 600k + 150k = 750 000 ₸
    const cash = liquidCash(store.accounts)
    expect(cash).toBe(750_000)

    // Подушка: 750 000 / 400 000 = 1.9 месяца
    const months = cushionMonths(store.accounts, mandatory)
    expect(months).toBe(1.9)
  })

  it('рассчитывает событие высвобождения средств (nextChange) при планируемом снижении платежа', () => {
    const obligation = {
      id: 'ob-rent',
      name: 'Аренда квартиры',
      note: '',
      day: 5,
      category: 'd1' as const,
      versions: [
        { from: '2026-01', amount: 300_000 },
        { from: '2026-10', amount: 220_000, reason: 'Переезд в меньшую квартиру' },
      ],
      updatedAt: '',
    }

    const change = nextChange(obligation, '2026-09')
    expect(change).not.toBeNull()
    expect(change?.from).toBe('2026-10')
    expect(change?.amount).toBe(220_000)
    // Освободится: 220 000 - 300 000 = -80 000 (delta отрицательная, высвобождение)
    expect(change?.delta).toBe(-80_000)
  })

  it('рассчитывает график до зарплаты (untilPayday)', () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 15, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-util',
        name: 'Коммуналка',
        note: '',
        day: 10,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 35_000 }],
        updatedAt: '',
      },
    ]

    const payday = untilPayday(store.householdDoc, { day: 8, key: '2026-09' })
    expect(payday).not.toBeNull()
    expect(payday?.who.name).toBe('Ильяс')
    expect(payday?.inDays).toBe(7) // с 8-го до 15-го
    expect(payday?.due).toHaveLength(1)
    expect(payday?.due[0].name).toBe('Коммуналка')
    expect(payday?.dueTotal).toBe(35_000)
  })

  it('рендерит Overview.vue с моковыми данными хранилища (компонентный рендер)', async () => {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createMemoryHistory } = await import('vue-router')
    const { createAppRouter } = await import('@/router')
    const { default: Overview } = await import('./Overview.vue')

    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '' },
    ]
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 300_000, updatedAt: '' },
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
    ]
    store.householdDoc.goals = [
      {
        id: 'g-cushion',
        name: 'Подушка безопасности',
        need: 1_000_000,
        seed: 350_000,
        have: 350_000,
        monthly: 50_000,
        hue: 'teal',
        planPct: 0.35,
        movements: [],
        updatedAt: '',
      },
    ]
    store.householdDoc.accounts = [
      { id: 'acc-1', name: 'Kaspi Gold', note: '', kind: 'card', amount: 500_000, updatedAt: '' },
    ]

    const router = createAppRouter(createMemoryHistory())
    const app = createSSRApp(Overview)
    app.use(router)

    const html = await renderToString(app)

    // Проверяем наличие ключевых секций и элементов разметки эталона
    expect(html).toContain('Пригласите партнёра') // people.length < 2
    expect(html).toContain('Свободно в')
    expect(html).toContain('Доход')
    expect(html).toContain('распределено')
    expect(html).toContain('Впереди')
    expect(html).toContain('Календарь')
    expect(html).toContain('Аренда квартиры')
    expect(html).toContain('Цели')
    expect(html).toContain('Подушка безопасности')
    expect(html).toContain('35%')
  })
})


describe('PV-01 — закрытый кредит вне «Свободно» Обзора', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('кредит закрыт досрочкой → «Свободно в …» выросло ровно на его платёж', async () => {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createMemoryHistory } = await import('vue-router')
    const { createAppRouter } = await import('@/router')
    const { money } = await import('@/lib/money')
    const { default: Overview } = await import('./Overview.vue')
    const render = () => {
      const app = createSSRApp(Overview)
      app.use(createAppRouter(createMemoryHistory()))
      return renderToString(app)
    }

    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 1_000_000, payday: 10, updatedAt: '' }]
    store.householdDoc.categories = [{ key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: '' }]
    store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi', note: '', kind: 'card', amount: 2_000_000, updatedAt: '' }]
    store.householdDoc.credits = [
      { id: 'cr-a', name: 'Рассрочка', note: '', principal: 300_000, annualRate: 0.24, payment: 60_000, day: 12, updatedAt: '' },
      { id: 'cr-b', name: 'Банк', note: '', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: '' },
    ]

    expect(await render()).toContain(money(648_320))
    store.applyPrepayment('cr-a', 'a', { amount: 300_000, mode: 'term', accountId: 'card' })
    const html = await render()
    expect(html).toContain(money(708_320))
    expect(html).not.toContain(money(648_320))
  })
})

describe('PV-15: сегменты Обзора — «Досрочно по плану» и разделы по ключам (SSR)', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  /** Строка легенды: название — сумма. */
  const legend = (html: string, name: string) => {
    const at = html.indexOf(`<span class="text-ink-2">${name}</span>`)
    if (at < 0) return null
    const m = html.slice(at).match(/(\d[\d\s\u00a0\u202f]*?)[\s\u00a0\u202f]*₸/)
    return m ? Number(m[1].replace(/\D/g, '')) : null
  }

  it('с планом — «Досрочно по плану» = Σ взносов пауз, «Цели» без них, «Свободно» и «Свободно в …» как без плана', async () => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    const before = await renderScreen(Overview, '/')
    store.setHouseholdDoc(planFamilyDoc({ plans: [planOf()] }), 2)
    const html = await renderScreen(Overview, '/')
    expect(legend(html, 'Досрочно по плану')).toBe(100_000)
    expect(legend(before, 'Досрочно по плану')).toBeNull()
    expect(legend(html, 'Цели')).toBe(30_000)
    expect(legend(before, 'Цели')).toBe(130_000)
    expect(legend(html, 'Свободно')).toBe(legend(before, 'Свободно'))
  })

  it('Н-4: пока план набирает подушку — в легенде «По плану — в подушку» с той же суммой', async () => {
    const store = useFinanceStore()
    const thin = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 150_000, seed: 150_000 } : g))
    store.setHouseholdDoc(planFamilyDoc({ goals: thin, plans: [planOf()] }), 1)
    const html = await renderScreen(Overview, '/')
    expect(legend(html, 'По плану — в подушку')).toBe(100_000)
    expect(legend(html, 'Досрочно по плану')).toBeNull()
  })

  it('п. 7: раздела d1 нет, аренда в d1 — сегмент и строка «Жильё»; без аренды — нет', async () => {
    const store = useFinanceStore()
    const categories = planFamilyDoc().categories.filter((c) => c.key === 'd4')
    store.setHouseholdDoc(planFamilyDoc({ categories }), 1)
    const html = await renderScreen(Overview, '/')
    expect(legend(html, 'Жильё')).toBe(220_000)
    // Сегменты легенды с «Свободно» складываются в доход — без плана и с ним.
    const names = ['Жильё', 'Кредиты', 'Цели', 'Еда и быт', 'Свободно']
    const income = budgetAmounts({ ...store.householdDoc, credits: store.credits }).income
    const sum = (h: string, list: string[]) => list.reduce((a, n) => a + (legend(h, n) ?? NaN), 0)
    expect(sum(html, names)).toBe(income)
    store.setHouseholdDoc(planFamilyDoc({ categories, plans: [planOf()] }), 2)
    expect(sum(await renderScreen(Overview, '/'), [...names, 'Досрочно по плану'])).toBe(income)
    store.setHouseholdDoc(planFamilyDoc({ categories, obligations: [] }), 3)
    expect(legend(await renderScreen(Overview, '/'), 'Жильё')).toBeNull()
  })
})
