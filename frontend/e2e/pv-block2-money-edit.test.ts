import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import { createRenderer, createSSRApp, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { useAuthStore } from '../src/stores/auth'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc } from '../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '../src/types/api'
import { budgetAmounts, nextCreditDue } from '../src/lib/finance'
import Capital from '../src/views/Capital.vue'
import Overview from '../src/views/Overview.vue'
import PaidRow from '../src/components/PaidRow.vue'

/**
 * Блок 2 «Правка денег» (PV-09…PV-13): два телефона — два стора Pinia на одном
 * фейковом сервере с ревизиями и 409, как в e2e Блока 1 RP. Браузерная проверка —
 * на стенде §6 (скрипты в scratchpad сессии, не в репо).
 */

describe('PV-09: кит окон', () => {
  it('токен затемнения --scrim — в светлой и тёмной теме, окна берут цвет только из него', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8')
    const block = (sel: string) => {
      const at = css.indexOf(`${sel} {`)
      return css.slice(at, css.indexOf('\n}', at))
    }
    expect(block(':root')).toMatch(/--scrim:/)
    expect(block('.dark')).toMatch(/--scrim:/)
    expect(css).toMatch(/--color-scrim: var\(--scrim\)/)

    // Экраны блока — без литерального затемнения.
    for (const file of ['../src/views/Capital.vue', '../src/components/PaidRow.vue']) {
      const src = readFileSync(resolve(import.meta.dirname, file), 'utf-8')
      expect(src).not.toMatch(/bg-black|fixed inset-0|<select/)
    }
  })
})

describe('e2e / Блок 2 паритета — правка денег на двух телефонах', () => {
  let server: { rev: number; data: SyncDoc }
  const T0 = '2026-09-01T00:00:00.000Z'

  function backend(): ApiClient {
    const snapshot = (): HouseholdDocResponse => ({
      household_id: 'h-family',
      rev: server.rev,
      data: JSON.parse(JSON.stringify(server.data)),
      updated_at: new Date().toISOString(),
    })
    return {
      getHouseholdDoc: vi.fn(async () => snapshot()),
      pushHouseholdDoc: vi.fn(async (rev: number, data: SyncDoc) => {
        if (rev !== server.rev) {
          const conflict: ConflictResponse<HouseholdDocResponse> = { error: 'conflict', server_doc: snapshot() }
          throw new ApiError('conflict', 409, conflict)
        }
        server = { rev: server.rev + 1, data: JSON.parse(JSON.stringify(data)) }
        return snapshot()
      }),
    } as unknown as ApiClient
  }

  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  async function phone() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useFinanceStore()
    const client = backend()
    await store.pullHousehold(client)
    return { store, client, pinia }
  }

  /** Экран глазами телефона: SSR-рендер на его сторе. */
  async function screen(pinia: Pinia, view: Component, path: string) {
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    const app = createSSRApp(view)
    app.use(router)
    return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  }

  beforeEach(() => {
    // Таймеры подделаны: запланированный синк не уходит в настоящий apiClient.
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    vi.stubGlobal('navigator', { onLine: true })
    server = {
      rev: 1,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
        ],
        accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
        obligations: [
          { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
        ],
        credits: [
          { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
        ],
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('PV-10: правка ставки у кредита с отметкой не меняет остаток; правка остатка — якорь; второй телефон видит день и ставку', async () => {
    const A = await phone()
    const B = await phone()

    at('2026-09-24T08:00:00Z')
    A.store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
    expect(A.store.credits[0].principal).toBe(969_500)

    at('2026-09-24T09:00:00Z')
    A.store.updateCredit('loan', { annualRate: 0.25, day: 20 })
    expect(A.store.credits[0].principal).toBe(969_500)
    expect(A.store.householdDoc.credits[0].principalSetAt).toBe(T0)
    await A.store.syncHousehold(A.client)

    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(B.store.credits[0]).toMatchObject({ annualRate: 0.25, day: 20, principal: 969_500 })
    // Следующий платёж — в новый день (сентябрь оплачен, дальше октябрь).
    expect(nextCreditDue(B.store.credits[0], B.store.payments)).toMatchObject({ period: '2026-10', day: 20 })
    const capitalB = await screen(B.pinia, Capital, '/capital?credit=loan')
    expect(capitalB).toContain('value="25,0"')
    expect(capitalB).toContain('Платёж 20 октября')

    // Сверка с банком на втором телефоне — новая база и якорь; отметка до якоря в ней.
    at('2026-09-25T08:00:00Z')
    B.store.updateCredit('loan', { principal: 960_000 })
    expect(B.store.householdDoc.credits[0].principalSetAt).toBe('2026-09-25T08:00:00.000Z')
    expect(B.store.credits[0].principal).toBe(960_000)
    await B.store.syncHousehold(B.client)
    setActivePinia(A.pinia)
    await A.store.pullHousehold(A.client)
    expect(A.store.credits[0].principal).toBe(960_000)
  })

  /** Форма Капитала на телефоне: поля заполнены, нажата кнопка формы. */
  async function submit(pinia: Pinia, path: string, state: Record<string, unknown>, action: string) {
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    const app = createSSRApp(Capital)
    app.use(router)
    app.mixin({
      created() {
        if (this.$.parent !== null) return
        Object.assign(this.$.setupState, state)
        this.$.setupState[action]()
      },
    })
    await renderToString(app)
  }

  it('PV-11: коммуналка с оценкой из формы — «До зарплаты» спрашивает сумму; аренда в «Жильё» — d1 Бюджета, не d4', async () => {
    const A = await phone()
    const B = await phone()

    at('2026-09-24T08:00:00Z')
    await submit(A.pinia, '/capital?add=payment', { obName: 'Коммуналка', obAmount: '35 000', obDay: '8', obCategory: 'd1', obEstimate: true }, 'createObligation')
    await submit(A.pinia, '/capital?add=payment', { obName: 'Гараж', obAmount: '30 000', obDay: '9', obCategory: 'd1' }, 'createObligation')
    const util = A.store.obligations.find((o) => o.name === 'Коммуналка')!
    expect(util).toMatchObject({ category: 'd1', estimate: true, day: 8 })
    await A.store.syncHousehold(A.client)

    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    // «До зарплаты» (до 10 октября): коммуналка 8 октября — с «оценкой», её «Оплатил» откроет лист с суммой.
    const overview = await screen(B.pinia, Overview, '/')
    const until = overview.slice(overview.indexOf('Коммуналка'))
    expect(until.slice(0, until.indexOf('Оплатил'))).toContain('оценка')

    // Жильё — d1 Бюджета: аренда 220 000 + коммуналка 35 000 + гараж 30 000; в d4 их нет.
    const amounts = budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits })
    expect(amounts.d1).toBe(285_000)
    expect(amounts.d4).toBe(0)

    // Нажатие «Оплатил» (критик): счёт уже известен по сентябрю — без оценки платёж
    // отмечается одним нажатием, с оценкой открывается лист с суммой, отметки нет.
    const garage = B.store.obligations.find((o) => o.name === 'Гараж')!
    for (const o of [util, garage]) B.store.markPaid('obligation', o.id, 'b', { period: '2026-09', accountId: 'card' })
    const tap = async (targetId: string, title: string) => {
      setActivePinia(B.pinia)
      let sheet: unknown
      const app = createSSRApp(PaidRow, { kind: 'obligation', targetId, period: '2026-10', title })
      app.mixin({
        created() {
          if (this.$.parent !== null) return
          ;(this.$.setupState.tap as () => void)()
          sheet = this.$.setupState.sheet
        },
      })
      await renderToString(app)
      return sheet
    }
    const october = (id: string) => B.store.payments.filter((p) => p.targetId === id && p.period === '2026-10')
    expect(await tap(util.id, 'Коммуналка')).toBe('mark')
    expect(october(util.id)).toHaveLength(0)
    expect(await tap(garage.id, 'Гараж')).toBe(null)
    expect(october(garage.id)).toHaveLength(1)
  })

  /**
   * Живой экран без браузера: рендерер Vue на простых объектах вместо DOM. В SSR
   * наблюдатели не работают, а закрытие окна чистит адрес именно наблюдателем.
   * Возвращает состояние экрана (setupState).
   */
  function mountLive(pinia: Pinia, router: ReturnType<typeof createAppRouter>) {
    type N = { children: N[]; parent: N | null; text?: string }
    const node = (text?: string): N => ({ children: [], parent: null, text })
    const detach = (n: N) => {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    }
    const { createApp } = createRenderer<N, N>({
      createElement: () => node(),
      createText: (t) => node(t),
      createComment: (t) => node(t),
      setText: (n, t) => void (n.text = t),
      setElementText: (n, t) => {
        n.children = []
        n.text = t
      },
      insert: (child, parent, anchor) => {
        detach(child)
        const i = anchor ? parent.children.indexOf(anchor) : -1
        if (i < 0) parent.children.push(child)
        else parent.children.splice(i, 0, child)
        child.parent = parent
      },
      remove: detach,
      parentNode: (n) => n.parent,
      nextSibling: (n) => (n.parent ? (n.parent.children[n.parent.children.indexOf(n) + 1] ?? null) : null),
      patchProp: () => {},
      querySelector: () => null,
    })
    setActivePinia(pinia)
    const app = createApp(Capital)
    app.use(router)
    // Vitest в Node собирает .vue для SSR: setup пишет свой модуль в SSR-контекст, а
    // рендер у компонента серверный. Нужен только setup с наблюдателями — рисовать нечего.
    app.provide(ssrContextKey, { modules: new Set() })
    app.config.warnHandler = (msg) => {
      if (!/missing template or render function/.test(msg)) console.warn(msg)
    }
    const vm = app.mount(node())
    return vm.$.setupState as Record<string, unknown>
  }

  it('PV-12 (Б-15): окно, открытое по адресу, при закрытии чистит адрес — тот же «+» открывает его снова', async () => {
    const A = await phone()
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h-family', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h-family', user_id: 'u', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: T0 },
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/capital?add=debt')
    expect(router.currentRoute.value.fullPath).toBe('/capital?add=debt')
    const screenA = mountLive(A.pinia, router)
    expect(screenA.addDebtOpen).toBe(true)

    const navigated = () => new Promise<void>((done) => { const off = router.afterEach(() => { off(); done() }) })
    let next = navigated()
    screenA.addDebtOpen = false
    await next
    expect(router.currentRoute.value.fullPath).toBe('/capital')

    // Второй «+ Кредит или рассрочка» — новый переход, форма снова открыта.
    await router.push('/capital?add=debt')
    await nextTick()
    expect(screenA.addDebtOpen).toBe(true)

    // Строка Бюджета → кредит; из него — калькулятор: адрес держится, пока открыто хоть одно окно.
    screenA.addDebtOpen = false
    await navigated()
    await router.push('/capital?credit=loan')
    await nextTick()
    expect(screenA.selectedCreditId).toBe('loan')
    screenA.payoffCreditId = 'loan'
    screenA.selectedCreditId = null
    await nextTick()
    expect(router.currentRoute.value.query.credit).toBe('loan')
    next = navigated()
    screenA.payoffCreditId = null
    await next
    expect(router.currentRoute.value.fullPath).toBe('/capital')
    await router.push('/capital?credit=loan')
    await nextTick()
    expect(screenA.selectedCreditId).toBe('loan')

    // Кредит удалили на другом телефоне, пока окно открыто (критик): лист закрылся, id в
    // ref остался — адрес всё равно чистится, и «+» открывает форму снова.
    next = navigated()
    A.store.removeCredit('loan')
    await next
    expect(router.currentRoute.value.fullPath).toBe('/capital')
    await router.push('/capital?add=debt')
    await nextTick()
    expect(screenA.addDebtOpen).toBe(true)
  })

  it('PV-10 (критик): закрытый кредит снова открыт сверкой остатка — у модалки появляется «Оплатил»', async () => {
    const A = await phone()
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h-family', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h-family', user_id: 'u', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: T0 },
    })
    at('2026-09-24T08:00:00Z')
    A.store.applyPrepayment('loan', 'a', { amount: 1_000_000, mode: 'term', accountId: 'card' })
    expect(A.store.credits[0].principal).toBe(0)

    const router = createAppRouter(createMemoryHistory())
    await router.push('/capital?credit=loan')
    const screenA = mountLive(A.pinia, router)
    expect(screenA.creditDue).toBe(null)

    at('2026-09-24T09:00:00Z')
    ;(screenA.onCreditPrincipal as (t: string) => void)('150 000')
    await nextTick()
    expect(A.store.credits[0].principal).toBe(150_000)
    expect(screenA.creditDue).toMatchObject({ kind: 'credit', targetId: 'loan', period: '2026-09', day: 15 })
  })
})
