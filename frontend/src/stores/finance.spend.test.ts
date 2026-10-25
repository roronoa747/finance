// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defaultSyncDoc, useFinanceStore } from './finance'
import { spendAccountOf } from '@/lib/finance'
import type { Account, Person, SyncDoc } from '@/types/finance'

/** F2-06: `setSpendAccount` — отметка «Траты отсюда», перенос хозяина с прежнего счёта одной правкой. */

const T0 = '2026-10-01T00:00:00.000Z'
const acc = (id: string, p: Partial<Account> = {}): Account => ({ id, name: id, note: '', amount: 100_000, amountSetAt: T0, kind: 'card', updatedAt: T0, ...p })
const two: Person[] = [
  { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
  { id: 'b', name: 'Аруна', salary: 0, payday: 20, updatedAt: T0 },
]

function storeWith(accounts: Account[], people: Person[] = two) {
  const store = useFinanceStore()
  store.setHouseholdDoc({ ...defaultSyncDoc(), people, accounts } as SyncDoc, 1)
  return store
}
const raw = (store: ReturnType<typeof useFinanceStore>, id: string) => store.householdDoc.accounts!.find((a) => a.id === id)!

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('F2-06: setSpendAccount', () => {
  it('перенос «своего» счёта: старый — null, новый — я; якорь сверки не тронут', () => {
    const store = storeWith([acc('k1', { spendBy: 'a' }), acc('cash', { kind: 'cash' })])
    store.setSpendAccount('cash', 'a')
    expect(raw(store, 'cash').spendBy).toBe('a')
    expect(raw(store, 'k1').spendBy).toBeNull()
    expect(raw(store, 'cash').amountSetAt).toBe(T0)
    expect(spendAccountOf(store.householdDoc.accounts!, 'a')?.id).toBe('cash')
  })

  it('«оба» на старом → у старого остаётся партнёр', () => {
    const store = storeWith([acc('k1', { spendBy: 'both' }), acc('k2')])
    store.setSpendAccount('k2', 'a')
    expect(raw(store, 'k1').spendBy).toBe('b')
    expect(spendAccountOf(store.householdDoc.accounts!, 'b')?.id).toBe('k1')
    expect(spendAccountOf(store.householdDoc.accounts!, 'a')?.id).toBe('k2')
  })

  it('единственная карта «сама» → партнёр остаётся на ней явной отметкой', () => {
    const store = storeWith([acc('k1'), acc('cash', { kind: 'cash' })])
    store.setSpendAccount('cash', 'a')
    expect(raw(store, 'k1').spendBy).toBe('b')
    expect(spendAccountOf(store.householdDoc.accounts!, 'b')?.id).toBe('k1')
  })

  it('семья из одного: «оба» на наличных снимает единственную карту', () => {
    const store = storeWith([acc('k1'), acc('cash', { kind: 'cash' })], [two[0]])
    store.setSpendAccount('cash', 'both')
    expect(raw(store, 'k1').spendBy).toBeNull()
    expect(spendAccountOf(store.householdDoc.accounts!, 'a')?.id).toBe('cash')
  })

  it('снять отметку с единственной карты — явный null', () => {
    const store = storeWith([acc('k1')])
    store.setSpendAccount('k1', null)
    expect(raw(store, 'k1').spendBy).toBeNull()
    expect(spendAccountOf(store.householdDoc.accounts!, 'a')).toBeNull()
  })

  it('одна правка документа на перенос; та же отметка — без записи', () => {
    const store = storeWith([acc('k1', { spendBy: 'both' }), acc('k2')])
    const set = vi.spyOn(localStorage, 'setItem')
    store.setSpendAccount('k2', 'both')
    const once = set.mock.calls.length
    expect(once).toBeGreaterThan(0)
    store.updateAccount('k2', { note: 'x' })
    expect(set.mock.calls.length - once).toBe(once) // перенос стоил столько же, сколько одна правка
    set.mockClear()
    store.setSpendAccount('k2', 'both')
    expect(set).not.toHaveBeenCalled()
    expect(raw(store, 'k1').spendBy).toBeNull()
  })
})
