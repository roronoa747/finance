import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import { handOperation } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import type { OperationsPage, OperationWire } from '@/types/api'

/**
 * Бэклог «Ручная трата» (MAN-01, MAN-02; Р-2): ручная трата — в копию, итог раздела — в общий документ (партнёр видит
 * только его), на сервер — тем же батчем; правка переписывает итоги старой и новой даты; удаление — надгробием.
 * Строку выписки этими путями не поправить и не удалить.
 */
const storage = new Map<string, string>()

function fakeServer() {
  const server = { ops: new Map<string, OperationWire>(), sent: [] as OperationWire[] }
  const client = {
    createStatementUpload: vi.fn(),
    listStatementUploads: vi.fn(async () => ({ uploads: [] })),
    upsertOperations: vi.fn(async (ops: OperationWire[]) => {
      server.sent.push(...ops)
      for (const o of ops) server.ops.set(o.id, o)
      return { upserted: ops.length }
    }),
    listOperations: vi.fn(async (): Promise<OperationsPage> => ({ operations: [], next: null })),
  }
  return { server, client: client as unknown as ApiClient }
}

function signIn() {
  useAuthStore().setAuthData({
    token: 't-a',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  useFinanceStore().claimFor('h1')
}

const hand = (extra: Partial<Parameters<typeof handOperation>[0]> = {}) =>
  handOperation({ id: '00aa11bb22cc33dd', amount: 2_500, categoryId: 'sc_food', date: '2026-10-20', note: 'Магнум', ...extra }, 'Продукты')
const total = (id: string) => useFinanceStore().householdDoc.spendTotals?.find((t) => t.id === id)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
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

describe('ручная трата в сторе', () => {
  it('сохранить: копия, итоги недели и месяца, разделы засеяны, на сервер — банк hand без загрузки', async () => {
    signIn()
    const { server, client } = fakeServer()
    const store = useOperationsStore()
    expect(useFinanceStore().householdDoc.spendCategories ?? []).toHaveLength(0)
    await store.saveHand(hand(), {}, client)
    expect(store.ops['00aa11bb22cc33dd']).toMatchObject({ bank: 'hand', amount: -2_500, categoryId: 'sc_food' })
    expect(total('a:week:2026-W43:sc_food')).toMatchObject({ amount: 2_500, ops: 1 })
    expect(total('a:month:2026-10:sc_food')).toMatchObject({ amount: 2_500, ops: 1 })
    expect(useFinanceStore().householdDoc.spendCategories?.length).toBeGreaterThan(0)
    expect(server.ops.get('00aa11bb22cc33dd')).toMatchObject({ bank: 'hand', amount: -2_500, merchant: 'Магнум', note: 'Магнум', upload_id: null, category_id: 'sc_food' })
    expect(store.pending).toEqual([])
  })

  it('правка: сумма, раздел и дата — итоги старой недели обнулены, новой — записаны; на сервер — тот же id', async () => {
    signIn()
    const { server, client } = fakeServer()
    const store = useOperationsStore()
    await store.saveHand(hand(), {}, client)
    await store.saveHand(hand({ amount: 3_000, categoryId: 'sc_cafe', date: '2026-10-12' }), {}, client)
    expect(Object.keys(store.ops)).toEqual(['00aa11bb22cc33dd'])
    expect(total('a:week:2026-W43:sc_food')).toMatchObject({ amount: 0, ops: 0 })
    expect(total('a:week:2026-W42:sc_cafe')).toMatchObject({ amount: 3_000, ops: 1 })
    expect(total('a:month:2026-10:sc_food')).toMatchObject({ amount: 0, ops: 0 })
    expect(total('a:month:2026-10:sc_cafe')).toMatchObject({ amount: 3_000, ops: 1 })
    expect(server.ops.get('00aa11bb22cc33dd')).toMatchObject({ amount: -3_000, category_id: 'sc_cafe', date: '2026-10-12' })
  })

  it('удалить: из копии и итогов, на сервер — надгробие', async () => {
    signIn()
    const { server, client } = fakeServer()
    const store = useOperationsStore()
    await store.saveHand(hand(), {}, client)
    await store.removeHand('00aa11bb22cc33dd', client)
    expect(store.ops['00aa11bb22cc33dd']).toBeUndefined()
    expect(total('a:week:2026-W43:sc_food')).toMatchObject({ amount: 0, ops: 0 })
    expect(server.ops.get('00aa11bb22cc33dd')).toMatchObject({ deleted: true })
  })

  it('строку выписки так не поправить и не удалить; не-ручную операцию saveHand не пишет', async () => {
    signIn()
    const { server, client } = fakeServer()
    const store = useOperationsStore()
    const line: Operation = { id: '1111222233334444', bank: 'kaspi', date: '2026-10-20', amount: -5_000, kind: 'purchase', merchant: 'Magnum', categoryId: 'sc_food', internal: false }
    store.ops[line.id] = line
    await store.saveHand({ ...hand(), id: line.id }, {}, client)
    await store.removeHand(line.id, client)
    await store.saveHand(line, {}, client)
    expect(store.ops[line.id]).toEqual(line)
    expect(server.sent).toEqual([])
  })
})
