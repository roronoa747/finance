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
  monthsBetween,
} from '@/lib/finance'
import { money, plain, ratePct } from '@/lib/money'
import { addMonths, monthIn, monthKey } from '@/lib/dates'
import { GOAL_TEMPLATES, GOAL_TYPES, templateById } from '@/lib/goalTemplates'
import { HUES } from '@/lib/palette'
import { T0, authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import GoalDetail from './GoalDetail.vue'
import GoalNew from './GoalNew.vue'
import Wishes from './Wishes.vue'

describe('views/GoalDetail.vue, GoalNew.vue, Wishes.vue, лист вклада — цели, депозиты и желания', () => {
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

  it('рендерит GoalNew.vue: «На что копим?», плитки шаблонов, «Своё фото», «Пока без мечты» (SSR компонентный рендер)', async () => {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createRouter, createMemoryHistory } = await import('vue-router')

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/goals/new', component: GoalNew }],
    })
    await router.push('/goals/new')
    await router.isReady()

    const app = createSSRApp(GoalNew)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('На что копим?')
    for (const k of GOAL_TYPES) expect(html).toContain(k.name)
    expect(html).toContain('Своё фото')
    expect(html).toContain('images.unsplash.com/')
    expect(html).toContain('Пока без мечты')
    expect(html).not.toContain('Новая цель')
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
    // Срок — из плана месяца (ревью frontend Б14, Н-2): доход покрывает взнос целиком.
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '' }]

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

    const html = (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
    // Герой — «накоплено из нужно», как в макете g4: имя уже в шапке, месяц — в карточке ниже (критик Блока 3).
    expect(html).toContain(`${plain(1_500_000)} из ${money(5_000_000)}`)
    expect(html).not.toContain('Автомобиль ·')
    expect(html.match(/будет вашей в/gi)).toHaveLength(1)
    expect(html).not.toContain('Дисциплина накоплений')
    // Остаток 3 500 000 взносом 150 000 — 24 взноса, последний через 23 месяца: горизонт цены — до месяца закрытия (B2C-18).
    const done = goalDoneMonth(goalMonths(3_500_000, 150_000), monthKey())!
    expect(monthsBetween(monthKey(), done)).toBe(23)
    const indexed = indexedNeed(5_000_000, 23)
    expect(html).toContain('Цель дорожает вместе с рынком')
    // Предложный падеж: «в мае 2027», а не «к мае 2027».
    expect(html).toContain(
      `При инфляции 10,2% в год в ${monthIn(done)} такая же покупка будет стоить около ${money(indexed!)}. Расчёт выше — в сегодняшних деньгах.`,
    )
    expect(html).not.toContain(`к ${monthIn(done)}`)
    expect(html).toContain('Ритм цели')
    expect(html).toContain('Взносы')
    expect(html).not.toContain('История цели')

    // Расчёты и график — в одном свёрнутом «Подробнее» (правило 12): до него их нет, «Взносы» — после.
    const start = html.indexOf('<details>')
    const end = html.indexOf('</details>')
    expect(start).toBeGreaterThan(0)
    expect(html.slice(start, end)).toMatch(/<summary[^>]*>Подробнее<\/summary>/)
    for (const text of ['Чтобы успеть за год, нужно', 'Цель дорожает вместе с рынком', 'Ритм цели', 'Пополняем без пропусков']) {
      expect(html.slice(start, end)).toContain(text)
      expect(html.slice(0, start)).not.toContain(text)
    }
    expect(html.slice(end)).toContain('Взносы')
    expect(html.slice(0, start)).toContain('Пополнить')
  })

  it('тёмная тема: «Ритм цели» — тёмный оттенок цели (PV-08); кольца нет — процент в фото-герое (B2C-18)', async () => {
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
      expect(html).not.toContain('stroke-dasharray')
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
    expect(html).toContain(`${plain(100_000)} из ${money(1_000_000)}`)
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

  it('лист счёта-вклада (пивот 3, B2C-42): старый адрес вклада — расчёт в листе', async () => {
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
    const { createMemoryHistory } = await import('vue-router')
    const { createAppRouter } = await import('@/router')
    const Money = (await import('./Money.vue')).default

    // Пивот 3 (B2C-42): экрана вклада нет — старый адрес открывает лист счёта с «Расчётом вклада».
    const router = createAppRouter(createMemoryHistory())
    await router.push(`/money/capital/${accId}`)
    await router.isReady()

    const app = createSSRApp(Money)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Kaspi Депозит')
    expect(html).toContain('Будет на счёте через 12 мес.')
    expect(html).toContain('Эффективная ставка')
    expect(html).toContain('Ваши взносы')
    expect(html).toContain('Начислено процентов')
    // Критик Блока 9: «Заработал банк» повторял «Начислено процентов» тем же числом — строка одна.
    expect(html).not.toContain('Заработал банк')

    // PV-05: инфляция 10,2% из общей константы. Правило 12 (критик Блока 3): реальная доходность —
    // одна строка, пояснение — в подсказке; плашки про формулу и «ИИ-советника» нет.
    const eff = deposit({ principal: 1_000_000, annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true }).effectiveRate
    const text = html.replace(/<!--[^>]*-->/g, '')
    expect(text).toMatch(new RegExp(`Реально ≈ ${ratePct(realRate(eff, INFLATION), 1)} с учётом инфляции\\s*<span[^>]*>\\s*<button[^>]*aria-label="Пояснение"`))
    expect(realRate(eff, INFLATION)).toBeLessThan(realRate(eff, 0.08))
    for (const gone of ['Реальная доходность ниже той, что на витрине', 'Проценты считает приложение, а не банк', 'ИИ-советник', 'Формула аннуитета']) {
      expect(text).not.toContain(gone)
    }
  })

  it('рендерит Wishes.vue по /wishes: покупка и «Добавить покупку»', async () => {
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
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/wishes', component: Wishes }],
    })
    await router.push('/wishes')
    await router.isReady()

    const app = createSSRApp(Wishes)
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
  it('без плана — ни паузы, ни «после плана» на экране цели', async () => {
    family(false)
    const html = await renderScreen(GoalDetail, '/goals/trip')
    expect(html).not.toContain('data-goal-plan')
    expect(html).not.toContain('На паузе — взнос идёт в долг')
    expect(html).not.toContain('после плана')
  })

  // Р-116 (B2C-108): абзац-Callout паузы → строка-ссылка `data-goal-plan` на план долгов; сумма взноса — в карточке
  // («N ₸ в месяц»), «Осталось K взносов · после плана» — в «Подробнее» (`data-goal-left`).
  it('GoalDetail на паузе — строка-ссылка на план, взнос в карточке, «после плана» в «Подробнее»; взнос в документе прежний', async () => {
    const store = family()
    const html = await renderScreen(GoalDetail, '/goals/trip')
    const plan = html.match(/<a[^>]*data-goal-plan[^>]*>[\s\S]*?<\/a>/)?.[0] ?? ''
    expect(plan).toContain('href="/money/debts"')
    expect(plan).toContain('На паузе — взнос идёт в долг')
    expect(html).toContain(`${money(40_000)} в месяц`)
    const left = html.match(/<p[^>]*data-goal-left[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''
    expect(left).toContain('после плана')
    const details = html.slice(html.indexOf('<details'))
    expect(details).toContain('data-goal-left')
    expect(store.householdDoc.goals.find((g) => g.id === 'trip')!.monthly).toBe(40_000)
    expect(store.status).toBe('idle')
  })

  it('GoalDetail подушки — строка «Подушка плана — взносы идут»; без плана — ни того, ни другого', async () => {
    family()
    const cushion = await renderScreen(GoalDetail, '/goals/cushion')
    const plan = cushion.match(/<a[^>]*data-goal-plan[^>]*>[\s\S]*?<\/a>/)?.[0] ?? ''
    expect(plan).toContain('Подушка плана — взносы идут')
    expect(plan).toContain('href="/money/debts"')
    expect(cushion).not.toContain('На паузе — взнос идёт в долг')
    expect(cushion).not.toContain('после плана')

    setActivePinia(createPinia())
    family(false)
    const free = await renderScreen(GoalDetail, '/goals/trip')
    expect(free).not.toContain('data-goal-plan')
    expect(free).not.toContain('Подушка плана')
  })

  // Владелец, 2026-09-27 (критик Блока 3): автор — один раз, на фото и ссылкой; поверх фото —
  // только маленькая кнопка смены; «Убрать фото» — в окне выбора; «Сделать главной» — первый пункт меню цели (Р-84, B2C-87).
  it('герой цели: автор один раз ссылкой на фото, кнопка «Сменить фото» вместо чипов, «Сделать главной» в меню, у главной — ни тега, ни пункта («главная мечта» — в подписи шапки)', async () => {
    const store = useFinanceStore()
    const doc = planFamilyDoc()
    const credit = { author: 'Matthew Skinner', url: 'https://unsplash.com/@matthewskinner' }
    doc.goals = doc.goals.map((g) => (g.id === 'trip' ? { ...g, photoId: 'ph-1', photoCredit: credit, template: 'japan' } : g.id === 'car' ? { ...g, main: true } : g))
    store.setHouseholdDoc(doc, 1)

    const trip = await renderScreen(GoalDetail, '/goals/trip')
    expect(trip.match(/Фото: Matthew Skinner/g)).toHaveLength(1)
    expect(trip).toContain(`href="${credit.url}"`)
    expect(trip).not.toContain('/ Unsplash')
    expect(trip).toContain('aria-label="Сменить фото"')
    expect(trip).not.toContain('Другое фото')
    expect(trip).not.toContain('Убрать фото')
    expect(trip).toContain('aria-label="Меню цели"')
    expect(trip).not.toContain('Сделать главной')
    // Меню: «Сделать главной» — первым и цветом бренда, затем «Изменить цель» и пауза.
    const menu = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ menuOpen: true })])
    expect(menu).toMatch(/text-brand"[^>]*><span[^>]*>.*?<\/span>Сделать главной/)
    expect(menu.indexOf('Сделать главной')).toBeLessThan(menu.indexOf('Изменить цель'))
    expect(menu).toContain('Поставить на паузу')
    expect(trip).not.toContain('>главная<')

    const car = await renderScreen(GoalDetail, '/goals/car')
    // Возврат смоука: тег «главная» в карточке дублировал подпись шапки «главная мечта · …» (g4) — убран.
    expect(car).not.toContain('>главная<')
    const carMenu = await renderScreen(GoalDetail, '/goals/car', undefined, [screenMixin({ menuOpen: true })])
    expect(carMenu).not.toContain('Сделать главной')
    expect(carMenu).toContain('Изменить цель')
    expect(car).not.toContain('Сменить фото')
    expect(car).toContain('Добавить фото')

    // Окно выбора фото у цели с фото — с тихим «Убрать фото».
    const picker = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ pickerOpen: true })])
    expect(picker).toContain('Убрать фото')
    // Выбранный шаблон с автором: в окне строки «Фото: … / Unsplash» нет — автор только на фото героя.
    expect(picker.match(/Matthew Skinner/g)).toHaveLength(1)
    // Автор выбранного шаблона («Япония» после возврата приёмки — другой) в окне тоже не печатается (критик возврата).
    expect(picker).not.toContain(templateById('japan')!.photo.author)

    // Viewer — без кнопок правки героя.
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs('viewer'))
    useFinanceStore().setHouseholdDoc(doc, 1)
    const viewer = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ menuOpen: true })])
    expect(viewer).not.toContain('Сменить фото')
    expect(viewer).not.toContain('Сделать главной')
    expect(viewer).not.toContain('aria-label="Меню цели"')
    expect(viewer.match(/Фото: Matthew Skinner/g)).toHaveLength(1)
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

  it('галерея: плитки с ценой в ₸, автор и дата — в окне покупки, «Уже купили» с итогом, «Вернуть в список»', async () => {
    family('member', list())
    const html = await renderScreen(Wishes, '/wishes')
    // Автор и дата — в окне покупки, не на плитке (галерея: фото, название, цена).
    expect(html).not.toContain('Ильяс · 10 сентября')
    expect(await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ editWishId: 'pan' })])).toContain('Ильяс · 10 сентября')
    expect(await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ editWishId: 'old' })])).toContain('Аруна · 24.09.2026')
    // Цена — деньгами с « ₸», как везде (DESIGN §1.2; критик Блока 3).
    expect(html).toContain(`>${money(18_000)}</span>`)
    expect(html).not.toContain(`>${plain(18_000)}</span>`)
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

  // Возврат смоука (правило 12, g4): пустой «Уже купили» с «Пока ничего» был лишней секцией — нет купленного, нет секции.
  it('пусто: «Список пуст» с кнопкой «Добавить покупку»; «Уже купили» без купленного не показывается', async () => {
    family()
    const html = await renderScreen(Wishes, '/wishes')
    expect(html).toContain('Список пуст')
    expect(html).toContain('Добавить покупку')
    expect(html).not.toContain('Уже купили')
    expect(html).not.toContain('Пока ничего')
    expect(html).not.toContain(money(0))
  })

  it('отметили купленным — одна строка «Куплено — …» без абзаца, строка ушла в «Уже купили»', async () => {
    const store = family('member', list())
    const html = await renderScreen(Wishes, '/wishes', undefined, [
      screenMixin({}, (s) => (s.markBought as (id: string, name: string) => void)('pan', 'Сковорода')),
    ])
    expect(html).toContain('Куплено — Сковорода')
    // Правило 12 и личные списки (критик Блока 3): ни «покупки в дом», ни «денег на быт».
    expect(html).not.toContain('покупка в дом')
    expect(html).not.toContain('на быт')
    expect(store.wishlist.find((w) => w.id === 'pan')).toMatchObject({ bought: true, boughtOn: '2026-09-24T07:00:00.000Z' })
    expect(html).toContain(money(223_000))
  })

  it('нажатие на строку — окно правки: поля React со значениями, «Готово», удаление с текстом React', async () => {
    family('member', list())
    const html = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ editWishId: 'pan' })])
    expect(html).toContain('role="dialog"')
    for (const label of ['Что покупаем', 'Цена, ₸', 'Ссылка на товар']) expect(html).toContain(`>${label}</span>`)
    expect(html).toContain('aria-label="Кто добавил"')
    expect(html).toContain('value="Сковорода"')
    expect(html).toContain(`value="${plain(18_000)}"`)
    expect(html).toContain('value="https://kaspi.kz/p"')
    expect(html).toContain('Готово')
    expect(html).toContain('Удалить из списка')
  })

  it('окно создания — «Новое желание», поля React', async () => {
    family()
    const html = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ openWishModal: true })])
    expect(html).toContain('Новое желание')
    expect(html).not.toContain('Покупка в дом')
    expect(html).toContain('placeholder="Например, сковорода"')
    expect(html).toContain('placeholder="18 000"')
    expect(html).toContain('placeholder="Вставьте ссылку"')
    expect(html).toContain('aria-label="Кто добавил"')
    expect(html).toContain('Добавить в список')
    expect(html).not.toContain('bg-black/40')
  })

  it('viewer: список и итог видны, кнопок и окна правки нет', async () => {
    family('viewer', list())
    const html = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ editWishId: 'pan' })])
    expect(html).toContain('Сковорода')
    expect(html).toContain(money(205_000))
    expect(html).toContain('Аруна · куплено 20 сентября')
    expect(html).not.toContain('Отметить купленным')
    expect(html).not.toContain('Вернуть в список')
    expect(html).not.toContain('Добавить покупку')
    expect(html).not.toContain('role="dialog"')
    // Плитка — не кнопка: нажимать нечего.
    expect(html).toMatch(/<div[^>]*data-wish="pan"/)
    expect(html).not.toMatch(/<button[^>]*data-wish="pan"/)
  })

  it('member: плитка покупки — кнопка правки, ссылка в магазин — поверх плитки', async () => {
    family('member', list())
    const html = await renderScreen(Wishes, '/wishes')
    expect(html).toMatch(/<button type="button"[^>]*data-wish="pan"/)
    expect(html).toContain('aria-label="Открыть ссылку"')
    expect(html).toContain('href="https://kaspi.kz/p"')
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
  /** Отмеченные кнопки «Цвет» (у `Segmented` тоже есть `aria-pressed` — их не считаем). */
  const hueLabels = new Set(Object.values(HUES).map((h) => h.label))
  const pressedHues = (html: string) =>
    [...html.matchAll(/aria-label="([^"]+)" aria-pressed="true"/g)].map((m) => m[1]).filter((l) => hueLabels.has(l))

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
    expect(pressedHues(html)).toEqual([HUES.teal.label])
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
    // Возврат смоука (g4, правило 12): в карточке — месяц, строка и «Пополнить» / «Поделиться»;
    // поле взноса и «Снять» — под свёрнутым «Подробнее»; карандаш — в шапке (без оболочки — на месте).
    const details = html.indexOf('<details')
    expect(html.indexOf('Пополнить')).toBeLessThan(details)
    expect(html.indexOf('>Откладывать в месяц, ₸</span>')).toBeGreaterThan(details)
    expect(html.indexOf('Снять')).toBeGreaterThan(details)
    expect(html).not.toContain('Все мечты')
    expect(html).toContain('aria-label="Меню цели"')

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
    expect(after).toContain(`Будет вашей в ${monthIn(addMonths('2026-09', goalMonths(2_800_000, 73_000) - 1))}`)
  })

  it('п. 4: цель на паузе закроется позже месяца без процентных долгов — от конца плана', async () => {
    const store = family('member', { plans: [planOf()] })
    const html = await renderScreen(GoalDetail, '/goals/trip')
    const free = planForecast(planOf(), store.planState(), '2026-09').debtFreeMonth!
    expect(free).toMatch(/^\d{4}-\d{2}$/)
    const done = addMonths(free, goalMonths(3_000_000 - 50_000, 40_000))
    expect(done > free).toBe(true)
    expect(html).toContain(`Будет вашей в ${monthIn(done)}`)
    expect(html).toContain('после плана')
    // Прежняя дата — будто взносы идут с сентября — ушла.
    expect(html).not.toContain(`Будет вашей в ${monthIn(addMonths('2026-09', goalMonths(2_950_000, 40_000) - 1))}`)
    expect(goalDoneMonth(74, '2026-09', { debtFreeMonth: free })).toBe(done)
  })

  it('п. 4: долги с планом не закрываются — «после плана» без месяца', async () => {
    const huge = { id: 'huge', name: 'Займ', note: '', principal: 100_000_000, principalSetAt: T0, annualRate: 0.6, payment: 100_000, day: 3, updatedAt: T0 }
    const store = family('member', { plans: [planOf()] })
    store.mutateHouseholdDoc((doc) => doc.credits.push(huge))
    expect(planForecast(planOf(), store.planState(), '2026-09').debtFreeMonth).toBeNull()
    const html = await renderScreen(GoalDetail, '/goals/trip')
    expect(html).toContain('После плана')
    expect(html).not.toContain('Будет вашей в ')
    expect(goalDoneMonth(74, '2026-09', { debtFreeMonth: null })).toBeNull()
  })

  it('цель удалил партнёр — «Цель не найдена», пополнять нечего', async () => {
    const store = family()
    store.mutateHouseholdDoc((doc) => {
      doc.goals.find((g) => g.id === 'trip')!.deletedAt = '2026-09-24T06:00:00.000Z'
    })
    const html = await renderScreen(GoalDetail, '/goals/trip')
    expect(html).toContain('Цель не найдена.')
    expect(html).not.toContain('Пополнить')
  })

  it('viewer: ни карандаша, ни окна правки, ни поля взноса — сумма видна', async () => {
    family('viewer')
    const html = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ openEditModal: true })])
    expect(html).not.toContain('aria-label="Меню цели"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('Откладывать в месяц, ₸')
    expect(html).not.toContain('<input')
    expect(html).toContain(money(40_000))
  })
})

describe('PV-23: окно пополнения и «История цели» (SSR GoalDetail)', () => {
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
    useAuthStore().setAuthData(authAs('member'))
  })
  afterEach(() => vi.useRealTimers())

  it('пополнение — как React: «Пополнить «Отпуск»», placeholder — взнос цели, «Внести»; у «Снять» — свои', async () => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    const monthly = store.goals.find((g) => g.id === 'trip')!.monthly
    const add = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ openDepositModal: true })])
    expect(add).toContain('Пополнить «Отпуск»')
    expect(add).toContain(`placeholder="${plain(monthly)}"`)
    expect(add).toMatch(/<button[^>]*>\s*Внести\s*<\/button>/)

    const take = await renderScreen(GoalDetail, '/goals/trip', undefined, [
      screenMixin({ openDepositModal: true, depositOperation: 'withdraw' }),
    ])
    expect(take).toContain('Снять средства')
    expect(take).not.toMatch(/>\s*Внести\s*</)
  })

  it('«История цели» — новые сверху и на слитом документе (новые первыми), и после взноса (дописан в конец)', async () => {
    const store = useFinanceStore()
    const old = { id: 'm-old', date: '2026-09-01T10:00:00.000Z', amount: 11_000, by: 'a' as const }
    const mid = { id: 'm-mid', date: '2026-09-10T10:00:00.000Z', amount: 22_000, by: 'b' as const }
    // Порядок после mergeGoal — новые первыми.
    store.setHouseholdDoc(planFamilyDoc(), 1)
    store.mutateHouseholdDoc((doc) => {
      doc.goals.find((g) => g.id === 'trip')!.movements = [mid, old]
    })
    const order = (html: string) =>
      [11_000, 22_000, 33_000].map((a) => html.indexOf(`+${plain(a)} ₸`)).filter((i) => i >= 0)
    let html = await renderScreen(GoalDetail, '/goals/trip')
    const [iOld, iMid] = order(html)
    expect(iMid).toBeLessThan(iOld)

    // Новый взнос дописывается в конец списка — на экране он сверху.
    store.contribute('trip', 33_000, 'a')
    html = await renderScreen(GoalDetail, '/goals/trip')
    const at = (a: number) => html.indexOf(`+${plain(a)} ₸`)
    expect(at(33_000)).toBeLessThan(at(22_000))
    expect(at(22_000)).toBeLessThan(at(11_000))
  })
})

describe('B2C-20: карточка для сторис на экране цели (SSR)', () => {
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
    useAuthStore().setAuthData(authAs('viewer'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
  })
  afterEach(() => vi.useRealTimers())

  it('«Поделиться» есть и у viewer; лист открыт — предпросмотр, «Сохранить», «Без сумм»; /share/:id → ?share=1 открывает сразу', async () => {
    const closed = await renderScreen(GoalDetail, '/goals/trip')
    expect(closed).toContain('Поделиться')
    expect(closed).not.toContain('Карточка для сторис')

    const open = await renderScreen(GoalDetail, '/goals/trip', undefined, [screenMixin({ storyOpen: true })])
    expect(open).toContain('Карточка для сторис')
    expect(open).toContain('aria-label="Предпросмотр карточки"')
    expect(open).toContain('Без сумм — только процент, имя мечты и месяц.')
    expect(open).toContain('Сохранить')

    const viaRoute = await renderScreen(GoalDetail, '/goals/trip?share=1')
    expect(viaRoute).toContain('Карточка для сторис')
  })
})

describe('экран цели — заметки о фото (критик Блока 3, SSR)', () => {
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
    useAuthStore().setAuthData(authAs('member'))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('«Новая мечта» передала в адресе: ?photo=failed — «добавьте ещё раз», ?photo=later — «появится при сети», пока фото нет', async () => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    expect(await renderScreen(GoalDetail, '/goals/trip?photo=failed')).toContain('Фото не загрузилось — добавьте его ещё раз.')
    expect(await renderScreen(GoalDetail, '/goals/trip?photo=later')).toContain('Картинка появится при сети.')
    const clean = await renderScreen(GoalDetail, '/goals/trip')
    expect(clean).not.toContain('Фото не загрузилось')
    expect(clean).not.toContain('появится при сети')
    // Картинка уже пришла — «появится» не пишем.
    store.setGoalPhoto('trip', 'ph-1', null)
    expect(await renderScreen(GoalDetail, '/goals/trip?photo=later')).not.toContain('появится при сети')
  })

  it('смена фото на шаблон без сети — «Нет сети — фото не сменилось.», у цели прежние фото, шаблон и цвет', async () => {
    const store = useFinanceStore()
    const doc = planFamilyDoc()
    doc.goals = doc.goals.map((g) => (g.id === 'trip' ? { ...g, photoId: 'ph-old', photoCredit: null, template: 'japan', hue: 'plum' } : g))
    store.setHouseholdDoc(doc, 1)
    vi.stubGlobal('navigator', { onLine: false })
    let box: { state: Record<string, unknown> } | null = null
    await renderScreen(GoalDetail, '/goals/trip', undefined, [
      screenMixin({}, (s) => {
        void s.onTemplate
        box = { state: s }
      }),
    ])
    await (box!.state.onTemplate as (t: unknown) => Promise<void>)(GOAL_TEMPLATES.find((t) => t.id === 'car')!)
    expect(box!.state.photoNote).toBe('Нет сети — фото не сменилось.')
    expect(store.goals.find((g) => g.id === 'trip')).toMatchObject({ photoId: 'ph-old', template: 'japan', hue: 'plum' })
  })
})
