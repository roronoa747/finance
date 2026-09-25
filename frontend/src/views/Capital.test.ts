import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import {
  netWorth,
  prepayment,
  lumpSum,
  debtCost,
  halfOverpayExtra,
  simulateStrategy,
} from '@/lib/finance'

describe('views/Capital.vue — Счета, кредиты, досрочное погашение и капитал', () => {
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

  it('расчёт совокупного капитала (netWorth) с комбинацией общих и приватных счетов', () => {
    const store = useFinanceStore()

    // Общие счета домохозяйства: 500_000 ₸
    store.addAccount({
      name: 'Семейная карта',
      kind: 'card',
      amount: 500_000,
    }, false)

    // Приватный счет пользователя: 300_000 ₸
    store.addAccount({
      name: 'Личная заначка',
      kind: 'cash',
      amount: 300_000,
    }, true)

    // Проверяем изоляцию в хранилище
    expect(store.householdAccounts).toHaveLength(1)
    expect(store.householdAccounts[0].name).toBe('Семейная карта')
    expect(store.privateAccounts).toHaveLength(1)
    expect(store.privateAccounts[0].name).toBe('Личная заначка')

    // В общем списке для активного пользователя видны оба
    expect(store.accounts).toHaveLength(2)

    // Добавляем долг: 400_000 ₸
    store.addCredit({
      name: 'Рассрочка',
      principal: 400_000,
      annualRate: 0,
      payment: 40_000,
      day: 15,
    })

    // Добавляем цель: накоплено 100_000 ₸
    store.addGoal({
      name: 'Подушка',
      need: 600_000,
      have: 100_000,
      monthly: 50_000,
      hue: 'ochre',
    })

    // Net Worth = (500_000 + 300_000) + 100_000 - 400_000 = 500_000
    const calculated = netWorth(store.accounts, store.credits, store.goals)
    expect(calculated).toBe(500_000)
  })

  it('досрочное погашение (prepayment): расчёт экономии и сокращения срока выплат', () => {
    // Кредит 1 000 000 ₸, ставка 20% годовых, базовый платёж ~ 50 000 ₸
    const principal = 1_000_000
    const annualRate = 0.20
    const basePayment = 50_000
    const extra = 25_000 // досрочная добавка

    const result = prepayment(principal, annualRate, basePayment, extra)

    expect(result.monthsNow).toBeGreaterThan(result.monthsAfter)
    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.saved).toBeGreaterThan(0)
    expect(result.overpayAfter).toBeLessThan(result.overpayNow)
  })

  it('разовый досрочный взнос (lumpSum) корректно снижает переплату и срок', () => {
    const principal = 800_000
    const annualRate = 0.18
    const payment = 45_000
    const lump = 200_000

    const result = lumpSum(principal, annualRate, payment, lump)

    expect(result.monthsSaved).toBeGreaterThan(0)
    expect(result.saved).toBeGreaterThan(0)
    expect(result.overpayNow - result.overpayAfter).toBe(result.saved)
  })

  it('debtCost и halfOverpayExtra выводят оптимальную добавку для кредита', () => {
    const principal = 500_000
    const annualRate = 0.24
    const payment = 30_000

    const cost = debtCost(principal, annualRate, payment)
    expect(cost.closes).toBe(true)
    expect(cost.monthlyInterest).toBeCloseTo((principal * annualRate) / 12)
    expect(cost.interestShare).toBeGreaterThan(0.2)

    const half = halfOverpayExtra(principal, annualRate, payment)
    expect(half).not.toBeNull()
    if (half) {
      expect(half).toBeGreaterThan(0)
      const prep = prepayment(principal, annualRate, payment, half)
      expect(prep.saved).toBeGreaterThanOrEqual((cost.overpay / 2) * 0.95)
    }
  })

  it('симуляция стратегий «копить» vs «гасить» (simulateStrategy)', () => {
    const debts = [{ principal: 600_000, annualRate: 0.22, payment: 35_000 }]
    const saving = 50_000
    const start = 100_000

    const resA = simulateStrategy({
      debts,
      saving,
      keep: saving,
      payDebts: false,
      start,
      months: 24,
    })

    const resB = simulateStrategy({
      debts,
      saving,
      keep: 0,
      payDebts: true,
      start,
      months: 24,
      buffer: 50_000,
      lump: 0,
    })

    expect(resA.savings).toBeGreaterThan(0)
    expect(resB.interestTotal).toBeLessThan(resA.interestTotal)
    expect(resB.net).toBeGreaterThan(resA.net)
  })

  it('рендерит Capital.vue с карточкой капитала, списком счетов и кредитов (компонентный рендер)', async () => {
    const store = useFinanceStore()

    store.addAccount({
      name: 'Основной Kaspi',
      kind: 'card',
      amount: 450_000,
    }, false)

    store.addAccount({
      name: 'Секретная заначка',
      kind: 'cash',
      amount: 150_000,
    }, true)

    store.addCredit({
      name: 'Кредитная карта',
      principal: 200_000,
      annualRate: 0.24,
      payment: 25_000,
      day: 10,
    })

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/capital', component: Capital }],
    })
    await router.push('/capital')
    await router.isReady()

    const app = createSSRApp(Capital)
    app.use(router)

    const html = await renderToString(app)

    expect(html).toContain('Чистый капитал')
    expect(html).toContain('Где лежат деньги')
    expect(html).toContain('Основной Kaspi')
    expect(html).toContain('Секретная заначка')
    expect(html).toContain('Личный')
    expect(html).toContain('Обязательства')
    expect(html).toContain('Кредитная карта')
  })

  it('рендерит модалку «Внеплановый доход» при переходе по маршруту /capital?income=1', async () => {
    const store = useFinanceStore()
    store.addGoal({
      name: 'Резерв',
      need: 500_000,
      have: 100_000,
      monthly: 50_000,
      hue: 'teal',
    })

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/capital', component: Capital }],
    })
    await router.push('/capital?income=1')
    await router.isReady()

    const app = createSSRApp(Capital)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Внеплановый доход')
    expect(html).toContain('Премия, подарок, возврат налога')
    expect(html).toContain('Резерв')
  })
})

describe('PV-02: калькулятор в Капитале (SSR)', () => {
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

  async function render(props: Record<string, unknown> = {}) {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/capital', component: Capital }] })
    await router.push('/capital')
    await router.isReady()
    const app = createSSRApp(Capital, props)
    app.use(router)
    return renderToString(app)
  }

  it('вкладка «Копить или гасить» — компонент StrategyCompare; закрытый кредит в расчёт не входит', async () => {
    const { money } = await import('@/lib/money')
    const store = useFinanceStore()
    store.addAccount({ name: 'Kaspi', kind: 'card', amount: 3_000_000 })
    store.addObligation({ name: 'Аренда', day: 5, category: 'd1', amount: 220_000 })
    store.addCredit({ name: 'Кредитка', principal: 300_000, annualRate: 0.4, payment: 30_000, day: 10 })
    store.addCredit({ name: 'Банк', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20 })
    store.addGoal({ name: 'Квартира', need: 5_000_000, have: 400_000, monthly: 150_000, hue: 'teal' })

    // По умолчанию — «Какой первым».
    expect(await render()).not.toContain('Одинаковые траты, разный порядок')

    // Кредитку закрыли досрочкой — в стратегии остаётся только «Банк».
    const card = store.credits[0].id
    store.applyPrepayment(card, 'a', { amount: 300_000, mode: 'term', accountId: store.accounts[0].id })
    expect(store.credits[0].principal).toBe(0)

    const html = await render({ initialAdvice: 'strategy' })
    expect(html).toContain('Одинаковые траты, разный порядок')
    expect(html).toContain('Горизонт')
    const debts = [{ principal: 1_000_000, annualRate: 0.18, payment: 91_680 }]
    const a = simulateStrategy({ debts, saving: 150_000, keep: 150_000, payDebts: false, start: 400_000, months: 36 })
    const b = simulateStrategy({ debts, saving: 150_000, keep: 0, payDebts: true, start: 400_000, months: 36, buffer: 312_000, lump: 0 })
    expect(html).toContain(money(a.savings))
    expect(html).toContain(money(b.savings))
    expect(html).toContain(money(Math.round(b.net - a.net)))
    // Подушка — аренда и платёж открытого долга: 220 000 + 91 680 → 312 000.
    expect(html).toContain(`Сначала подушка — ${money(312_000)}`)
  })
})

describe('PV-03: форма долга — ставка из срока и расхождение (SSR)', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
  })

  async function render(props: Record<string, unknown> = {}) {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/capital', component: Capital }] })
    await router.push('/capital?add=debt')
    await router.isReady()
    const app = createSSRApp(Capital, props)
    app.use(router)
    return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  }

  it('по маршруту /capital?add=debt — переключатель React и текст «Без них»', async () => {
    const html = await render()
    expect(html).toContain('Долг или рассрочка')
    for (const t of ['Без них', 'Знаю ставку', 'Знаю срок']) expect(html).toContain(`>${t}</button>`)
    expect(html).toContain('Рассрочка: платите ровно столько, сколько должны. Приложение посчитает, что долг закроется за — платежей.')
  })

  it('«Знаю срок», 1 000 000 / 10 000 / 12 — предупреждение с числами и «Записать всё равно можно»', async () => {
    const { plain } = await import('@/lib/money')
    const html = await render({ initialDebt: { mode: 'term', principal: '1 000 000', payment: '10 000', term: '12' } })
    expect(html).toContain('Сколько платежей осталось')
    expect(html).toContain(
      `12 платежей по ${plain(10_000)} — это ${plain(120_000)} ₸, а остаток вы указали ${plain(1_000_000)} ₸. Не хватает ${plain(880_000)} ₸: похоже, платежей 100, а не 12.`,
    )
    expect(html).toContain(
      'Записать всё равно можно: сохраним как рассрочку без процентов, а ставку поправите, когда сверитесь с банком.',
    )
    expect(html).not.toContain('Ставка получается')
  })

  it('«Знаю срок», 1 000 000 / 91 680 / 12 — «Ставка получается 18,0% годовых», предупреждения нет', async () => {
    const html = await render({ initialDebt: { mode: 'term', principal: '1 000 000', payment: '91 680', term: '12' } })
    expect(html).toContain('Ставка получается')
    expect(html).toContain('18,0% годовых')
    expect(html).not.toContain('Записать всё равно можно')
  })

  it('подписи формы — как React AddDebtDialog: «День платежа», кнопка «Добавить» (критик)', async () => {
    const html = await render()
    expect(html).toContain('День платежа')
    expect(html).not.toContain('День списания')
    expect(html).toMatch(/>\s*Добавить\s*<\/button>/)
    expect(html).not.toContain('Добавить долг')
  })
})

/* ---------------- Блок 2 паритета: правка денег ---------------- */

describe('PV-10: модалка кредита и калькулятор досрочки (SSR)', () => {
  const T0 = '2026-09-01T00:00:00.000Z'

  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function family(role: 'member' | 'viewer' = 'member') {
    const { useAuthStore } = await import('@/stores/auth')
    const { defaultSyncDoc } = await import('@/stores/finance')
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h', user_id: 'u', slot: 'a', display_name: 'Ильяс', role, joined_at: T0 },
    })
    const store = useFinanceStore()
    store.setHouseholdDoc(
      {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }],
        accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
        credits: [
          { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
          // Проценты 30 000 при платеже 25 000 — не закрывается.
          { id: 'card-debt', name: 'Кредитка', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.36, payment: 25_000, day: 5, updatedAt: T0 },
        ],
      },
      1,
    )
    return store
  }

  async function render(path: string, state: Record<string, unknown> = {}) {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/capital', component: Capital }] })
    await router.push(path)
    await router.isReady()
    const app = createSSRApp(Capital)
    app.use(router)
    app.mixin({
      created() {
        if (this.$.parent === null) Object.assign(this.$.setupState, state)
      },
    })
    return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  }

  it('участник: поля React, выводы из creditOutlook, кнопка калькулятора, удаление', async () => {
    const { money, plain } = await import('@/lib/money')
    const { creditOutlook } = await import('@/lib/finance')
    await family()
    const html = await render('/capital?credit=loan')
    for (const label of ['Название', 'Остаток долга, ₸', 'Платёж в месяц, ₸', 'Ставка (ГЭСВ), % годовых', 'День платежа', 'Примечание']) {
      expect(html).toContain(`>${label}</span>`)
    }
    expect(html).toContain(`value="${plain(1_000_000)}"`)
    expect(html).toContain('value="33,0"')
    expect(html).toContain('value="15"')
    const out = creditOutlook({ principal: 1_000_000, annualRate: 0.33, payment: 58_000 })
    expect(html).toContain('Платежей осталось')
    expect(html).toContain(`>${out.months}</b>`)
    expect(html).toContain('Переплата до конца')
    expect(html).toContain(money(out.overpay))
    expect(html).toContain('Посчитать досрочное погашение')
    expect(html).toContain('Удалить кредит')
    expect(html).not.toContain('Симулятор досрочного погашения')
  })

  it('платёж не покрывает проценты — текст React вместо выводов', async () => {
    await family()
    const html = await render('/capital?credit=card-debt')
    expect(html).toContain(
      'При таком платеже долг не закрывается: проценты съедают его целиком. Проверьте остаток, платёж и ставку.'.replace(/ /g, ' '),
    )
    expect(html).not.toContain('Платежей осталось')
  })

  it('viewer: полей и удаления нет, цифры видны', async () => {
    const { money } = await import('@/lib/money')
    await family('viewer')
    const html = await render('/capital?credit=loan')
    expect(html).not.toContain('Остаток долга, ₸')
    expect(html).not.toContain('Ставка (ГЭСВ), % годовых')
    expect(html).not.toContain('Удалить кредит')
    expect(html).not.toContain('<input')
    expect(html).toContain('Остаток долга')
    expect(html).toContain(money(1_000_000))
    expect(html).toContain('33,0%')
    expect(html).toContain('Платежей осталось')
  })

  it('калькулятор: «долг не закрывается» в шапке и подсказка без суммы', async () => {
    await family()
    const html = await render('/capital?payoff=card-debt')
    expect(html).toContain('Переплата, если не трогать')
    expect(html).toContain('долг не закрывается')
    expect(html).toContain('Впишите сумму, которую действительно можете внести. Приложение не станет предлагать больше — считать по деньгам, которых нет, смысла нет.')
    expect(html).not.toContain('Отдача падает')
  })

  it('калькулятор: подсказка поля — первый чип, чип «половина переплаты», лесенка «Отдача падает» с пояснением', async () => {
    const { money, plain } = await import('@/lib/money')
    const { halfOverpayExtra } = await import('@/lib/finance')
    await family()
    const half = halfOverpayExtra(1_000_000, 0.33, 58_000)!
    const chips = [29_000, 58_000, half].sort((a, b) => a - b)
    const html = await render('/capital?payoff=loan')
    expect(html).toContain(`placeholder="${plain(chips[0])}"`)
    expect(html).toContain('половина переплаты')
    expect(html).not.toContain('½')
    expect(html).toMatch(/>\s*Отдача падает\s*</)
    expect(html).toContain(
      `Половину переплаты снимает уже добавка в ${money(half)} — дальше каждая следующая тысяча даёт меньше предыдущей. Если больших сумм нет, начинать стоит отсюда.`,
    )

    // С суммой — результат React: «экономия …», «Останется N платежей вместо M».
    const withSum = await render('/capital?payoff=loan', { payoffAmount: plain(half) })
    expect(withSum).toMatch(/экономия \d/)
    expect(withSum).toMatch(/Останется \d+ платеж(а|ей)? вместо \d+\./)
    expect(withSum).not.toContain('Впишите сумму')
  })
})

describe('PV-11: форма платежа и модалка обязательства (SSR)', () => {
  const T0 = '2026-09-01T00:00:00.000Z'

  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function family(role: 'member' | 'viewer' = 'member', withCategories = true) {
    const { useAuthStore } = await import('@/stores/auth')
    const { defaultSyncDoc } = await import('@/stores/finance')
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h', user_id: 'u', slot: 'a', display_name: 'Ильяс', role, joined_at: T0 },
    })
    useFinanceStore().setHouseholdDoc(
      {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
        ],
        categories: withCategories
          ? [
              { key: 'd1', name: 'Дом', note: '', amount: 250_000, updatedAt: T0 },
              { key: 'd3', name: 'Цели', note: '', amount: 0, updatedAt: T0 },
              { key: 'd4', name: 'Еда и быт', note: '', amount: 300_000, updatedAt: T0 },
            ]
          : [],
        obligations: [
          {
            id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', who: 'b', updatedAt: T0,
            versions: [
              { from: '2026-01', amount: 200_000 },
              { from: '2026-11', amount: 220_000, reason: 'индексация' },
            ],
          },
          { id: 'ins', name: 'Страховка', note: '', day: 12, category: 'd4', every: 'year', month: 3, versions: [{ from: '2000-01', amount: 60_000 }], updatedAt: T0 },
        ],
      },
      1,
    )
  }

  async function render(path: string, state: Record<string, unknown> = {}) {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/capital', component: Capital }] })
    await router.push(path)
    await router.isReady()
    const app = createSSRApp(Capital)
    app.use(router)
    app.mixin({
      created() {
        if (this.$.parent === null) Object.assign(this.$.setupState, state)
      },
    })
    return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  }

  const pressed = (html: string, label: string) => new RegExp(`aria-pressed="true"[^>]*>\\s*${label}\\s*<`).test(html)
  const button = (label: string) => new RegExp(`>\\s*${label}\\s*</button>`)

  it('форма: «В какой раздел бюджета» — жильё, кредиты, быт (имена семьи), быт по умолчанию; флажок оценки', async () => {
    await family()
    const html = await render('/capital?add=payment')
    expect(html).toContain('В какой раздел бюджета')
    for (const name of ['Дом', 'Кредиты', 'Еда и быт']) expect(html).toMatch(button(name))
    expect(html).not.toMatch(button('Цели'))
    expect(html).not.toMatch(button('Свободно'))
    expect(pressed(html, 'Еда и быт')).toBe(true)
    expect(html).toContain('Сумма плавает — показывать как оценку')
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
  })

  it('форма в пустом документе — запасные имена разделов', async () => {
    await family('member', false)
    const html = await render('/capital?add=payment')
    for (const name of ['Жильё', 'Кредиты', 'Еда и быт']) expect(html).toMatch(button(name))
  })

  it('форма «Раз в год»: сетка месяцев и подсказка про двенадцатую часть', async () => {
    const { money } = await import('@/lib/money')
    await family()
    const html = await render('/capital?add=payment', { obEvery: 'year', obAmount: '60 000', obMonth: '3' })
    expect(html).toContain('Месяц списания')
    expect(pressed(html, 'Мар')).toBe(true)
    expect(html).toContain(
      `В плане месяца это займёт ${money(5_000)} — годовая сумма делится на двенадцать, чтобы не завышать одиннадцать месяцев и не удивляться на двенадцатый.`,
    )
  })

  it('модалка обязательства: поля React, «Чьё это», история суммы с причиной, удаление', async () => {
    const { money } = await import('@/lib/money')
    await family()
    const html = await render('/capital?obligation=rent')
    for (const label of ['Название', 'Сумма сейчас, ₸', 'День платежа', 'Как часто', 'Чьё это']) {
      expect(html).toContain(`>${label}</span>`)
    }
    expect(html).toContain(
      'Это исправление: сумма была введена неверно. Если платёж меняется с какого-то месяца — не трогайте это поле, а запланируйте изменение ниже.',
    )
    expect(pressed(html, 'Аруна')).toBe(true)
    expect(html).toContain('История суммы')
    const history = html.slice(html.indexOf('История суммы'))
    expect(history.indexOf('станет с ноября 2026')).toBeGreaterThan(-1)
    expect(history.indexOf('станет с ноября 2026')).toBeLessThan(history.indexOf('с января 2026'))
    expect(history).toContain(money(220_000))
    expect(history).toContain('индексация')
    expect(html).toContain('Удалить обязательство')
  })

  it('годовое: сетка месяцев с отмеченным и доля в плане месяца', async () => {
    const { money } = await import('@/lib/money')
    await family()
    const html = await render('/capital?obligation=ins')
    expect(pressed(html, 'Раз в год')).toBe(true)
    expect(pressed(html, 'Мар')).toBe(true)
    expect(html).toContain(`В плане месяца этот платёж занимает ${money(5_000)} — годовая сумма делится на двенадцать.`)
    // Одна версия — истории нет.
    expect(html).not.toContain('История суммы')
  })

  it('планирование: подсказка поля — нынешняя сумма, разница в месяц и за год, подсказка о месяце', async () => {
    const { money, plain } = await import('@/lib/money')
    await family()
    const html = await render('/capital?obligation=ins', { obPlanning: true, obNewAmount: '48 000', obFromMonth: '2026-11' })
    expect(html).toContain(`placeholder="${plain(60_000)}"`)
    expect(html).toContain(
      `С ноября 2026 освободится <b>${money(12_000)}</b> в месяц — ${money(144_000)} за год. Приложение предложит решить, куда их направить.`,
    )
    expect(html).toContain(
      'Месяц, который выберете, оплачивается уже по новой сумме. Если переезд в середине месяца, ставьте следующий: за текущий вы платите по-старому.',
    )
  })

  it('viewer: полей и удаления нет, история и цифры видны', async () => {
    const { money } = await import('@/lib/money')
    await family('viewer')
    const html = await render('/capital?obligation=rent')
    expect(html).not.toContain('Сумма сейчас, ₸')
    expect(html).not.toContain('Запланировать изменение')
    expect(html).not.toContain('Удалить обязательство')
    expect(html).not.toContain('<input')
    expect(html).toContain('Сумма сейчас')
    expect(html).toContain(money(200_000))
    expect(html).toContain('История суммы')
    expect(html).toContain('индексация')
  })
})

describe('PV-12: счета — валютный, удаление, тексты курса (SSR)', () => {
  const T0 = '2026-09-01T00:00:00.000Z'

  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function family(role: 'member' | 'viewer' = 'member') {
    const { useAuthStore } = await import('@/stores/auth')
    const { defaultSyncDoc } = await import('@/stores/finance')
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h', user_id: 'u', slot: 'a', display_name: 'Ильяс', role, joined_at: T0 },
    })
    useFinanceStore().setHouseholdDoc(
      {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }],
        accounts: [
          { id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 },
          { id: 'usd', name: 'Доллары', note: '', amount: 512_340, amountSetAt: T0, kind: 'cash', currency: 'USD', foreignAmount: 1_000, rate: 512.34, rateAt: T0, updatedAt: T0 },
        ],
        goals: [
          { id: 'flat', name: 'Квартира', need: 5_000_000, have: 400_000, monthly: 100_000, hue: 'teal', accountId: 'card', movements: [], updatedAt: T0 },
          { id: 'trip', name: 'Отпуск', need: 900_000, have: 150_000, monthly: 50_000, hue: 'teal', accountId: 'card', movements: [], updatedAt: T0 },
        ],
      },
      1,
    )
  }

  async function render(path: string, state: Record<string, unknown> = {}, probe?: (s: Record<string, unknown>) => void) {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Capital = (await import('./Capital.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/capital', component: Capital }] })
    await router.push(path)
    await router.isReady()
    const app = createSSRApp(Capital)
    app.use(router)
    app.mixin({
      created() {
        if (this.$.parent !== null) return
        Object.assign(this.$.setupState, state)
        probe?.(this.$.setupState)
      },
    })
    return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  }

  it('валютный счёт: сумма в валюте, курс и «по этому курсу»', async () => {
    const { money } = await import('@/lib/money')
    await family()
    const html = await render('/capital', { selectedAccountId: 'usd' })
    expect(html).toContain('>Сумма в USD</span>')
    expect(html).toContain('>Курс: сколько тенге за 1 USD</span>')
    expect(html).toContain('value="512,34"')
    expect(html).toContain(`В капитале счёт стоит как ${money(512_340)} — по этому курсу.`)
    expect(html).not.toContain('>Сумма, ₸</span>')
  })

  it('счёт в тенге: «Сумма, ₸»; удаление — текст React с целями на счёте', async () => {
    await family()
    let warning = ''
    const html = await render('/capital', { selectedAccountId: 'card' }, (s) => (warning = s.accountRemoveWarning as string))
    expect(html).toContain('>Сумма, ₸</span>')
    expect(html).not.toContain('Сумма в USD')
    expect(html).toContain('Удалить счёт')
    expect(warning).toBe(
      'Счёт исчезнет у обоих участников. Отменить нельзя. Накопления по целям «Квартира», «Отпуск» останутся на месте: они снова будут считаться отдельно, а не лежащими на этом счёте.',
    )

    // Без целей — только первая фраза.
    await render('/capital', { selectedAccountId: 'usd' }, (s) => (warning = s.accountRemoveWarning as string))
    expect(warning).toBe('Счёт исчезнет у обоих участников. Отменить нельзя.')
  })

  it('viewer: цифры счёта без полей и удаления', async () => {
    const { money, plain } = await import('@/lib/money')
    await family('viewer')
    const html = await render('/capital', { selectedAccountId: 'usd' })
    expect(html).not.toContain('<input')
    expect(html).not.toContain('Удалить счёт')
    expect(html).toContain(plain(1_000))
    expect(html).toContain(money(512_340))
  })

  it('добавление валютного счёта: курс Нацбанка с датой, «В капитале это», «Курс запоминается…»', async () => {
    const { money } = await import('@/lib/money')
    await family()
    const info = { rates: { USD: 441.89 }, date: '2026-09-25', source: 'Национальный банк РК' }
    const html = await render('/capital', {
      accountOpen: true, newAccountCurrency: 'USD', newAccountAmount: '1 000', newAccountRate: '441,89', rateInfo: info,
    })
    expect(html).toContain('Курс Национальный банк РК на 25.09.2026. Можно заменить своим.')
    expect(html).toContain(`В капитале это <b class="num text-ink">${money(441_890)}</b>`)
    expect(html).toContain('Курс запоминается вместе с датой. Прошлые цифры от скачков курса не поедут — чтобы обновить, поменяете курс вручную.')

    expect(await render('/capital', { accountOpen: true, newAccountCurrency: 'USD', rateBusy: true })).toContain('Запрашиваем курс Нацбанка…')
    expect(await render('/capital', { accountOpen: true, newAccountCurrency: 'USD', rateFailed: true })).toContain(
      'Курс Нацбанка сейчас недоступен — впишите вручную.',
    )
    expect(await render('/capital', { accountOpen: true, newAccountKind: 'deposit' })).toContain('Ставка по вкладу, % годовых — если есть')
  })
})
