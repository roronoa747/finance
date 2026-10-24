// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, createWebHistory, RouterView } from 'vue-router'
import { createAppRouter, routes } from '../src/router'
import type { ApiClient } from '../src/api/client'
import { startDemo } from '../src/lib/demo'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 2 «Хвосты» (TL-04…TL-06): сценарии сверх e2e исполнителя — демо «Месяц → Траты» (строки = свой факт,
 * Х-26: вторая подписка — в листе «Платежи без отметки» с «В платежи»), партнёр со своей выпиской и viewer.
 */
let app: App | null = null

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const flush = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const tenge = (el: Element | null) => Number(txt(el).replace(/[^\d]/g, ''))
/** Строки «Мои разделы» + тихие строки «Трат». */
const spendLines = () =>
  [...all('[data-spend-row] [data-spend-amount]'), ...all('[data-spend-unknown] .num, [data-spend-oneoff] .num, [data-spend-unmarked] .num')].reduce((s, el) => s + tenge(el), 0)
/** Факт участника в его строке «факт / план». */
const factOf = (by: string) => tenge(q(`[data-spend-person="${by}"] [data-person-amount] b`))

describe('приёмка / Хвосты Блок 2 — демо', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('«Месяц → Траты»: свои строки + тихие = свой факт; Х-26 — вторая подписка 1 990 в «Платежах без отметки» с «В платежи» → заведена, строка ушла, снова сходится', async () => {
    setActivePinia(createPinia())
    startDemo()
    window.history.replaceState(null, '', '/month')
    const router = createAppRouter(createWebHistory())
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(RouterView) })
    app.use(router)
    await router.isReady()
    app.mount(root)
    await flush()
    const today = new Date().toISOString().slice(0, 10)
    useOperationsStore().seedDemoOperations([{ id: 'demo-op-x26', bank: 'kaspi', date: today, amount: -1_990, kind: 'purchase', merchant: 'Яндекс Плюс', categoryId: 'sc_subscriptions', internal: false }])
    await flush()
    q<HTMLButtonElement>('[data-section="spend"]')!.click()
    await flush()

    const me = q<HTMLElement>('[data-spend-person]')!.dataset.spendPerson!
    expect(tenge(q('[data-spend-unmarked] .num'))).toBeGreaterThanOrEqual(1_990)
    const before = spendLines()
    expect(before).toBe(factOf(me))

    q<HTMLButtonElement>('[data-spend-unmarked]')!.click()
    await flush()
    expect(all('[role="dialog"] [data-cat-op]').map((el) => el.dataset.catOp)).toContain('demo-op-x26')
    const pay = q<HTMLButtonElement>('[data-cat-pay="demo-op-x26"]')
    expect(pay, '«В платежи» у второй подписки').not.toBeNull()
    pay!.click()
    await flush()
    all('[role="dialog"] button').find((b) => txt(b) === 'Добавить')!.click()
    await flush()

    expect(all('[role="dialog"] [data-cat-op]').map((el) => el.dataset.catOp)).not.toContain('demo-op-x26')
    expect(spendLines()).toBe(before - 1_990)
    expect(spendLines()).toBe(factOf(me))
  })
})

/**
 * Партнёр и viewer, пятница 23 октября 2026; у каждого своя выписка 1–22 октября, платежи не заведены.
 *   Ильяс: Magnum 30 000 (продукты), NETFLIX 3 990 (подписки) → строки 30 000, «Платежи без отметки» 3 990, факт 33 990.
 *   Аруна: Small 20 000 (продукты), ALSECO 15 000 (коммуналка, словарный вид — «В платежи») → строки 20 000,
 *          «Платежи без отметки» 15 000, факт 35 000.
 */
describe('приёмка / Хвосты Блок 2 — партнёр и viewer', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }
  const op = (date: string, amount: number, merchant: string, categoryId: string): Omit<Operation, 'id'> => ({
    bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
  })
  const statement = (ops: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from: '2026-10-01', to: '2026-10-22', skipped: 0, operations: assignIds(ops) })

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-23T07:00:00Z')
    server = fakeServer(
      planFamilyDoc({
        spendPlans: [
          { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
          { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 },
        ],
      }),
    )
    st = fakeStatements()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const user = role === 'viewer' ? 'u-v' : `u-${slot}`
    useAuthStore().setAuthData({
      token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
    })
    const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await useOperationsStore().loadUploads(client)
    return { pinia, client, store }
  }
  async function uploaded(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    await useOperationsStore().upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }
  async function family() {
    const A = await phone('a')
    const B = await phone('b')
    await uploaded(A, statement([op('2026-10-03', -30_000, 'Magnum', 'sc_food'), op('2026-10-07', -3_990, 'NETFLIX.COM', 'sc_subscriptions')]))
    await uploaded(B, statement([op('2026-10-04', -20_000, 'Small', 'sc_food'), op('2026-10-12', -15_000, 'ALSECO', 'sc_utilities')]))
    for (const p of [A, B]) {
      setActivePinia(p.pinia)
      await p.store.pullHousehold(p.client)
      await useOperationsStore().loadUploads(p.client)
    }
    return { A, B }
  }
  /** «Месяц» телефона в DOM (листы телепортируются в `body`), секция «Траты» раскрыта. */
  async function month(p: Phone, path = '/month') {
    app?.unmount()
    document.body.innerHTML = ''
    setActivePinia(p.pinia)
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Month)
    app.use(p.pinia)
    app.use(router)
    app.mount(root)
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0)
    q<HTMLButtonElement>('[data-section="spend"]')!.click()
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0)
  }

  it('у каждого — свои «Платежи без отметки», свои строки + тихие = свой факт; лист — только свои строки с «В платежи»', async () => {
    const { A, B } = await family()

    await month(A)
    expect(tenge(q('[data-spend-unmarked] .num'))).toBe(3_990)
    expect(spendLines()).toBe(33_990)
    expect(factOf('a')).toBe(33_990)
    expect(factOf('b')).toBe(35_000)

    await month(B)
    expect(tenge(q('[data-spend-unmarked] .num'))).toBe(15_000)
    expect(spendLines()).toBe(35_000)
    expect(factOf('b')).toBe(35_000)

    await month(B, '/month?unmarked=1')
    const sheet = all('[role="dialog"]').at(-1)!
    expect(tenge(sheet.querySelector('[data-unmarked-amount]'))).toBe(15_000)
    expect(txt(sheet)).toContain('ALSECO')
    expect(txt(sheet)).not.toContain('NETFLIX')
    expect(sheet.querySelectorAll('[data-cat-pay]')).toHaveLength(1)
  })

  it('viewer: строки «Платежи без отметки» нет, лист по адресу `?unmarked=1` не открывается', async () => {
    await family()
    const V = await phone('a', 'viewer')
    await month(V)
    expect(q('[data-spend-person="a"]')).not.toBeNull()
    expect(q('[data-spend-unmarked]')).toBeNull()
    await month(V, '/month?unmarked=1')
    expect(q('[data-unmarked-amount]')).toBeNull()
  })
})
