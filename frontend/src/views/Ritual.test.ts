import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import {
  emergencyCoverage,
  goalMonths,
  lumpPlan,
  planMandatory,
  prepayment,
  nextChange,
} from '@/lib/finance'
import { monthKey } from '@/lib/dates'
import { money } from '@/lib/money'
import Ritual from './Ritual.vue'
import type { Credit, Obligation, SyncDoc } from '@/types/finance'
import { T0, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'

describe('views/Ritual.vue — Высвобождение средств и сценарии ритуала', () => {
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

  it('корректно обнаруживает снижение обязательства (nextChange с delta < 0)', () => {
    const key = monthKey()
    const obligation = {
      id: 'ob-rent',
      name: 'Аренда',
      note: '',
      day: 5,
      category: 'd1' as const,
      versions: [
        { from: '2026-01', amount: 250_000 },
        { from: '2027-01', amount: 200_000 }, // будущее снижение на 50 000
      ],
      updatedAt: '',
    }

    const change = nextChange(obligation, key)
    expect(change).not.toBeNull()
    expect(change?.from).toBe('2027-01')
    expect(change?.amount).toBe(200_000)
    expect(change?.delta).toBe(-50_000)
  })

  it('логика распределения: сумма шагов не превышает высвобождение и рассчитывает эффекты для целей и кредита', () => {
    const total = 50_000
    const STEP = 10_000

    // Проверяем расчет эффекта для цели
    const remaining = 300_000
    const monthly = 30_000
    const baseMonths = goalMonths(remaining, monthly)
    expect(baseMonths).toBe(10)

    const extra = 20_000
    const nowMonths = goalMonths(remaining, monthly + extra)
    expect(nowMonths).toBe(6) // 300_000 / 50_000 = 6
    expect(baseMonths - nowMonths).toBe(4) // Быстрее на 4 месяца

    // Проверяем расчет эффекта для кредита
    const prepay = prepayment(1_000_000, 0.18, 50_000, 20_000)
    expect(prepay.monthsNow).toBeGreaterThan(prepay.monthsAfter)
    expect(prepay.saved).toBeGreaterThan(0)

    // Проверяем инвариант остатка left >= 0
    let left = total
    const alloc: Record<string, number> = {}

    function addAlloc(id: string, delta: number) {
      if (delta > 0 && left < STEP) return
      alloc[id] = (alloc[id] ?? 0) + delta
      left -= delta
    }

    addAlloc('goal-1', 20_000)
    addAlloc('credit-1', 20_000)
    addAlloc('life', 10_000)
    expect(left).toBe(0)

    // Попытка добавить ещё не должна пройти
    addAlloc('goal-1', 10_000)
    expect(alloc['goal-1']).toBe(20_000)
    expect(left).toBe(0)
  })

  it('рендерит пустое состояние при отсутствии запланированных высвобождений', async () => {
    const store = useFinanceStore()
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 200_000 }], // нет будущих изменений
        updatedAt: '',
      },
    ]

    const router = createAppRouter(createMemoryHistory())
    const app = createSSRApp(Ritual)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Сейчас нет запланированных изменений, которые высвобождают деньги')
    expect(html).toContain('На главную')
  })

  it('рендерит активный экран ритуала с корзинами распределения при наличии высвобождения', async () => {
    const store = useFinanceStore()
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда квартиры',
        note: '',
        day: 5,
        category: 'd1',
        versions: [
          { from: '2026-01', amount: 250_000 },
          { from: '2027-06', amount: 200_000 }, // освобождается 50 000 ₸
        ],
        updatedAt: '',
      },
    ]
    store.householdDoc.goals = [
      {
        id: 'g-trip',
        name: 'Отпуск',
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
    store.householdDoc.credits = [
      {
        id: 'cr-auto',
        name: 'Автокредит',
        note: '',
        principal: 2_000_000,
        annualRate: 0.18,
        payment: 60_000,
        day: 15,
        updatedAt: '',
      },
    ]

    const router = createAppRouter(createMemoryHistory())
    const app = createSSRApp(Ritual)
    app.use(router)

    const html = await renderToString(app)

    expect(html).toContain('Куда направить')
    expect(html).toContain(money(50_000))
    expect(html).toContain('Осталось распределить')
    expect(html).toContain('Отпуск')
    expect(html).toContain('Досрочно по кредиту')
    expect(html).toContain('Качество жизни')
    expect(html).toContain('Аренда квартиры снизится с')
  })

  it('сохранение результатов распределения обновляет взносы целей в financeStore', () => {
    const store = useFinanceStore()
    store.householdDoc.goals = [
      {
        id: 'g-1',
        name: 'Цель 1',
        need: 500_000,
        seed: 50_000,
        have: 50_000,
        monthly: 30_000,
        hue: 'teal',
        planPct: 0.1,
        movements: [],
        updatedAt: '',
      },
    ]

    expect(store.goals[0].monthly).toBe(30_000)

    // Применяем метод setGoalMonthly
    store.setGoalMonthly('g-1', 50_000)
    expect(store.goals[0].monthly).toBe(50_000)
  })
})

describe('PV-01 — Ритуал: досрочка в самый дорогой открытый долг', () => {
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

  const T = '2026-09-01T00:00:00Z'
  const rent: Obligation = {
    id: 'ob-rent',
    name: 'Аренда квартиры',
    note: '',
    day: 5,
    category: 'd1',
    versions: [
      { from: '2026-01', amount: 250_000 },
      { from: '2027-06', amount: 200_000 },
    ],
    updatedAt: T,
  }
  const bank: Credit = { id: 'bank', name: 'Банк', note: '', principal: 1_000_000, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: T }
  /** Что Ритуал пишет в корзине кредита при нуле добавки — по кредиту `c`. */
  const nowLine = (c: Credit) => {
    const p = prepayment(c.principal, c.annualRate, c.payment, 0)
    return `Сейчас: ${Math.ceil(p.monthsNow)} платежей, переплата ${money(Math.round(p.overpayNow))}`
  }

  async function render() {
    const app = createSSRApp(Ritual)
    app.use(createAppRouter(createMemoryHistory()))
    return renderToString(app)
  }

  it('первый по порядку документа — беспроцентный: корзина считает эффект по процентному', async () => {
    const store = useFinanceStore()
    store.householdDoc.obligations = [rent]
    const zero: Credit = { ...bank, id: 'zero', name: 'Рассрочка', annualRate: 0, principal: 600_000, payment: 50_000 }
    store.householdDoc.credits = [zero, bank]

    const html = await render()
    expect(html).toContain('Досрочно по кредиту')
    expect(html).toContain(nowLine(bank))
    expect(html).not.toContain(nowLine(zero))
  })

  it('первый по порядку закрыт досрочкой: корзина — по открытому; все закрыты — корзины нет', async () => {
    const store = useFinanceStore()
    store.householdDoc.obligations = [rent]
    store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi', note: '', kind: 'card', amount: 3_000_000, updatedAt: T }]
    const card: Credit = { ...bank, id: 'card-loan', name: 'Кредитка', annualRate: 0.4, principal: 200_000, payment: 20_000 }
    store.householdDoc.credits = [card, bank]
    // Дороже всех — кредитка: пока открыта, корзина по ней.
    expect(await render()).toContain(nowLine(card))

    store.applyPrepayment('card-loan', 'a', { amount: 200_000, mode: 'term', accountId: 'card' })
    let html = await render()
    expect(html).toContain(nowLine(bank))

    store.applyPrepayment('bank', 'a', { amount: 1_000_000, mode: 'term', accountId: 'card' })
    html = await render()
    expect(html).not.toContain('Досрочно по кредиту')
  })
})

describe('PV-16: шаг плана в Ритуале (SSR)', () => {
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

  // Аренда подешевеет с октября на 20 000 — Ритуалу есть что распределить.
  const rent: Obligation = {
    id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', updatedAt: T0,
    versions: [{ from: '2000-01', amount: 220_000 }, { from: '2026-10', amount: 200_000 }],
  }
  const family = (extra: Partial<SyncDoc> = {}) => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc({ obligations: [rent], ...extra }), 1)
    return store
  }
  const withCushion = (have: number) => planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have, seed: have } : g))

  it('с планом — корзина «Досрочно по плану» с суммой шага и эффектом lumpPlan, «Досрочно по кредиту» нет', async () => {
    const store = family({ plans: [planOf()] })
    const html = await renderScreen(Ritual, '/ritual')
    expect(html).toContain('>Досрочно по плану<')
    expect(html).not.toContain('Досрочно по кредиту')
    const cc = store.credits.find((c) => c.id === 'cc')!
    const lp = lumpPlan(cc.principal, cc.annualRate, cc.payment, 100_000, 'term')!
    expect(html).toContain(
      `Шаг плана — ${money(100_000)} в «Кредитка»: платежей останется ${lp.months} вместо ${lp.monthsBefore}, не отдадим банку ${money(lp.saved)}`,
    )
    // Подушка — цель плана: её эффект — месяцы расходов.
    expect(html.slice(html.indexOf('>Подушка<'), html.indexOf('>Отпуск<'))).toContain('Через год покроет')
    expect(html).not.toContain('Сначала подушка')
  })

  it('без плана — цель «Подушка» по названию не особенная, корзина — «Досрочно по кредиту»', async () => {
    family()
    const html = await renderScreen(Ritual, '/ritual')
    expect(html).not.toContain('Через год покроет')
    expect(html).toContain('>Досрочно по кредиту<')
    expect(html).not.toContain('Досрочно по плану')
  })

  it('шаг — подушка: «Сначала подушка: … не хватает N ₸», её корзина первой', async () => {
    family({ plans: [planOf()], goals: withCushion(100_000) })
    const html = await renderScreen(Ritual, '/ritual')
    // Месяц списаний 220 000 + 58 000 + 25 000 + 20 000 = 323 000; в подушке 100 000.
    expect(html).toContain(`Сначала подушка: до месяца обязательных списаний не хватает ${money(223_000)}.`)
    const first = ['>Подушка<', '>Отпуск<', '>Машина<'].map((n) => html.indexOf(n))
    expect(first[0]).toBeLessThan(first[1])
    expect(first[0]).toBeLessThan(first[2])
  })

  it('подушка — цель плана по id, а не по названию: план с подушкой «Отпуск» — «покроет» у «Отпуска», не у «Подушки»', async () => {
    family({ plans: [planOf({ cushionGoalId: 'trip' })] })
    const html = await renderScreen(Ritual, '/ritual')
    // Корзина — от своего названия до названия следующей.
    const names = ['Подушка', 'Отпуск', 'Машина', 'Досрочно по плану'].map((n) => html.indexOf(`>${n}<`))
    const pot = (name: string) => {
      const at = html.indexOf(`>${name}<`)
      return html.slice(at, Math.min(...names.filter((i) => i > at), html.length))
    }
    expect(pot('Отпуск')).toContain('Через год покроет')
    expect(pot('Подушка')).not.toContain('Через год покроет')
  })

  it('корзина подушки меряет тем же месяцем списаний, что и шаг плана (planMandatory)', async () => {
    const store = family({ plans: [planOf()] })
    const html = await renderScreen(Ritual, '/ritual')
    const g = store.goals.find((x) => x.id === 'cushion')!
    const month = planMandatory(store.planState(), '2026-09')
    expect(month).toBe(323_000)
    const cover = emergencyCoverage(g.have + g.monthly * 12, month).toFixed(1).replace('.', ',')
    expect(html).toContain(`Через год покроет ${cover} мес. расходов`)
  })

  it('цель на паузе не обещает «быстрее»: её взнос и добавка уходят в досрочку', async () => {
    family({ plans: [planOf()] })
    const html = await renderScreen(Ritual, '/ritual', undefined, [screenMixin({ alloc: { trip: 10_000 } })])
    const trip = html.slice(html.indexOf('>Отпуск<'), html.indexOf('>Машина<'))
    expect(trip).toContain(`На паузе ради плана: +${money(10_000)} пойдут в досрочку, цель ускорится после плана`)
    expect(trip).not.toContain('Быстрее')
    expect(html.slice(html.indexOf('>Машина<'))).toContain('На паузе ради плана: её взнос сейчас идёт в досрочку')
  })

  it('внесённый шаг закрыл самый дорогой долг — Ритуал называет его, а не следующий', async () => {
    const store = family({ plans: [planOf()] })
    const left = store.credits.find((c) => c.id === 'cc')!.principal
    store.applyPrepayment('cc', 'a', { amount: left, mode: 'term', accountId: 'card', planId: 'plan' })
    expect(store.credits.find((c) => c.id === 'cc')!.principal).toBe(0)
    const html = await renderScreen(Ritual, '/ritual')
    expect(html).toContain(`Шаг этого месяца внесён — ${money(left)} в «Кредитка»`)
  })

  it('confirm пишет только цели: досрочки по плану Ритуал не вносит', async () => {
    const store = family({ plans: [planOf()] })
    await renderScreen(Ritual, '/ritual', undefined, [
      screenMixin({ alloc: { plan: 10_000, trip: 10_000 } }, (s) => (s.confirm as () => void)()),
    ])
    expect(store.payments).toEqual([])
    expect(store.goals.find((g) => g.id === 'trip')!.monthly).toBe(50_000)
  })
})
