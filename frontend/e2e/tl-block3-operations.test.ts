// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import OpSheet from '../src/components/OpSheet.vue'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 3 «Хвосты» (TL-07…TL-09; Р-4…Р-6): лист операции и вопросы ведут себя предсказуемо. Новая семья на фейковом
 * сервере, пятница 23 октября 2026; телефон — свой стор Pinia на своём клиенте.
 */
let app: App | null = null
const storage = new Map<string, string>()
let server: FakeServer
let st: FakeStatements
let pv: FakePrivate

type Phone = { pinia: ReturnType<typeof createPinia>; client: ApiClient; store: ReturnType<typeof useFinanceStore> }
const op = (date: string, amount: number, merchant: string, categoryId: string | null, p: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...p,
})
const statement = (ops: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from: '2026-09-01', to: '2026-10-22', skipped: 0, operations: assignIds(ops) })

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
  vi.useFakeTimers()
  at('2026-10-23T07:00:00Z')
  server = fakeServer({
    ...defaultSyncDoc(),
    people: [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }],
    setupDoneAt: T0,
    spendPlans: [{ id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 50_000, updatedAt: T0 }],
  })
  st = fakeStatements()
  pv = fakePrivate()
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function phone(): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't-u-a', user: { id: 'u-a', email: 'u-a@family.kz', created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, 'u-a', 'a'), ...privateFor(pv, 'u-a') } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await store.pullPrivateDoc(client)
  await useOperationsStore().loadUploads(client)
  await useOperationsStore().pull(client)
  return { pinia, client, store }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const press = async (el: HTMLElement | null) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  el!.click()
  await flush()
}

/** «Потрачено» заголовка «Месяц → Траты» (SSR на сторе телефона). */
async function spent(p: Phone) {
  const html = await screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened: 'spend' })])
  return Number((html.match(/data-section-meta[^>]*>\s*потрачено ([^<]*)</)?.[1] ?? '').replace(/[^\d]/g, ''))
}

/**
 * TL-07 (Х-3, Р-4): продукты Magnum 12 400 (14 октября), Magnum вернул на карту 2 400 (16-го, «Покупка» с «+», как Kaspi),
 * Кешбэк банка 150 (15-го), перевод Марата 1 000 (15-го). Потрачено до: 12 400; после «Мне вернули» → возврат Magnum:
 * 12 400 − 2 400 = 10 000.
 */
describe('e2e / Хвосты Блок 3 — «Мне вернули» (TL-07)', () => {
  it('покупка + возврат на карту → лист операции → «Мне вернули»: возврат магазина первым, кешбэка нет; трата месяца меньше', async () => {
    const A = await phone()
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'x.pdf', parsed: statement([
      op('2026-10-14', -12_400, 'MAGNUM ALMATY KZ', 'sc_food'),
      op('2026-10-16', 2_400, 'Magnum', null),
      op('2026-10-15', 150, 'Kaspi Кешбэк', null, { kind: 'income' }),
      op('2026-10-15', 1_000, 'Марат С.', null, { kind: 'transfer-in', counterparty: 'Марат С.' }),
    ]) }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await A.store.syncHousehold(A.client)
    expect(await spent(A)).toBe(12_400)

    const buy = ops.all.find((o) => o.amount === -12_400)!
    const back = ops.all.find((o) => o.amount === 2_400)!
    const opId = ref<string | null>(buy.id)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(OpSheet, { opId: opId.value, onClose: () => (opId.value = null) }) })
    app.use(A.pinia)
    app.mount(root)
    await flush()

    await press(q('[role="dialog"] [data-op-refund]'))
    const rows = all('[role="dialog"] [data-op-income]')
    expect(rows.map((el) => el.dataset.opIncome)).toEqual([back.id, ops.all.find((o) => o.amount === 1_000)!.id])
    expect(txt(q('[role="dialog"] [data-op-refund-pick]'))).not.toContain('Кешбэк')
    await press(rows[0]!)
    expect(txt(q('[role="dialog"] [data-op-meta]'))).toContain('вернули 2 400')
    expect(ops.all.find((o) => o.id === back.id)?.internal).toBe(true)

    await A.store.syncHousehold(A.client)
    expect(await spent(A)).toBe(10_000)
  })
})
