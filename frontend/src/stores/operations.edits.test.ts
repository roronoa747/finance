import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import { planFamilyDoc } from '@/test/planFamily'
import type { Operation } from '@/lib/statements/types'
import type { OperationsPage, OperationWire } from '@/types/api'

// FB-02 (Р-11, Р-12): правки своей операции — в личном документе, накладываются при чтении; на сервер не уходят, `pull`
// и повторная загрузка выписки их не стирают; «Мне вернули» уменьшает итоги, приход-возврат — не зарплата. Синтетика.

const storage = new Map<string, string>()

function signIn() {
  useAuthStore().setAuthData({
    token: 't-a',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  useFinanceStore().claimFor('h1')
}

function fakeServer() {
  const server = { feed: [] as OperationWire[], sent: [] as OperationWire[] }
  const client = {
    upsertOperations: vi.fn(async (ops: OperationWire[]) => {
      server.sent.push(...ops)
      return { upserted: ops.length }
    }),
    listOperations: vi.fn(async (): Promise<OperationsPage> => {
      const operations = server.feed
      server.feed = []
      return { operations, next: operations.length ? '2026-10-16T10:00:00Z' : null }
    }),
    listStatementUploads: vi.fn(async () => ({ uploads: [] })),
    createStatementUpload: vi.fn(async (u: object) => ({ id: '00000000-0000-4000-8000-000000000001', slot: 'a', ...u, created_at: '' })),
  }
  return { server, client: client as unknown as ApiClient }
}

// Ильяс (a) — зарплата 700 000 10-го (`planFamilyDoc`). Перевёл Дане 9-го, она вернула переводом 10-го — сумма как зарплата.
const SPEND: Operation = { id: 'f0000001', bank: 'kaspi', date: '2026-10-09', amount: -700_000, kind: 'transfer-out', merchant: 'Дана К.', counterparty: 'Дана К.', note: 'Перевод', categoryId: null, internal: false }
const BACK: Operation = { id: 'f0000002', bank: 'kaspi', date: '2026-10-10', amount: 700_000, kind: 'transfer-in', merchant: 'Дана К.', counterparty: 'Дана К.', note: 'Перевод', categoryId: null, internal: false }
const COFFEE: Operation = { id: 'f0000003', bank: 'kaspi', date: '2026-10-12', amount: -2_000, kind: 'purchase', merchant: 'Coffee Boom', categoryId: null, internal: false }
const statement = () => [{ name: 'kaspi.pdf', parsed: { bank: 'kaspi' as const, from: '2026-10-01', to: '2026-10-15', skipped: 0, operations: [SPEND, BACK, COFFEE] } }]

const total = (kind: 'week' | 'month', period: string, categoryId: string) =>
  (useFinanceStore().householdDoc.spendTotals ?? []).find((t) => t.by === 'a' && t.kind === kind && t.period === period && t.categoryId === categoryId)

async function loaded() {
  signIn()
  useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
  const store = useOperationsStore()
  const fake = fakeServer()
  await store.upload(statement(), fake.client)
  await vi.advanceTimersByTimeAsync(6_000)
  fake.server.sent = []
  return { store, ...fake }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T08:00:00Z'))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FB-02 — правки операции (editOp)', () => {
  it('«Мне вернули» переводом: итоги недели и месяца раздела уменьшены, приход — не вопрос «это зарплата?», на сервер ничего', async () => {
    const { store, server } = await loaded()
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 700_000, ops: 1 })
    expect(store.pendingMatches.map((c) => [c.kind, c.opId])).toEqual([['salary', BACK.id]])
    expect(store.refundsFor(store.all.find((o) => o.id === SPEND.id)!).map((o) => o.id)).toEqual([BACK.id])

    store.editOp(SPEND.id, { refund: { amount: 700_000, opId: BACK.id } })
    expect(store.all.find((o) => o.id === SPEND.id)?.refund).toEqual({ amount: 700_000, opId: BACK.id })
    expect(store.all.find((o) => o.id === BACK.id)?.internal).toBe(true)
    // Сырая копия — как была: приход не стал «между своими» на устройстве и на сервере.
    expect(store.ops[BACK.id].internal).toBe(false)
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 0, ops: 1 })
    expect(total('week', '2026-W41', 'sc_people')).toMatchObject({ amount: 0, ops: 1 })
    expect(store.pendingMatches).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(server.sent).toEqual([])
    expect(store.pendingCount).toBe(0)

    // Снять — чип ещё раз: всё как было.
    store.editOp(SPEND.id, { refund: null })
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 700_000, ops: 1 })
    expect(store.pendingMatches.map((c) => c.opId)).toEqual([BACK.id])
  })

  it('правка пришла со второго своего телефона (личный документ синком) — итоги её периодов переписываются', async () => {
    const { store } = await loaded()
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 700_000 })
    useFinanceStore().privateDoc = { ...useFinanceStore().privateDoc, opEdits: [{ id: SPEND.id, refund: { amount: 100_000 }, updatedAt: '2026-10-16T09:00:00Z' }] }
    await nextTick()
    expect(store.all.find((o) => o.id === SPEND.id)?.refund).toEqual({ amount: 100_000 })
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 600_000 })
  })

  it('наличными, частично: сумма траты — минус возврат', async () => {
    const { store } = await loaded()
    store.editOp(SPEND.id, { refund: { amount: 200_000 } })
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 500_000 })
  })

  it('заметка переживает pull (сервер перезаписал копию) и повторную загрузку той же выписки', async () => {
    const { store, server, client } = await loaded()
    store.editOp(COFFEE.id, { memo: 'с коллегой' })
    expect(store.all.find((o) => o.id === COFFEE.id)?.memo).toBe('с коллегой')
    expect(store.ops[COFFEE.id].memo).toBeUndefined()

    server.feed = [{ id: COFFEE.id, bank: 'kaspi', date: COFFEE.date, amount: COFFEE.amount, kind: 'purchase', merchant: COFFEE.merchant, category_id: 'sc_cafe', internal: false, updated_at: '2026-10-16T09:00:00Z' }]
    await store.pull(client)
    expect(store.all.find((o) => o.id === COFFEE.id)).toMatchObject({ memo: 'с коллегой', categoryId: 'sc_cafe' })

    await store.upload(statement(), client)
    // Пока висит тост — строки черновика уже с правкой.
    expect(store.shown.find((o) => o.id === COFFEE.id)?.memo).toBe('с коллегой')
    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.all.find((o) => o.id === COFFEE.id)?.memo).toBe('с коллегой')
    // Правка не ушла на сервер ни с одной отправкой.
    expect(server.sent.some((o) => 'memo' in o || 'refund' in o)).toBe(false)
  })

  // Критик Блока 1: днём приходит пуш, выписка — потом; правка пуша не должна пропасть вместе с ним.
  const pushWire = (id: string, date: string, amount: number, kind: string, merchant: string): OperationWire => ({
    id, bank: 'kaspi', date, amount, kind, merchant, category_id: null, internal: false,
    source: 'push', occurred_at: `${date}T09:00:00Z`, updated_at: `${date}T09:00:01Z`,
  })

  it('выписка заменила пуш — заметка и «Мне вернули» переходят к её строке, итоги не растут обратно; запись пуша снята', async () => {
    signIn()
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [pushWire('p0000001', '2026-10-14', -30_000, 'transfer-out', 'Перевод Айгерим С.')]
    await store.pull(client)
    store.editOp('p0000001', { memo: 'ужин', refund: { amount: 10_000 } })
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 20_000, ops: 1 })

    const line: Operation = { id: 'f0000009', bank: 'kaspi', date: '2026-10-14', amount: -30_000, kind: 'transfer-out', merchant: 'Айгерим С.', counterparty: 'Айгерим С.', note: 'Перевод', categoryId: null, internal: false }
    await store.upload([{ name: 'kaspi.pdf', parsed: { bank: 'kaspi', from: '2026-10-01', to: '2026-10-15', skipped: 0, operations: [line] } }], client)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.all.map((o) => o.id)).toEqual(['f0000009'])
    expect(store.all[0]).toMatchObject({ memo: 'ужин', refund: { amount: 10_000 } })
    expect(total('month', '2026-10', 'sc_people')).toMatchObject({ amount: 20_000, ops: 1 })
    expect(useFinanceStore().opEdits.find((e) => e.id === 'p0000001')).toMatchObject({ memo: null, refund: null })
  })

  it('вернули переводом с телефона: выписка заменила пуш прихода — возврат указывает на её строку, та «между своими»', async () => {
    const { store, server, client } = await loaded()
    server.feed = [pushWire('p0000002', '2026-10-16', 2_000, 'transfer-in', 'Перевод Дана К.')]
    await store.pull(client)
    store.editOp(COFFEE.id, { refund: { amount: 2_000, opId: 'p0000002' } })
    expect(store.all.find((o) => o.id === 'p0000002')?.internal).toBe(true)

    const back: Operation = { id: 'f0000010', bank: 'kaspi', date: '2026-10-16', amount: 2_000, kind: 'transfer-in', merchant: 'Дана К.', counterparty: 'Дана К.', note: 'Перевод', categoryId: null, internal: false }
    await store.upload([{ name: 'kaspi-2.pdf', parsed: { bank: 'kaspi', from: '2026-10-16', to: '2026-10-16', skipped: 0, operations: [back] } }], client)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.all.some((o) => o.id === 'p0000002')).toBe(false)
    expect(store.all.find((o) => o.id === COFFEE.id)?.refund).toEqual({ amount: 2_000, opId: 'f0000010' })
    expect(store.all.find((o) => o.id === 'f0000010')?.internal).toBe(true)
    expect(store.pendingMatches.filter((c) => c.opId === 'f0000010')).toEqual([])
  })

  it('пустая заметка снимает правку; запись в личном документе остаётся без полей (не надгробие)', async () => {
    const { store } = await loaded()
    store.editOp(COFFEE.id, { memo: 'обед' })
    store.editOp(COFFEE.id, { memo: '  ' })
    expect(store.all.find((o) => o.id === COFFEE.id)?.memo).toBeUndefined()
    const rec = useFinanceStore().opEdits.find((e) => e.id === COFFEE.id)!
    expect(rec.memo).toBeNull()
    expect(rec.deletedAt ?? null).toBeNull()
  })
})
