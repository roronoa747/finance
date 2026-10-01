import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import {
  budgetAmounts,
  freeByFact,
  netWorth,
  cushionMonths,
  liquidCash,
  nextChange,
  untilPayday,
} from '@/lib/finance'
import { money, pct, plain } from '@/lib/money'
import type { SyncDoc } from '@/types/finance'
import type { SpendTotal } from '@/lib/statements/types'
import { authAs, planFamilyDoc, planOf, T0 } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import Money from './Money.vue'

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


  describe('пивот 3 (B2C-41): «Деньги» — сводка «До зарплаты», три квадрата, виджеты Доход · Еда и быт · Долги', () => {
    const total = (by: 'a' | 'b', period: string, categoryId: string, amount: number): SpendTotal => ({
      id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops: 1, updatedAt: T0,
    })
    const upload = { id: 'u1', slot: 'a' as const, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-11', ops_count: 10, created_at: T0 }
    // Текст как его видит человек: теги — пробел, переводы строк и пробелы шаблона схлопнуты (NBSP сумм остаются).
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
    // Лист в SSR рендерится на месте (без Teleport) — его текст отдельно от экрана.
    const dialog = (html: string) => {
      expect(html).toContain('role="dialog"')
      // Лист — внутри сводки, сразу за ним — квадраты «Денег».
      const at = html.indexOf('role="dialog"')
      return html.slice(at, html.indexOf('aria-label="Деньги"', at))
    }
    const squares = (html: string) => {
      const at = html.indexOf('aria-label="Деньги"')
      return html.slice(at, html.indexOf('</div>', at))
    }

    // Семья `planFamilyDoc`: Ильяс 700 000 (10-го), Аруна 500 000 (20-го), аренда 220 000 (5-го), три долга
    // (15-го, 22-го, 25-го), еда и быт 150 000. «Сейчас» — 12 сентября: до зарплаты Аруны 8 дней.
    async function family(role: 'member' | 'viewer' = 'member', extra: Partial<SyncDoc> = {}, uploads: (typeof upload)[] = []) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
      setActivePinia(createPinia())
      useAuthStore().setAuthData(authAs(role, 'a'))
      useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
      vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads })
      await useOperationsStore().loadUploads()
      return useFinanceStore()
    }
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('сводка: дни до зарплаты, K списаний и сумма — из untilPayday, «хватает» и остаток; «Оплатил» уменьшает K и сумму', async () => {
      const store = await family()
      const p = untilPayday({ people: store.people, obligations: store.obligations, credits: store.credits, accounts: store.householdAccounts, payments: store.payments })!
      expect(p.inDays).toBe(8)
      expect(p.due.map((d) => d.name)).toEqual(['Кредит'])
      expect(p.dueTotal).toBe(58_000)
      let html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('До зарплаты 8 дней')
      expect(html).toContain(`1 списание · ${plain(58_000)} ₸ · остаётся ${plain(p.shortfall)} ₸`)
      expect(html).toContain('хватает')
      // «Впереди», меню входов и «Свободно до конца месяца» ушли (Р-31, Р-32).
      for (const gone of ['Впереди', 'Календарь', 'История и итоги', 'Свободно до конца месяца']) expect(html).not.toContain(gone)
      // Лист «До зарплаты» — те же строки с «Оплатил» и строка зарплаты.
      const sheet = text(dialog(await renderScreen(Money, '/money', undefined, [screenMixin({ open: true })])))
      for (const t of ['До зарплаты', 'Кредит', 'Оплатил', 'Аруна']) expect(sheet).toContain(t)
      store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('Списаний нет')
      expect(html).not.toContain('1 списание')
    })

    it('сводка: на счетах меньше — «не хватает N ₸»; счетов нет — «Добавьте счёт»; оклада нет ни у кого — карточки нет', async () => {
      await family('member', { accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 20_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }] })
      let html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(`не хватает ${plain(38_000)} ₸`)
      expect(html).not.toContain('остаётся')
      await family('member', { accounts: [] })
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('Добавьте счёт — покажем, хватит ли')
      expect(html).not.toContain('хватает')
      await family('member', { people: planFamilyDoc().people.map((x) => ({ ...x, salary: 0 })) })
      html = text(await renderScreen(Money, '/money'))
      expect(html).not.toContain('До зарплаты')
    })

    it('квадраты: Капитал — чистых коротко, План — три состояния, История — «отметки» без операций; активный — по адресу', async () => {
      const store = await family()
      const worth = netWorth(store.accounts, store.credits, store.goals)
      let html = await renderScreen(Money, '/money')
      expect(text(squares(html))).toContain(`Капитал ${plain(worth)}`)
      expect(text(squares(html))).toContain('План гасить первым')
      expect(text(squares(html))).toContain('История отметки')
      expect(squares(html).match(/aria-current="page"/g)).toHaveLength(1)
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*<b[^>]*>Капитал/)
      store.householdDoc.plans = [planOf()]
      html = await renderScreen(Money, '/money/plan')
      expect(text(squares(html))).toContain('План сначала долги')
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*<b[^>]*>План/)
      // Сводка и виджеты — только у Капитала.
      expect(html).not.toContain('До зарплаты')
      expect(html).not.toContain('обязательное')
      store.householdDoc.plans = []
      store.householdDoc.credits = []
      html = await renderScreen(Money, '/money/history')
      expect(text(squares(html))).toContain('План долгов нет')
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*<b[^>]*>История/)
    })

    it('«Доход»: оклады, нагрузка = доля жилья и кредитов (формула Бюджета), доли в легенде, строки участников с днём', async () => {
      const store = await family()
      const a = budgetAmounts({ ...store.householdDoc, credits: store.credits })
      expect(a).toMatchObject({ d1: 220_000, d2: 103_000, d3: 130_000, d4: 150_000, d5: 597_000, income: 1_200_000 })
      const html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(money(1_200_000))
      expect(html).toContain(`нагрузка ${pct(a.d1 + a.d2, a.income)} %`)
      expect(html).toContain('нагрузка 27 %')
      for (const t of ['обязательное 27 %', 'мечты 11 %', 'еда и быт 13 %', 'свободно 50 %']) expect(html).toContain(t)
      expect(html).toContain(`Ильяс 10-го ${money(700_000)}`)
      expect(html).toContain(`Аруна 20-го ${money(500_000)}`)
      expect(html).not.toContain('План не сходится')
    })

    it('«Еда и быт»: факт — траты по выпискам без разделов плана (= вычитаемое «Свободно»), план — база d4; без загрузок — «—» без тега', async () => {
      const totals = [total('a', '2026-09', 'sc_food', 90_000), total('b', '2026-09', 'sc_cafe', 30_000), total('a', '2026-09', 'sc_credit', 58_000)]
      const store = await family('member', { spendTotals: totals }, [upload])
      const fact = freeByFact({ ...store.householdDoc, credits: store.credits }, totals, store.householdDoc.spendCategories ?? [], '2026-09', [upload]).spent
      expect(fact).toBe(120_000)
      const html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(`${money(fact)} план ${plain(150_000)}`)
      expect(html).toContain('по выпискам 80 %')
      await family('member', { spendTotals: totals }, [])
      const none = text(await renderScreen(Money, '/money'))
      expect(none).toContain(`— план ${plain(150_000)}`)
      expect(none).not.toContain('по выпискам')
    })

    it('«Долги»: остаток красным, «в сентябре оплачено N из M» растёт после «Оплатил», «чистых» = netWorth; без долгов — «Долгов нет»', async () => {
      const store = await family()
      let html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(`−${money(1_540_000)}`)
      expect(html).toContain('в сентябре оплачено 0 из 3')
      expect(html).toContain(`чистых ${money(netWorth(store.accounts, store.credits, store.goals))}`)
      store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('в сентябре оплачено 1 из 3')
      // «Чистый капитал» карточкой больше нет — он строкой в «Долгах» (Р-33).
      expect(html).not.toContain('Чистый капитал')
      store.householdDoc.credits = []
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('Долгов нет')
      expect(html).not.toContain('оплачено')
    })

    it('viewer: оклады и план «Еды и быта» — текстом, без кнопок; в листе «До зарплаты» нет «Оплатил»', async () => {
      await family('viewer')
      const html = await renderScreen(Money, '/money')
      expect(text(html)).toContain(`план ${plain(150_000)}`)
      expect(html).not.toMatch(/<button[^>]*>\s*план/)
      expect(html).not.toMatch(/<button[^>]*>\s*<span[^>]*title="Ильяс"/)
      expect(html).toMatch(/<div[^>]*>\s*<span[^>]*title="Ильяс"/)
      const sheet = text(dialog(await renderScreen(Money, '/money', undefined, [screenMixin({ open: true })])))
      expect(sheet).toContain('Кредит')
      expect(sheet).not.toContain('Оплатил')
      expect(sheet).not.toContain('Пришла зарплата')
    })
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
      expect(html).toContain('Добавьте счёт — покажем, хватит ли')
      expect(html).not.toContain('приложение не знает')

      // Ежемесячное 300 000 → 220 000: 80 000 в месяц, 960 000 за год. На карте меньше списаний — одна фраза.
      store.householdDoc.obligations = [
        { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 300_000 }, { from: '2026-10', amount: 220_000 }], updatedAt: '' },
      ]
      store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi Gold', note: '', kind: 'card', amount: 100_000, updatedAt: '' }]
      html = await renderScreen(Money, '/money')
      expect(html).toContain(`Освободится ${money(80_000)} в месяц`)
      expect(html).toContain(`Аренда: ${plain(300_000)} → ${plain(220_000)} ₸ · ${money(960_000)} за год`)
      // Сводка «До зарплаты» (пивот 3): аренда 300 000 до 25-го, на счетах 100 000 — тег «не хватает».
      expect(html).toContain(`не хватает ${plain(200_000)} ₸`)
      expect(html).not.toContain('Перенесите платёж')
    } finally {
      vi.useRealTimers()
    }
  })
})
