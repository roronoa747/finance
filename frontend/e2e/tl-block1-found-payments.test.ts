import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import { foundPayments } from '../src/lib/statements/firstRun'
import { todayIso } from '../src/lib/dates'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 1 «Хвосты» (TL-01…TL-03; Р-1…Р-3): «нашли в выписке» — только похожее на платежи. Новая семья, пятница 23 октября
 * 2026; выписка 1–22 октября (три недели).
 *
 * Ручной расчёт (TL-01):
 *   Netflix 3 990 7-го — словарь (подписка) → «нашли».
 *   Coffee Boom 2 500 по два раза в неделю (1, 2, 8, 9, 15, 16) и Yandex Go 3 000 (5, 6, 12, 13, 19, 20) — близкие суммы в
 *   близкие дни (`detectRecurring` их ловит), но в месяце по шесть списаний → мимо (Р-1). Magnum — продукты, разные суммы →
 *   мимо. Итог: «нашли 1 в выписке», в списке только Netflix.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const K = '2026-10'
const op = (date: string, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const statement = (ops: Omit<Operation, 'id'>[], from = '2026-10-01', to = '2026-10-22'): ParsedStatement => ({ bank: 'kaspi', from, to, skipped: 0, operations: assignIds(ops) })
const day = (d: number) => `${K}-${String(d).padStart(2, '0')}`
const THREE_WEEKS = () => [
  op(day(7), -3_990, 'NETFLIX.COM', 'sc_subscriptions'),
  ...[1, 2, 8, 9, 15, 16].map((d) => op(day(d), -2_500, 'Coffee Boom', 'sc_cafe')),
  ...[5, 6, 12, 13, 19, 20].map((d) => op(day(d), -3_000, 'Yandex Go', 'sc_transport')),
  op(day(3), -12_400, 'Magnum', 'sc_food'), op(day(10), -18_700, 'Magnum', 'sc_food'), op(day(17), -9_300, 'Magnum', 'sc_food'),
]

describe('e2e / Хвосты Блок 1 — платежи из выписки', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate

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
    server = fakeServer({ ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }], setupDoneAt: T0 })
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
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

  async function uploaded(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    await useOperationsStore().upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }

  const month = (p: Phone, state: Record<string, unknown> = {}) => {
    setActivePinia(p.pinia)
    return screen(p.pinia, Month, '/month', undefined, [screenMixin(state)])
  }
  const found = (p: Phone) => {
    setActivePinia(p.pinia)
    return foundPayments(useOperationsStore().all, { rules: p.store.merchantRules, payments: p.store.payments, today: todayIso() })
  }

  it('TL-01: три недели выписки — «нашли 1 в выписке», в списке только подписка; кофейня, такси и магазин — мимо', async () => {
    const A = await phone()
    await uploaded(A, statement(THREE_WEEKS()))
    const html = await month(A, { opened: 'dues' })
    expect(html).toContain('data-section-found="1"')
    expect(html).toContain('нашли 1 в выписке')
    const rows = [...html.matchAll(/data-found-row="([^"]+)"/g)].map((m) => m[1])
    expect(rows).toEqual(found(A).map((f) => f.opId))
    expect(found(A).map((f) => [f.name, f.amount, f.kind])).toEqual([['NETFLIX.COM', 3_990, 'subscription']])
    for (const m of ['Coffee Boom', 'Yandex Go', 'Magnum']) expect(html).not.toContain(m)
  })
})
