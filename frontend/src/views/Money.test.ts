import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import {
  budgetAmounts,
  netWorth,
  cushionMonths,
  liquidCash,
  nextChange,
  untilPayday,
} from '@/lib/finance'
import { money, plain } from '@/lib/money'
import { renderScreen } from '@/test/screenState'
import Money from './Money.vue'
import History from './History.vue'

describe('views/Money.vue — финансовые показатели (расчёты бывшего Обзора, B2C-14)', () => {
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


  it('рендерит «Деньги» (SSR): входы второго уровня; «Впереди» с платежами месяца и ссылка на календарь — на /money/history (B2C-21)', async () => {
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u-a', email: 'a@example.com', created_at: '' },
      household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
    })
    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '' }]
    store.householdDoc.obligations = [
      { id: 'ob-rent', name: 'Аренда квартиры', note: 'ежемесячно', day: 5, category: 'd1', versions: [{ from: '2026-01', amount: 200_000 }], updatedAt: '' },
    ]
    store.householdDoc.accounts = [{ id: 'acc-1', name: 'Kaspi Gold', note: '', kind: 'card', amount: 500_000, updatedAt: '' }]

    const html = await renderScreen(Money, '/money')
    for (const t of ['Бюджет', 'Капитал', 'План «Сначала долги»', 'История и итоги']) expect(html).toContain(t)
    expect(html).not.toContain('Впереди')
    const history = await renderScreen(History, '/money/history')
    for (const t of ['Впереди', 'Календарь', 'Аренда квартиры']) expect(history).toContain(t)
    expect(history).toContain('href="/money/budget"')
    // Прежнего героя «Свободно в …» и легенды здесь нет — они на главном и в Бюджете (B2C-14).
    expect(html).not.toContain('Свободно в')
    expect(html).not.toContain('распределено')
  })

  it('критик возврата 2: «Пришла зарплата» в «Деньгах» — по тому же условию, что главный и «Неделя» (salaryAsk): в день зарплаты своя есть, чужая и отмеченная — нет', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T07:00:00Z')) // 25 сентября, Алматы
    try {
      useAuthStore().setAuthData({
        token: 't',
        user: { id: 'u-a', email: 'a@example.com', created_at: '' },
        household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
        member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
      })
      const store = useFinanceStore()
      store.householdDoc.people = [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 25, updatedAt: '' },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 28, updatedAt: '' },
      ]
      expect(await renderScreen(Money, '/money')).toContain('Пришла зарплата')
      // Своя отмечена — ближайшая теперь чужая (28-го): кнопки нет.
      store.markSalary('a', { period: '2026-09', amount: 700_000, accountId: null })
      expect(await renderScreen(Money, '/money')).not.toContain('Пришла зарплата')
    } finally {
      vi.useRealTimers()
    }
  })

  it('критик возврата 3 (правило 12): «Освободится» и «Пришла зарплата» на одном экране — брендовая одна («Распределить»), без события — брендовая «Пришла зарплата»', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z')) // 17 сентября, Алматы — день зарплаты
    try {
      useAuthStore().setAuthData({
        token: 't',
        user: { id: 'u-a', email: 'a@example.com', created_at: '' },
        household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
        member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
      })
      const store = useFinanceStore()
      store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 17, updatedAt: '' }]
      const brand = (html: string) =>
        [...html.matchAll(/<button[^>]*class="[^"]*bg-brand text-brand-ink[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim())
      expect(brand(await renderScreen(Money, '/money'))).toEqual(['Пришла зарплата'])
      store.householdDoc.obligations = [
        { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 300_000 }, { from: '2026-10', amount: 220_000 }], updatedAt: '' },
      ]
      const html = await renderScreen(Money, '/money')
      expect(html).toContain('Пришла зарплата')
      expect(brand(html)).toEqual(['Распределить'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('«Освободится»: сумма из freedChange (годовое — доля в месяц и разница за год), пояснение — одной строкой, без Callout о переезде; «До зарплаты» — без абзацев (критик Блока 3)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z')) // 17 сентября, Алматы
    try {
      useAuthStore().setAuthData({
        token: 't',
        user: { id: 'u-a', email: 'a@example.com', created_at: '' },
        household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
        member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
      })
      const store = useFinanceStore()
      store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 25, updatedAt: '' }]
      // Страховка раз в год 60 000, с октября — 48 000: в месяц освобождается 1 000, за год — 12 000 (а не 12 000 и 144 000).
      store.householdDoc.obligations = [
        {
          id: 'ins', name: 'Страховка', note: '', day: 5, month: 3, every: 'year', category: 'd1',
          versions: [{ from: '2026-01', amount: 60_000 }, { from: '2026-10', amount: 48_000 }], updatedAt: '',
        },
        { id: 'net', name: 'Интернет', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 10_000 }], updatedAt: '' },
      ]
      let html = await renderScreen(Money, '/money')
      expect(html).toContain('С октября')
      expect(html).toContain(`Освободится ${money(1_000)} в месяц`)
      expect(html).toContain(`Страховка: ${plain(60_000)} → ${plain(48_000)} ₸ · ${money(12_000)} за год`)
      expect(html).not.toContain(money(144_000))
      expect(html).not.toContain('Перед экономией')
      expect(html).not.toContain('переезд')
      // Счёта нет — одна строка вместо абзаца.
      expect(html).toContain('Добавьте счёт в «Капитале» — покажем, хватит ли.')
      expect(html).not.toContain('приложение не знает')

      // Ежемесячное 300 000 → 220 000: 80 000 в месяц, 960 000 за год. На карте меньше списаний — одна фраза.
      store.householdDoc.obligations = [
        { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 300_000 }, { from: '2026-10', amount: 220_000 }], updatedAt: '' },
      ]
      store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi Gold', note: '', kind: 'card', amount: 100_000, updatedAt: '' }]
      html = await renderScreen(Money, '/money')
      expect(html).toContain(`Освободится ${money(80_000)} в месяц`)
      expect(html).toContain(`Аренда: ${plain(300_000)} → ${plain(220_000)} ₸ · ${money(960_000)} за год`)
      expect(html).toContain(`На счетах ${plain(100_000)} ₸ — не хватает ${plain(200_000)} ₸.`)
      expect(html).not.toContain('Перенесите платёж')
    } finally {
      vi.useRealTimers()
    }
  })
})
