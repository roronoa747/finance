import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { handOperation } from '../src/lib/statements/model'
import { planFamilyDoc } from '../src/test/planFamily'
import { at, backend, fakeServer, fakeStatements, serverTap, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 3 «Фидбек-2» (F2-07, F2-08): единственная карта семьи — счёт для трат «оба» сама; траты обоих телефонов (Apple Pay
 * Ильяса, ручная Аруны) тают её остаток у обоих; трата, отмеченная платежом, — один раз; сверка → баланс = введённой
 * сумме, следующая трата снова тает. Четверг 15 октября 2026; карта «Kaspi Gold» 2 000 000, сверка 1 сентября.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

/** Телефон подтягивает свои операции и синкает документ. */
async function sync(p: Phone) {
  setActivePinia(p.pinia)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}
const card = (p: Phone) => p.store.accounts.find((a) => a.id === 'card')!.amount
const ops = (p: Phone) => {
  setActivePinia(p.pinia)
  return useOperationsStore()
}
const hand = (id: string, amount: number) => handOperation({ id, amount, categoryId: 'sc_food', date: '2026-10-15', note: '' }, 'Продукты')

describe('e2e / Фидбек-2 Блок 3 — траты тают баланс карты', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-15T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('карта «оба»: траты на обоих телефонах → у каждого баланс = база − траты обоих; viewer видит то же', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    expect(card(a)).toBe(2_000_000)

    serverTap(st, 'u-a', { id: 'aa00000000000001', date: '2026-10-15', amount: -1_200, merchant: 'Magnum' })
    await sync(a)
    expect(card(a)).toBe(1_998_800)

    await ops(b).saveHand(hand('bb00000000000001', 3_000), {}, b.client)
    await sync(b)
    await sync(a)
    expect(card(a)).toBe(1_995_800)
    expect(card(b)).toBe(1_995_800)
    // Операции партнёра не видны — только итог
    expect(ops(b).all.map((o) => o.id)).toEqual(['bb00000000000001'])
    expect(server.data.accountSpent).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'card:a', amount: 1_200 }),
      expect.objectContaining({ id: 'card:b', amount: 3_000 }),
    ]))

    const v = await phone(server, st, 'a', 'viewer')
    expect(card(v)).toBe(1_995_800)
    expect(v.store.householdDoc.accountSpent?.some((s) => s.by === 'c')).toBe(false)
  })

  it('трата, отмеченная платежом, — один раз; сверка → баланс = введённой сумме, следующая трата снова тает', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    // Платёж по кредиту картой (15-е, 58 000): строка — вопрос «это платёж по …?», пока ждёт — не трата
    serverTap(st, 'u-a', { id: 'aa00000000000002', date: '2026-10-15', amount: -58_000, merchant: 'Kaspi Кредит' })
    await sync(a)
    const ask = ops(a).pendingMatches.find((c) => c.targetId === 'loan')
    expect(ask).toBeTruthy()
    expect(card(a)).toBe(2_000_000)
    // «Да» с карты — списание отметкой, строка не считается второй раз
    await ops(a).acceptMatch(ask!, a.client, 'card')
    await sync(a)
    expect(card(a)).toBe(1_942_000)

    // Сверка у партнёра: ввёл то, что в банке
    await sync(b)
    at('2026-10-15T09:00:00Z')
    b.store.setAccountAmount('card', 1_900_000)
    expect(card(b)).toBe(1_900_000)
    await sync(b)
    await sync(a)
    expect(card(a)).toBe(1_900_000)
    await sync(b)
    expect(card(b)).toBe(1_900_000)

    // Следующая трата снова тает — у обоих
    at('2026-10-15T10:00:00Z')
    serverTap(st, 'u-a', { id: 'aa00000000000003', date: '2026-10-15', amount: -4_500, merchant: 'Magnum' })
    await sync(a)
    await sync(b)
    expect(card(a)).toBe(1_895_500)
    expect(card(b)).toBe(1_895_500)
  })
})
