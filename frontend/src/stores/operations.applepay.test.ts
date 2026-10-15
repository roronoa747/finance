import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { PHONE_PULL_MS, fromWire, toWire, useOperationsStore } from './operations'
import { normalizeMerchant, unknownGroups } from '@/lib/statements/model'
import { phoneOpTenge } from '@/lib/finance'
import type { OperationsPage, OperationWire } from '@/types/api'

// Траты с телефона (Apple Pay, AP-04): `pull` раскладывает их — курс, раздел, итоги — и шлёт назад.

const storage = new Map<string, string>()

function signIn(slot: 'a' | 'b' = 'a') {
  useAuthStore().setAuthData({
    token: `t-${slot}`,
    user: { id: `u-${slot}`, email: `${slot}@b.kz`, created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: `u-${slot}`, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  useFinanceStore().claimFor('h1')
}

/** Сервер операций: лента отдаёт то, что положили в `feed` (как курсор — новое с прошлого раза). */
function fakeServer() {
  const server = { feed: [] as OperationWire[], sent: [] as OperationWire[], rates: {} as Record<string, Record<string, number>> }
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
    // Курса нет — сбой ответа (как без сети): книга не считает отрезок закрытым и спросит снова.
    fxRates: vi.fn(async (code: string) => {
      if (!server.rates[code]) throw new Error('offline')
      return { code, rates: server.rates[code], partial: false }
    }),
  }
  return { server, client: client as unknown as ApiClient, calls: client }
}

const tap = (id: string, merchant: string, amount: number, extra: Partial<OperationWire> = {}): OperationWire => ({
  id, bank: 'kaspi', date: '2026-10-14', amount, kind: 'purchase', merchant, category_id: null, internal: false,
  source: 'tap', occurred_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:01Z', ...extra,
})

const weekTotal = (categoryId: string) =>
  (useFinanceStore().householdDoc.spendTotals ?? []).find((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W42' && t.categoryId === categoryId)

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

describe('lib/finance — phoneOpTenge', () => {
  it('USD 6.22 по 480.5 → −2989; без курса — null; тенге без fx — не трогается', () => {
    const book = { USD: { '2026-10-14': 480.5 } }
    expect(phoneOpTenge({ date: '2026-10-14', fx: { currency: 'USD', amount: 622 } }, book)).toBe(-2989)
    // Выходной — курс последнего дня до него.
    expect(phoneOpTenge({ date: '2026-10-17', fx: { currency: 'USD', amount: 622 } }, book)).toBe(-2989)
    expect(phoneOpTenge({ date: '2026-10-14', fx: { currency: 'EUR', amount: 500 } }, book)).toBeNull()
    expect(phoneOpTenge({ date: '2026-10-13', fx: { currency: 'USD', amount: 622 } }, book)).toBeNull()
    expect(phoneOpTenge({ date: '2026-10-14' }, book)).toBeNull()
  })
})

describe('провод — новые поля', () => {
  it('fromWire читает source, момент и валюту; toWire их не шлёт (пишет сервер)', () => {
    const w = tap('a1', 'Apple Store', 0, { fx_currency: 'USD', fx_amount: 622 })
    const op = fromWire(w)
    expect(op).toMatchObject({ source: 'tap', at: '2026-10-14T09:00:00Z', fx: { currency: 'USD', amount: 622 }, amount: 0 })
    const back = toWire(op)
    expect(back).not.toHaveProperty('source')
    expect(back).not.toHaveProperty('fx_amount')
    expect(fromWire({ ...back, source: 'tap', occurred_at: op.at, fx_currency: 'USD', fx_amount: 622 })).toEqual(op)
    // Выписка — без новых полей.
    expect(fromWire({ ...w, source: 'statement', fx_currency: undefined, fx_amount: undefined, occurred_at: undefined })).not.toHaveProperty('source')
  })
})

describe('stores/operations — траты с телефона (pull)', () => {
  it('продавец с правилом — раздел из правила, операция уходит назад, итог недели вырос', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    finance.addMerchantRules([{ match: { merchant: normalizeMerchant('Coffee Boom') }, to: { categoryId: 'sc_cafe' } }], 'a')
    const { server, client } = fakeServer()
    server.feed = [tap('a1', 'Coffee Boom', -1500)]

    await store.pull(client)

    expect(store.ops.a1).toMatchObject({ categoryId: 'sc_cafe', source: 'tap', amount: -1500 })
    expect(server.sent.map((o) => [o.id, o.category_id])).toEqual([['a1', 'sc_cafe']])
    expect(weekTotal('sc_cafe')).toMatchObject({ amount: 1500, ops: 1 })
  })

  it('незнакомый продавец — без раздела, в вопросах «куда отнести?»; итог «Без раздела»', async () => {
    signIn()
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [tap('a2', 'ZZ Unknown Shop', -700)]

    await store.pull(client)

    expect(store.ops.a2.categoryId).toBeNull()
    expect(unknownGroups(store.all).map((g) => g.label)).toEqual(['ZZ Unknown Shop'])
    expect(weekTotal('_unknown')).toMatchObject({ amount: 700, ops: 1 })
    // Раздел не изменился — назад нечего слать.
    expect(server.sent).toEqual([])
  })

  it('надгробие — операции нет, итог периода обнулён', async () => {
    signIn()
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [tap('a3', 'Magnum', -5000)]
    await store.pull(client)
    expect(weekTotal('sc_food')).toMatchObject({ amount: 5000 })

    server.feed = [{ ...tap('a3', 'Magnum', -5000, { category_id: 'sc_food' }), deleted: true }]
    await store.pull(client)

    expect(store.ops.a3).toBeUndefined()
    expect(weekTotal('sc_food')).toMatchObject({ amount: 0, ops: 0 })
  })

  it('валюта без курса — amount 0, в итогах нет; курс пришёл — пересчитана при следующем pull и отправлена', async () => {
    signIn()
    const store = useOperationsStore()
    const { server, client, calls } = fakeServer()
    server.feed = [tap('a4', 'Apple Store', 0, { bank: 'card', fx_currency: 'USD', fx_amount: 622 })]

    await store.pull(client)
    expect(store.ops.a4.amount).toBe(0)
    expect(calls.fxRates).toHaveBeenCalledWith('USD', '2026-10-07', '2026-10-14')
    expect((useFinanceStore().householdDoc.spendTotals ?? []).filter((t) => t.amount > 0)).toEqual([])
    expect(server.sent).toEqual([])

    // Курс появился на сервере — следующий pull догружает книгу и пересчитывает.
    server.rates.USD = { '2026-10-14': 480.5 }
    await store.pull(client)

    expect(store.ops.a4.amount).toBe(-2989)
    expect(server.sent.map((o) => [o.id, o.amount])).toEqual([['a4', -2989]])
  })

  it('строки выписки из pull — без изменений и не уходят назад (регрессия)', async () => {
    signIn()
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [{ ...tap('s1', 'ZZ Shop', -100), source: 'statement', occurred_at: undefined }]

    await store.pull(client)

    expect(store.ops.s1).toMatchObject({ categoryId: null })
    expect(store.ops.s1.source).toBeUndefined()
    expect(server.sent).toEqual([])
    expect(useFinanceStore().householdDoc.spendTotals ?? []).toEqual([])
  })

  it('возврат в приложение — pull не чаще раза в 30 с, у demo/viewer — никогда', async () => {
    signIn()
    const store = useOperationsStore()
    const { client, calls } = fakeServer()
    store.pullOnReturn(client)
    await vi.advanceTimersByTimeAsync(0)
    store.pullOnReturn(client)
    await vi.advanceTimersByTimeAsync(PHONE_PULL_MS - 1000)
    store.pullOnReturn(client)
    expect(calls.listOperations).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1001)
    store.pullOnReturn(client)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.listOperations).toHaveBeenCalledTimes(2)
  })
})
