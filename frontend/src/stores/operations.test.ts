import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from './auth'
import { useFinanceStore } from './finance'
import { BATCH_SIZE, PULL_LIMIT, toWire, useOperationsStore } from './operations'
import { assignIds } from '@/lib/statements/model'
import { parseStatement } from '@/lib/statements/parsers'
import type { Operation, ParsedStatement } from '@/lib/statements/types'
import type { OperationsPage, OperationWire, StatementUploadResponse } from '@/types/api'
import kaspi01 from '@/lib/statements/fixtures/kaspi-01.rows.json'

const storage = new Map<string, string>()

function signIn(slot: 'a' | 'b' = 'a', role: 'member' | 'viewer' = 'member', household = 'h1') {
  useAuthStore().setAuthData({
    token: `t-${slot}`,
    user: { id: `u-${slot}`, email: `${slot}@b.kz`, created_at: '' },
    household: { id: household, name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: household, user_id: `u-${slot}`, slot, display_name: slot, role, joined_at: '' },
  })
  useFinanceStore().claimFor(household)
}

function fakeServer(slot = 'a') {
  const server = { uploads: [] as StatementUploadResponse[], ops: new Map<string, OperationWire>(), batches: [] as number[] }
  const client = {
    createStatementUpload: vi.fn(async (u: Omit<StatementUploadResponse, 'id' | 'slot' | 'created_at'>) => {
      const record = { id: `00000000-0000-4000-8000-00000000000${server.uploads.length + 1}`, slot, ...u, created_at: '2026-09-26T10:00:00Z' } as StatementUploadResponse
      server.uploads.unshift(record)
      return record
    }),
    listStatementUploads: vi.fn(async () => ({ uploads: [...server.uploads] })),
    upsertOperations: vi.fn(async (ops: OperationWire[]) => {
      server.batches.push(ops.length)
      for (const o of ops) server.ops.set(o.id, o)
      return { upserted: ops.length }
    }),
    listOperations: vi.fn(async (_since: string | null, _limit: number): Promise<OperationsPage> => ({ operations: [], next: null })),
  }
  return { server, client: client as unknown as ApiClient, calls: client }
}

const kaspi = (): ParsedStatement => parseStatement(kaspi01)
const draftOf = (parsed: ParsedStatement) => [{ name: 'выписка.pdf', parsed }]
const spentIn = (ops: Operation[], month: string) =>
  ops.filter((o) => o.amount < 0 && !o.internal && o.date.startsWith(month)).reduce((s, o) => s - o.amount, 0)

beforeEach(() => {
  vi.useFakeTimers() // синк документа по таймеру в сеть не уходит
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  // Правила уходят в личный документ — сеть в тестах стора не нужна.
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('stores/operations — отправка выписки', () => {
  it('батчи по 500; запись загрузки одна, операции получают её id; список загрузок обновлён', async () => {
    signIn()
    const store = useOperationsStore()
    const { client, server, calls } = fakeServer()
    const ops = assignIds(
      Array.from({ length: 1200 }, (_, i) => ({
        bank: 'kaspi' as const, date: `2026-09-${String((i % 20) + 1).padStart(2, '0')}`, amount: -(100 + i),
        kind: 'purchase' as const, merchant: 'Magnum', categoryId: null, internal: false,
      })),
    )
    store.setDraft(draftOf({ bank: 'kaspi', from: '2026-09-01', to: '2026-09-26', operations: ops, skipped: 0 }))
    await store.send(client)

    expect(calls.createStatementUpload).toHaveBeenCalledTimes(1)
    expect(calls.createStatementUpload).toHaveBeenCalledWith({ bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-26', ops_count: 1200 })
    expect(server.batches).toEqual([BATCH_SIZE, BATCH_SIZE, 200])
    expect([...server.ops.values()].every((o) => o.upload_id === server.uploads[0].id)).toBe(true)
    expect(store.all.every((o) => o.uploadId === server.uploads[0].id)).toBe(true)
    expect(store.pending).toEqual([])
    expect(store.uploads.map((u) => u.bank)).toEqual(['kaspi'])
    expect(store.draft).toBeNull()
  })

  it('итоги — в общем документе по id, из всех своих операций периода; повторная отправка не удваивает', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client, server } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)

    expect(finance.householdDoc.spendCategories?.length).toBeGreaterThan(0)
    const july = () => (finance.householdDoc.spendTotals ?? []).filter((t) => t.id.startsWith('a:month:2025-07:'))
    const julySum = () => july().reduce((s, t) => s + t.amount, 0)
    expect(julySum()).toBe(spentIn(store.all, '2025-07'))
    expect(july().every((t) => t.id === `a:month:2025-07:${t.categoryId}` && Number.isInteger(t.amount))).toBe(true)
    const before = JSON.stringify(july().map((t) => [t.id, t.amount, t.ops]))

    // Загрузка части месяца пересчитывает месяц из всех операций, а не только из новых.
    const part = kaspi()
    part.operations = part.operations.filter((o) => o.date === '2025-07-26')
    store.setDraft(draftOf(part))
    await store.send(client)
    expect(JSON.stringify(july().map((t) => [t.id, t.amount, t.ops]))).toBe(before)

    // Тот же файл ещё раз: те же id, операций столько же, итоги те же.
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    expect(store.all).toHaveLength(60)
    expect(server.ops.size).toBe(60)
    expect(JSON.stringify(july().map((t) => [t.id, t.amount, t.ops]))).toBe(before)
  })

  it('перед итогами забирает свои операции со второго устройства; двойное «Отправить» — одна отправка', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client, calls } = fakeServer()
    // Со второго устройства уже ушла покупка в июле — в этой копии её ещё нет.
    const [other] = assignIds([
      { bank: 'freedom', date: '2025-07-10', amount: -7_000, kind: 'purchase', merchant: 'Magnum', categoryId: 'sc_food', internal: false },
    ])
    calls.listOperations.mockResolvedValueOnce({
      operations: [{ ...toWire(other), updated_at: '2026-09-26T10:00:00Z' }],
      next: '2026-09-26T10:00:00Z',
    })
    store.setDraft(draftOf(kaspi()))
    await Promise.all([store.send(client), store.send(client)])

    expect(calls.createStatementUpload).toHaveBeenCalledTimes(1)
    expect(store.ops[other.id]).toBeDefined()
    const julySum = (finance.householdDoc.spendTotals ?? [])
      .filter((t) => t.id.startsWith('a:month:2025-07:'))
      .reduce((s, t) => s + t.amount, 0)
    expect(julySum).toBe(spentIn(store.all, '2025-07'))
    expect(julySum).toBe(spentIn(kaspi().operations, '2025-07') + 7_000)
  })

  it('без сети: итоги сразу, операции — в очереди (и на диске); сеть вернулась — досылаются', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const down = fakeServer()
    vi.mocked(down.calls.upsertOperations).mockRejectedValue(new TypeError('Failed to fetch'))
    store.setDraft(draftOf(kaspi()))
    await store.send(down.client)

    expect(store.status).toBe('offline')
    expect(store.pendingCount).toBe(60)
    expect(JSON.parse(storage.get('ff_operations_pending')!)[0].ops).toHaveLength(60)
    expect((finance.householdDoc.spendTotals ?? []).length).toBeGreaterThan(0)

    const up = fakeServer()
    await store.flush(up.client)
    expect(store.pendingCount).toBe(0)
    expect(up.server.ops.size).toBe(60)
    // Запись загрузки создана первым сервером — второй раз не создаётся.
    expect(up.calls.createStatementUpload).not.toHaveBeenCalled()
    expect([...up.server.ops.values()].every((o) => o.upload_id === down.server.uploads[0].id)).toBe(true)
  })

  it('смена раздела задним числом: правило, пересчёт операций и итогов, досыл изменённых', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client, server } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    const unknownJuly = () => finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2025-07:_unknown')
    const asanova = store.all.filter((o) => o.merchant === 'IP ASANOVA')
    expect(asanova.every((o) => o.categoryId === null)).toBe(true)
    const unknownBefore = unknownJuly()!.amount

    server.batches.length = 0
    await store.recategorize({ merchant: 'asanova' }, { categoryId: 'sc_home' }, client)
    expect(store.all.filter((o) => o.merchant === 'IP ASANOVA').every((o) => o.categoryId === 'sc_home')).toBe(true)
    expect(unknownJuly()!.amount).toBe(unknownBefore - 17_684)
    expect(finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2025-07:sc_home')?.amount).toBe(17_684)
    expect(server.batches).toEqual([1])
    expect(finance.merchantRules.map((r) => r.match)).toEqual([{ merchant: 'asanova' }])
  })

  it('раздел, из которого ушли все траты периода, обнуляется, а не удаляется', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    await store.recategorize({ merchant: 'steam' }, { categoryId: 'sc_other' }, client)
    const fun = finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2025-07:sc_fun')
    expect(fun).toMatchObject({ amount: 0, ops: 0 })
    expect(fun?.deletedAt).toBeFalsy()
  })
})

describe('stores/operations — курсор, семья, демо', () => {
  it('pull идёт по курсору страницами и помнит курсор', async () => {
    signIn()
    const store = useOperationsStore()
    const { client, calls } = fakeServer()
    const wire = (i: number): OperationWire => ({
      id: (0x1000000 + i).toString(16), bank: 'kaspi', date: '2026-09-01', amount: -1, kind: 'purchase',
      merchant: 'Magnum', category_id: 'sc_food', internal: false,
    })
    vi.mocked(calls.listOperations)
      .mockResolvedValueOnce({ operations: Array.from({ length: PULL_LIMIT }, (_, i) => wire(i)), next: 'T1' })
      .mockResolvedValueOnce({ operations: [wire(PULL_LIMIT)], next: 'T2' })
      .mockResolvedValueOnce({ operations: [], next: null })
    await store.pull(client)
    expect(vi.mocked(calls.listOperations).mock.calls.map((c) => c[0])).toEqual([null, 'T1'])
    expect(store.all).toHaveLength(PULL_LIMIT + 1)
    expect(store.cursor).toBe('T2')
    await store.pull(client)
    expect(vi.mocked(calls.listOperations).mock.calls[2][0]).toBe('T2')
    expect(store.cursor).toBe('T2')
  })

  it('вход в другую семью и выход стирают операции, курсор и очередь', async () => {
    signIn()
    const store = useOperationsStore()
    const { client } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    expect(store.all).toHaveLength(60)
    expect(storage.has('ff_operations')).toBe(true)

    useFinanceStore().claimFor('h2')
    await nextTick()
    expect(store.all).toHaveLength(0)
    expect(store.pending).toEqual([])
    expect(storage.has('ff_operations')).toBe(false)
  })

  it('другой вход в той же семье не видит копию на диске; выход стирает ключи операций', async () => {
    signIn('a')
    const store = useOperationsStore()
    const { client } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    expect(storage.has('ff_operations')).toBe(true)

    // Партнёр входит на этом же телефоне, стор операций в сессии ещё не создан.
    setActivePinia(createPinia())
    signIn('b')
    expect(useOperationsStore().all).toHaveLength(0)

    useFinanceStore().clearLocal()
    for (const k of ['ff_operations', 'ff_operations_cursor', 'ff_operations_pending']) expect(storage.has(k)).toBe(false)
  })

  it('копия чужой семьи на диске при старте не подхватывается', () => {
    storage.set('ff_operations', JSON.stringify({ owner: 'h-old:u-a', ops: { abc12345: { id: 'abc12345' } } }))
    signIn()
    expect(useOperationsStore().all).toHaveLength(0)
  })

  it('viewer не тянет операции; демо разбирает и считает локально, без запросов', async () => {
    signIn('b', 'viewer')
    const viewer = fakeServer()
    await useOperationsStore().pull(viewer.client)
    expect(viewer.calls.listOperations).not.toHaveBeenCalled()

    setActivePinia(createPinia())
    storage.clear()
    useAuthStore().setAuthData({
      token: DEMO_TOKEN, user: { id: 'demo', email: 'demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Я', role: 'member', joined_at: '' },
    })
    const store = useOperationsStore()
    const demo = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(demo.client)
    for (const m of Object.values(demo.calls)) expect(m).not.toHaveBeenCalled()
    expect(store.uploads.map((u) => [u.bank, u.ops_count])).toEqual([['kaspi', 60]])
    expect(useFinanceStore().householdDoc.spendTotals?.length).toBeGreaterThan(0)
  })
})
