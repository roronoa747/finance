import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore } from './auth'
import { defaultSyncDoc, useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import { handOperation } from '@/lib/statements/model'
import type { OperationsPage } from '@/types/api'
import type { Account } from '@/types/finance'

/**
 * F2-07 (Р-8): телефон хозяина счёта для трат пишет свою запись `<счёт>:<я>` — нетто своих операций после сверки;
 * тот же итог второй раз не пишется; перестал быть хозяином — `amount: 0`; сверка — запись от нового якоря; viewer — ничего.
 */
const storage = new Map<string, string>()
const T0 = '2026-10-01T00:00:00.000Z'
const ANCHOR = '2026-10-10T06:00:00.000Z'

const client = {
  createStatementUpload: vi.fn(),
  listStatementUploads: vi.fn(async () => ({ uploads: [] })),
  upsertOperations: vi.fn(async (ops: unknown[]) => ({ upserted: ops.length })),
  listOperations: vi.fn(async (): Promise<OperationsPage> => ({ operations: [], next: null })),
} as unknown as ApiClient

function signIn(role: 'member' | 'viewer' = 'member', accounts: Account[] = [card()]) {
  useAuthStore().setAuthData({
    token: 't-a',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role, joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.setHouseholdDoc({
    ...defaultSyncDoc(),
    people: [
      { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Аруна', salary: 0, payday: 20, updatedAt: T0 },
    ],
    accounts,
  }, 1)
  return finance
}
function card(p: Partial<Account> = {}): Account {
  return { id: 'k1', name: 'Kaspi Gold', note: '', amount: 245_000, amountSetAt: ANCHOR, kind: 'card', updatedAt: T0, ...p }
}
const hand = (id: string, amount: number) =>
  handOperation({ id, amount, categoryId: 'sc_food', date: '2026-10-20', note: '' }, 'Продукты')
const spent = () => useFinanceStore().householdDoc.accountSpent ?? []

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

describe('F2-07: запись «потрачено» счёта для трат', () => {
  it('хозяин: запись `k1:a` от якоря; баланс тает; та же сумма — без новой записи', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', accountId: 'k1', by: 'a', since: ANCHOR, amount: 2_500 })])
    expect(finance.accounts[0].amount).toBe(242_500)
    const at = spent()[0].updatedAt
    vi.setSystemTime(new Date('2026-10-20T07:05:00Z'))
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()[0].updatedAt).toBe(at)
  })

  it('сверка остатка → запись от нового якоря, баланс = введённой сумме; следующая трата снова тает', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
    finance.setAccountAmount('k1', 200_000)
    expect(finance.accounts[0].amount).toBe(200_000)
    await nextTick()
    // Ручная трата того же дня входит и после сверки (времени у неё нет — Handoff F2-07).
    expect(spent()[0]).toMatchObject({ since: '2026-10-20T08:00:00.000Z', amount: 2_500 })
    expect(finance.accounts[0].amount).toBe(197_500)
    await store.saveHand(hand('11aa11bb22cc33dd', 1_000), {}, client)
    expect(finance.accounts[0].amount).toBe(196_500)
  })

  it('перестал быть хозяином — своя запись обнуляется, не удаляется', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    finance.setSpendAccount('k1', 'b')
    await nextTick()
    expect(spent()[0]).toMatchObject({ id: 'k1:a', amount: 0 })
    expect(spent()[0].deletedAt).toBeFalsy()
  })

  it('viewer — ничего не пишет', async () => {
    signIn('viewer')
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()).toEqual([])
  })

  it('нет счёта для трат — записи нет', async () => {
    signIn('member', [card(), card({ id: 'k2' })])
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()).toEqual([])
  })
})
