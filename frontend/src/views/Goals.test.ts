import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import type { SyncDoc, WishItem } from '@/types/finance'
import {
  goalDoneMonth,
  goalMonths,
  goalMonthly,
  planForecast,
  contributionStreak,
  liveWishlist,
  deposit,
  realRate,
  indexedNeed,
  INFLATION,
} from '@/lib/finance'
import { money, plain, ratePct } from '@/lib/money'
import { addMonths, monthIn } from '@/lib/dates'
import { T0, authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import Goals from './Goals.vue'
import GoalDetail from './GoalDetail.vue'

describe('views/Goals.vue, GoalDetail.vue, Deposit.vue — Цели, депозиты и вишлист', () => {
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

  it('goalMonths и goalMonthly рассчитывают срок и ежемесячный взнос', () => {
    // Остаток 600_000 ₸ при взносе 50_000 ₸ в месяц -> 12 месяцев
    expect(goalMonths(600_000, 50_000)).toBe(12)
    // Минимальный срок для достижения — 1 месяц
    expect(goalMonths(0, 50_000)).toBe(1)
    // Ежемесячный платеж на 12 месяцев для 600_000 ₸ -> 50_000 ₸
    expect(goalMonthly(600_000, 12)).toBe(50_000)
    expect(goalMonthly(600_000, 0)).toBe(600_000)
  })

  it('contributionStreak корректно определяет непрерывную серию ежемесячных взносов', () => {
    const today = new Date()
    const y = today.getFullYear()
    const m = today.getMonth()

    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (year: number, month: number) => `${year}-${pad(month + 1)}-10`

    // Взносы за текущий, прошлый и позапрошлый месяц -> серия 3
    const movements = [
      { id: '1', date: fmt(y, m), amount: 20_000, by: 'a' as const },
      { id: '2', date: fmt(y, m - 1), amount: 15_000, by: 'b' as const },
      { id: '3', date: fmt(y, m - 2), amount: 30_000, by: 'a' as const },
    ]

    expect(contributionStreak(movements)).toBe(3)

    // Если взносов нет — серия 0
    expect(contributionStreak([])).toBe(0)
  })

  it('liveWishlist фильтрует удалённые позиции (мягкое удаление deletedAt)', () => {
    const list = [
      { id: 'w1', name: 'Ноутбук', price: 600_000, by: 'a' as const, addedOn: '2026-09-01', bought: false, updatedAt: '2026-09-01T10:00:00Z' },
      { id: 'w2', name: 'Удалённая позиция', price: 8_000, by: 'a' as const, addedOn: '2026-08-01', bought: false, deletedAt: '2026-09-10', updatedAt: '2026-09-01T10:00:00Z' },
    ]

    expect(liveWishlist(list)).toHaveLength(1)
    expect(liveWishlist(list)[0].name).toBe('Ноутбук')
  })

  it('операции со store: contribute и withdraw обновляют цель, историю и связанный счет', () => {
    const store = useFinanceStore()

    // Создаем счет и цель
    store.addAccount({
      name: 'Основной',
      kind: 'card',
      amount: 500_000,
    })
    const accId = store.accounts[0].id

    store.addGoal({
      name: 'Отпуск',
      need: 800_000,
      have: 200_000,
      monthly: 50_000,
      hue: 'teal',
    })
    const goalId = store.goals[0].id

    // Пополнение цели на 50 000 со счета
    store.contribute(goalId, 50_000, 'a', 'Отпускные')
    store.setAccountAmount(accId, store.accounts[0].amount - 50_000)

    const updatedGoal = store.goals.find((g) => g.id === goalId)!
    expect(updatedGoal.have).toBe(250_000)
    expect(updatedGoal.movements).toHaveLength(1)
    expect(updatedGoal.movements![0].amount).toBe(50_000)
    expect(updatedGoal.movements![0].note).toBe('Отпускные')
    expect(store.accounts[0].amount).toBe(450_000)

    // Снятие с цели на 20 000 с зачислением на счет
    store.withdraw(goalId, 20_000, 'a', 'Форс-мажор')
    store.setAccountAmount(accId, store.accounts[0].amount + 20_000)

    const afterWithdraw = store.goals.find((g) => g.id === goalId)!
    expect(afterWithdraw.have).toBe(230_000)
    expect(afterWithdraw.movements).toHaveLength(2)
    expect(afterWithdraw.movements![1].amount).toBe(-20_000)
    expect(store.accounts[0].amount).toBe(470_000)
  })

  it('deposit и realRate рассчитывают сложный процент, доходность и влияние инфляции', () => {
    const principal = 1_000_000
    const annualRate = 0.145 // 14.5%
    const months = 12

    const res = deposit({
      principal,
      annualRate,
      months,
      monthlyTopUp: 0,
      capitalize: true,
    })

    expect(res.future).toBeGreaterThan(principal)
    expect(res.interest).toBeGreaterThan(140_000)
    expect(res.effectiveRate).toBeGreaterThan(annualRate)

    // Инфляция — общая константа приложения (Р-19), не 8%.
    const real = realRate(res.effectiveRate, INFLATION)
    expect(real).toBeLessThan(realRate(res.effectiveRate, 0.08))
    expect(real).toBeLessThan(res.effectiveRate)
    expect(real).toBeGreaterThan(0)
  })

  it('рендерит Goals.vue с целями, вишлистом и кольцом прогресса (SSR компонентный рендер)', async () => {
    const store = useFinanceStore()
    store.addGoal({
      name: 'Ремонт кухни',
      need: 1_200_000,
      have: 400_000,
      monthly: 80_000,
      hue: 'brick',
    })

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Goals = (await import('./Goals.vue')).default

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/goals', component: Goals }],
    })
    await router.push('/goals')
    await router.isReady()

    const app = createSSRApp(Goals)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Цели')
    expect(html).toContain('Ремонт кухни')
    expect(html).toContain('Покупки')
    expect(html).toContain('Новая цель')
  })

  it('рендерит GoalDetail.vue с деталями цели и прогнозом «дорожает вместе с рынком» (PV-04)', async () => {
    const store = useFinanceStore()
    store.addGoal({
      name: 'Автомобиль',
      need: 5_000_000,
      have: 1_500_000,
      monthly: 150_000,
      hue: 'blue',
    })
    const gId = store.goals[0].id

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const GoalDetail = (await import('./GoalDetail.vue')).default

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/goals/:id', component: GoalDetail }],
    })
    await router.push(`/goals/${gId}`)
    await router.isReady()

    const app = createSSRApp(GoalDetail)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Автомобиль')
    expect(html).not.toContain('Дисциплина накоплений')
    // Остаток 3 500 000 взносом 150 000 — 24 месяца; 5 000 000 × 1,102² = 6 072 020.
    const indexed = indexedNeed(5_000_000, goalMonths(3_500_000, 150_000))
    expect(indexed).toBe(6_072_020)
    expect(html).toContain('Цель дорожает вместе с рынком')
    expect(html).toContain(
      `При инфляции 10,2% в год к моменту достижения такая же покупка будет стоить около ${money(indexed!)}. Расчёт выше — в сегодняшних деньгах.`,
    )
    expect(html).toContain('Ритм цели')
    expect(html).toContain('История цели')
  })

  it('тёмная тема: кольцо и «Ритм цели» — тёмный оттенок цели (PV-08)', async () => {
    const { isDark } = await import('@/lib/theme')
    const { HUES } = await import('@/lib/palette')
    const store = useFinanceStore()
    store.addGoal({ name: 'Автомобиль', need: 5_000_000, have: 1_500_000, monthly: 150_000, hue: 'blue' })
    const gId = store.goals[0].id
    store.contribute(gId, 150_000, 'a')

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const GoalDetail = (await import('./GoalDetail.vue')).default
    const render = async () => {
      const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/goals/:id', component: GoalDetail }] })
      await router.push(`/goals/${gId}`)
      await router.isReady()
      const app = createSSRApp(GoalDetail)
      app.use(router)
      return renderToString(app)
    }

    try {
      isDark.value = true
      const html = await render()
      expect(html).toContain(`stroke="${HUES.blue.dark}"`)
      expect(html).toContain(`background:${HUES.blue.dark}`)
      expect(html).not.toContain(HUES.blue.light)
    } finally {
      isDark.value = false
    }
    const light = await render()
    expect(light).toContain(`background:${HUES.blue.light}`)
  })

  it('цель со взносом 0 — срок не наступит, прогноза «дорожает» нет (PV-04)', async () => {
    const store = useFinanceStore()
    store.addGoal({ name: 'Когда-нибудь', need: 1_000_000, have: 100_000, monthly: 0, hue: 'blue' })
    const gId = store.goals[0].id

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const GoalDetail = (await import('./GoalDetail.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/goals/:id', component: GoalDetail }] })
    await router.push(`/goals/${gId}`)
    await router.isReady()
    const app = createSSRApp(GoalDetail)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Когда-нибудь')
    expect(html).not.toContain('Цель дорожает вместе с рынком')
  })

  it('пополнение и снятие цели: только живые тенговые счета — валютный стёр бы сдвиг при правке курса (клинап)', async () => {
    const store = useFinanceStore()
    store.addGoal({ name: 'Отпуск', need: 900_000, have: 100_000, monthly: 50_000, hue: 'blue' })
    store.addAccount({ name: 'Kaspi Gold', kind: 'card', amount: 300_000 })
    store.addAccount({ name: 'Доллары', kind: 'cash', amount: 441_890, currency: 'USD', foreignAmount: 1_000, rate: 441.89 })
    store.addAccount({ name: 'Старая карта', kind: 'card', amount: 10_000 })
    store.removeAccount(store.accounts.find((a) => a.name === 'Старая карта')!.id)
    const gId = store.goals[0].id

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const GoalDetail = (await import('./GoalDetail.vue')).default
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/goals/:id', component: GoalDetail }] })
    await router.push(`/goals/${gId}`)
    await router.isReady()
    const app = createSSRApp(GoalDetail)
    app.use(router)
    app.mixin({
      created() {
        if (this.$.parent === null) Object.assign(this.$.setupState, { openDepositModal: true })
      },
    })

    const html = await renderToString(app)
    expect(html).toContain('Списать со счёта (опционально)')
    expect(html).toContain('Kaspi Gold (')
    expect(html).not.toContain('Доллары (')
    expect(html).not.toContain('Старая карта (')
  })

  it('рендерит Deposit.vue для счета с депозитными условиями', async () => {
    const store = useFinanceStore()
    store.addAccount({
      name: 'Kaspi Депозит',
      kind: 'deposit',
      amount: 1_000_000,
      deposit: {
        annualRate: 0.14,
        months: 12,
        monthlyTopUp: 0,
        capitalize: true,
      },
    })
    const accId = store.accounts[0].id

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Deposit = (await import('./Deposit.vue')).default

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/capital/:id', component: Deposit }],
    })
    await router.push(`/capital/${accId}`)
    await router.isReady()

    const app = createSSRApp(Deposit)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Kaspi Депозит')
    expect(html).toContain('Будет на счёте через 12 мес.')
    expect(html).toContain('Эффективная ставка')
    expect(html).toContain('Ваши взносы')
    expect(html).toContain('Заработал банк')

    // PV-05: инфляция 10,2% из общей константы и обе плашки React.
    const eff = deposit({ principal: 1_000_000, annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true }).effectiveRate
    const text = html.replace(/<!--[^>]*-->/g, '')
    expect(text).toContain('Реальная доходность ниже той, что на витрине')
    expect(text).toContain(
      `При инфляции 10,2% эффективная ставка ${ratePct(eff, 1)} оставляет примерно ${ratePct(realRate(eff, INFLATION), 1)} настоящих. Это не повод не копить — это повод не путать номинал с доходом.`,
    )
    expect(text).toContain('Проценты считает приложение, а не банк')
    expect(text).toContain(
      'Формула аннуитета и капитализации работает офлайн, на ваших цифрах. Когда появится ИИ-советник, он получит уже посчитанный результат и будет только объяснять его словами — считать деньги модели не доверяем.',
    )
  })

  it('рендерит вкладку вишлиста при переходе по /goals?tab=wish', async () => {
    const store = useFinanceStore()
    store.mutateHouseholdDoc((doc) => {
      doc.wishlist = [
        {
          id: 'w-test',
          name: 'Робот-пылесос',
          price: 180_000,
          by: 'a',
          bought: false,
          addedOn: '24.09.2026',
          updatedAt: '2026-09-24T00:00:00Z',
        },
      ]
    })

    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')
    const Goals = (await import('./Goals.vue')).default

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/goals', component: Goals }],
    })
    await router.push('/goals?tab=wish')
    await router.isReady()

    const app = createSSRApp(Goals)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Робот-пылесос')
    expect(html).toContain('Добавить покупку')
  })
})

describe('PV-15: пауза целей ради плана (SSR)', () => {
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

  const family = (withPlan = true) => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(withPlan ? { plans: [planOf()] } : {}), 1)
    return store
  }
  const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)))

  it('список: цель на паузе — «На паузе ради плана» вместо взноса; подушка — со взносом, без тега', async () => {
    family()
    const html = await renderScreen(Goals, '/goals')
    const trip = between(html, '>Отпуск<', '</div>')
    expect(trip).toContain('На паузе ради плана')
    expect(trip).not.toContain('/мес')
    const cushion = between(html, '>Подушка<', '</div>')
    expect(cushion).not.toContain('На паузе ради плана')
    expect(cushion).toContain(`${plain(30_000)}/мес`)
  })

  it('без плана — тегов паузы нет', async () => {
    family(false)
    expect(await renderScreen(Goals, '/goals')).not.toContain('На паузе ради плана')
  })

  it('GoalDetail на паузе — Callout с суммой взноса и ссылкой на план, дата «после плана»; взнос в документе прежний', async () => {
    const store = family()
    const html = await renderScreen(GoalDetail, '/goals/trip')
    expect(html).toContain('На паузе ради плана')
    expect(html).toContain(`Взнос ${money(40_000)} идёт в досрочку самого дорогого долга — так семья отдаст банку`)
    expect(html).toContain('Цель возобновится сама, когда долги с процентами закроются, или когда вы отмените план.')
    expect(html).toContain('href="/plan"')
    expect(html).toContain('после плана')
    expect(store.householdDoc.goals.find((g) => g.id === 'trip')!.monthly).toBe(40_000)
    expect(store.status).toBe('idle')
  })

  it('GoalDetail подушки — «Подушка плана: взносы продолжаются»; без плана — ни того, ни другого', async () => {
    family()
    const cushion = await renderScreen(GoalDetail, '/goals/cushion')
    expect(cushion).toContain('Подушка плана: взносы продолжаются')
    expect(cushion).not.toContain('На паузе ради плана')
    expect(cushion).not.toContain('после плана')

    setActivePinia(createPinia())
    family(false)
    const free = await renderScreen(GoalDetail, '/goals/trip')
    expect(free).not.toContain('На паузе ради плана')
    expect(free).not.toContain('Подушка плана')
  })
})

describe('PV-18: покупки — правка, «Уже купили», viewer (SSR)', () => {
  const T0 = '2026-09-01T00:00:00.000Z'
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

  const wish = (w: Partial<WishItem> & Pick<WishItem, 'id' | 'name' | 'price'>): WishItem => ({
    by: 'a', addedOn: '2026-09-10T06:00:00.000Z', bought: false, updatedAt: T0, ...w,
  })

  function family(role: 'member' | 'viewer' = 'member', wishlist: WishItem[] = []) {
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
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
        ],
        wishlist,
      },
      1,
    )
    return store
  }

  const list = () => [
    wish({ id: 'pan', name: 'Сковорода', price: 18_000, url: 'https://kaspi.kz/p' }),
    // Строка из прода: дата добавления — `toLocaleDateString('ru-RU')`.
    wish({ id: 'old', name: 'Чайник', price: 12_000, by: 'b', addedOn: '24.09.2026' }),
    wish({ id: 'vac', name: 'Пылесос', price: 180_000, by: 'b', bought: true, boughtOn: '2026-09-20T15:00:00.000Z' }),
    wish({ id: 'iron', name: 'Утюг', price: 25_000, bought: true, boughtOn: '2026-08-05T15:00:00.000Z' }),
  ]

  it('списки React: подпись с датой, цена без ₸, «Уже купили» с итогом, «Вернуть в список»', async () => {
    family('member', list())
    const html = await renderScreen(Goals, '/goals?tab=wish')
    expect(html).toContain('Ильяс · 10 сентября')
    expect(html).toContain('Аруна · 24.09.2026')
    expect(html).toContain(`>${plain(18_000)}</span>`)
    expect(html).toContain('aria-label="Отметить купленным"')
    expect(html).toContain('Добавить покупку')
    expect(html).toContain('Уже купили')
    expect(html).toContain(money(205_000))
    expect(html).toContain('Аруна · куплено 20 сентября')
    expect(html).toContain('Ильяс · куплено 5 августа')
    expect(html.match(/aria-label="Вернуть в список"/g)).toHaveLength(2)
    expect(html).toContain('line-through">Пылесос<')
    expect(html).not.toContain('Пока ничего')
    expect(html).not.toContain('Список пуст')
  })

  it('пусто: «Список пуст», «Уже купили» виден с «Пока ничего» и без итога', async () => {
    family()
    const html = await renderScreen(Goals, '/goals?tab=wish')
    expect(html).toContain('Список пуст')
    expect(html).toContain('Уже купили')
    expect(html).toContain('Пока ничего')
    expect(html).not.toContain(money(0))
  })

  it('отметили купленным — карточка React с номером покупки, строка ушла в «Уже купили»', async () => {
    const store = family('member', list())
    const html = await renderScreen(Goals, '/goals?tab=wish', undefined, [
      screenMixin({}, (s) => (s.markBought as (id: string, name: string) => void)('pan', 'Сковорода')),
    ])
    expect(html).toContain('Куплено — Сковорода')
    expect(html).toContain('Это 3-я покупка в дом. Вещь переехала в историю с датой и автором — через год будет видно, куда уходили деньги на быт.')
    expect(store.wishlist.find((w) => w.id === 'pan')).toMatchObject({ bought: true, boughtOn: '2026-09-24T07:00:00.000Z' })
    expect(html).toContain(money(223_000))
  })

  it('нажатие на строку — окно правки: поля React со значениями, «Готово», удаление с текстом React', async () => {
    family('member', list())
    const html = await renderScreen(Goals, '/goals?tab=wish', undefined, [screenMixin({ editWishId: 'pan' })])
    expect(html).toContain('role="dialog"')
    for (const label of ['Что покупаем', 'Цена, ₸', 'Ссылка на товар']) expect(html).toContain(`>${label}</span>`)
    expect(html).toContain('aria-label="Кто добавил"')
    expect(html).toContain('value="Сковорода"')
    expect(html).toContain(`value="${plain(18_000)}"`)
    expect(html).toContain('value="https://kaspi.kz/p"')
    expect(html).toContain('Готово')
    expect(html).toContain('Удалить из списка')
  })

  it('окно создания — тексты React', async () => {
    family()
    const html = await renderScreen(Goals, '/goals?tab=wish', undefined, [screenMixin({ openWishModal: true })])
    expect(html).toContain('Покупка в дом')
    expect(html).toContain('placeholder="Например, сковорода"')
    expect(html).toContain('placeholder="18 000"')
    expect(html).toContain('placeholder="можно оставить пустым"')
    expect(html).toContain('aria-label="Кто добавил"')
    expect(html).toContain('Добавить в список')
    expect(html).not.toContain('bg-black/40')
  })

  it('viewer: список и итог видны, кнопок и окна правки нет', async () => {
    family('viewer', list())
    const html = await renderScreen(Goals, '/goals?tab=wish', undefined, [screenMixin({ editWishId: 'pan' })])
    expect(html).toContain('Сковорода')
    expect(html).toContain(money(205_000))
    expect(html).toContain('Аруна · куплено 20 сентября')
    expect(html).not.toContain('Отметить купленным')
    expect(html).not.toContain('Вернуть в список')
    expect(html).not.toContain('Добавить покупку')
    expect(html).not.toContain('role="dialog"')
  })
})

describe('PV-19: цель — окно правки, взнос полем, дата на паузе (SSR GoalDetail)', () => {
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

  function family(role: 'member' | 'viewer' = 'member', extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs(role))
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(extra), 1)
    return store
  }
  const trip = (store: ReturnType<typeof useFinanceStore>) => store.goals.find((g) => g.id === 'trip')!

  it('окно «Изменить цель»: поля React со значениями, «Уже накоплено» и пояснение про взносы, удаление — текст React', async () => {
    const store = family()
    store.contribute('trip', 10_000, 'a')
    store.contribute('trip', 5_000, 'b')
    const html = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ openEditModal: true, confirm: true })])
    expect(html).toContain('role="dialog"')
    expect(html).toContain('Изменить цель')
    for (const label of ['Название', 'Сколько нужно, ₸', 'Уже накоплено, ₸']) expect(html).toContain(`>${label}</span>`)
    expect(html).toContain('value="Отпуск"')
    expect(html).toContain(`value="${plain(3_000_000)}"`)
    expect(html).toContain(`value="${plain(65_000)}"`)
    expect(html).toContain('Взносы (2) останутся в истории: правится только та часть, с которой цель завели.')
    expect(html).toContain('aria-label="Цвет"')
    expect(html).toContain('Готово')
    expect(html).toContain('Цель и её история взносов исчезнут у обоих участников. Отменить нельзя.')
    expect(html).not.toContain('Сохранить')
    expect(html).not.toContain('bg-black/40')
  })

  it('без взносов пояснения нет', async () => {
    family()
    const html = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ openEditModal: true })])
    expect(html).toContain('>Уже накоплено, ₸</span>')
    expect(html).not.toContain('останутся в истории')
  })

  it('«Уже накоплено» по уходу из поля — seed, история взносов на месте; «Сколько нужно» 0 — не пишется', async () => {
    const store = family()
    store.contribute('trip', 10_000, 'a')
    await renderScreen(GoalDetail, '/goals/trip', undefined, [
      screenMixin({ openEditModal: true }, (s) => {
        ;(s.onHave as (t: string) => void)('120 000')
        ;(s.onNeed as (t: string) => void)('0')
      }),
    ])
    expect(trip(store)).toMatchObject({ seed: 110_000, have: 120_000, need: 3_000_000 })
    expect(trip(store).movements.map((m) => m.amount)).toEqual([10_000])
  })

  it('п. 5: ползунка нет — поле «Откладывать в месяц» с суммой; по уходу из поля — взнос в сторе, 0 и пусто — без записи', async () => {
    const store = family()
    const html = await renderScreen(GoalDetail, '/goals/trip')
    expect(html).not.toContain('type="range"')
    expect(html).toContain('>Откладывать в месяц, ₸</span>')
    expect(html).toContain(`value="${plain(40_000)}"`)
    expect(html).toContain('Чтобы успеть за год, нужно')

    for (const empty of ['0', '']) {
      await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({}, (s) => (s.onMonthly as (t: string) => void)(empty))])
      expect(trip(store).monthly).toBe(40_000)
    }
    expect(store.status).toBe('idle')

    const after = await renderScreen(GoalDetail, '/goals/car', undefined, [
      screenMixin({}, (s) => (s.onMonthly as (t: string) => void)('73 000')),
    ])
    expect(store.goals.find((g) => g.id === 'car')!.monthly).toBe(73_000)
    expect(after).toContain(money(73_000))
    // Машина без плана: 3 000 000 − 200 000 при 73 000 в месяц — 39 взносов с сентября.
    expect(after).toContain(`Цель закроется в ${monthIn(addMonths('2026-09', goalMonths(2_800_000, 73_000) - 1))}`)
  })

  it('п. 4: цель на паузе закроется позже месяца без процентных долгов — от конца плана', async () => {
    const store = family('member', { plans: [planOf()] })
    const html = await renderScreen(GoalDetail, '/goals/trip')
    const free = planForecast(planOf(), store.planState(), '2026-09').debtFreeMonth!
    expect(free).toMatch(/^\d{4}-\d{2}$/)
    const done = addMonths(free, goalMonths(3_000_000 - 50_000, 40_000))
    expect(done > free).toBe(true)
    expect(html).toContain(`Цель закроется в ${monthIn(done)}`)
    expect(html).toContain('после плана')
    // Прежняя дата — будто взносы идут с сентября — ушла.
    expect(html).not.toContain(`Цель закроется в ${monthIn(addMonths('2026-09', goalMonths(2_950_000, 40_000) - 1))}`)
    expect(goalDoneMonth(74, '2026-09', { debtFreeMonth: free })).toBe(done)
  })

  it('п. 4: долги с планом не закрываются — «после плана» без месяца', async () => {
    const huge = { id: 'huge', name: 'Займ', note: '', principal: 100_000_000, principalSetAt: T0, annualRate: 0.6, payment: 100_000, day: 3, updatedAt: T0 }
    const store = family('member', { plans: [planOf()] })
    store.mutateHouseholdDoc((doc) => doc.credits.push(huge))
    expect(planForecast(planOf(), store.planState(), '2026-09').debtFreeMonth).toBeNull()
    const html = await renderScreen(GoalDetail, '/goals/trip')
    expect(html).toContain('Цель закроется после плана')
    expect(html).not.toContain('Цель закроется в ')
    expect(goalDoneMonth(74, '2026-09', { debtFreeMonth: null })).toBeNull()
  })

  it('viewer: ни карандаша, ни окна правки, ни поля взноса — сумма видна', async () => {
    family('viewer')
    const html = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ openEditModal: true })])
    expect(html).not.toContain('aria-label="Изменить цель"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('Откладывать в месяц, ₸')
    expect(html).not.toContain('<input')
    expect(html).toContain(money(40_000))
  })
})
