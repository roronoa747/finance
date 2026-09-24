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
