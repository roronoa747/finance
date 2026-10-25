import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds, handOperation } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { planFamilyDoc } from '../src/test/planFamily'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, serverPush, serverTap, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 3 «Фидбек-2» (F2-06..08), сценарии сверх исполнителя: одна покупка из трёх источников (Apple Pay, пуш
 * банка, выписка) — один раз; приход плюсом, перевод себе со счёта — минусом; хозяин «Я» — траты партнёра больше не тают
 * карту, у партнёра нет строки «На карте»; «Траты отсюда» выключены — остаток = база. Четверг 15 октября 2026; карта
 * «Kaspi Gold» 2 000 000, сверка 1 сентября.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
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
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const hand = (id: string, amount: number) => handOperation({ id, amount, categoryId: 'sc_food', date: '2026-10-15', note: '' }, 'Продукты')

describe('e2e / приёмка Фидбек-2 Блок 3 — баланс для трат', () => {
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

  it('одна покупка — Apple Pay, пуш и выписка — один раз; приход плюсом, перевод себе со счёта минусом; партнёр видит то же', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')

    serverTap(st, 'u-a', { id: 'aa00000000000011', date: '2026-10-15', amount: -5_000, merchant: 'Magnum' })
    expect(serverPush(st, 'u-a', { id: 'aa00000000000012', date: '2026-10-15', amount: -5_000, merchant: 'MAGNUM', kind: 'purchase', bank: 'kaspi' })).toBe('duplicate')
    await sync(a)
    expect(card(a)).toBe(1_995_000)

    const rows: Omit<Operation, 'id'>[] = [
      { bank: 'kaspi', date: '2026-10-15', amount: -5_000, kind: 'purchase', merchant: 'MAGNUM ALMATY KZ', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-10-14', amount: -2_000, kind: 'purchase', merchant: 'Small', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-10-14', amount: 10_000, kind: 'transfer-in', merchant: 'Возврат долга', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-10-14', amount: -50_000, kind: 'transfer-out', merchant: 'На депозит', categoryId: null, internal: true },
      // До сверки — уже в сверенной сумме
      { bank: 'kaspi', date: '2026-09-01', amount: -9_999, kind: 'purchase', merchant: 'Old', categoryId: null, internal: false },
    ]
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-09-01', to: '2026-10-15', skipped: 0, operations: assignIds(rows) }
    ops(a).setDraft([{ name: 'kaspi.pdf', parsed }])
    await ops(a).send(a.client)
    await sync(a)
    // 5 000 + 2 000 − 10 000 + 50 000 = 47 000
    expect(card(a)).toBe(1_953_000)
    await sync(b)
    expect(card(b)).toBe(1_953_000)
    expect(server.data.accountSpent).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'card:a', amount: 47_000 })]))
  })

  it('хозяин «Я» — траты партнёра не тают карту и у него нет «На карте»; выключено — остаток = база, строки нет', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    const line = async (p: Phone) => text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d ]+)/)?.[1]?.trim() ?? null

    await ops(a).saveHand(hand('aa000000000000b1', 1_000), {}, a.client)
    await ops(b).saveHand(hand('bb000000000000b1', 4_000), {}, b.client)
    await sync(a)
    await sync(b)
    await sync(a)
    expect(card(a)).toBe(1_995_000)

    setActivePinia(a.pinia)
    a.store.setSpendAccount('card', 'a')
    expect(card(a)).toBe(1_999_000)
    await sync(a)
    await sync(b)
    expect(card(b)).toBe(1_999_000)
    expect(await line(b)).toBeNull()
    // Перестал быть хозяином — своя запись обнулена (не надгробие), на сервер — следующим синком
    expect(b.store.householdDoc.accountSpent?.find((s) => s.id === 'card:b')).toMatchObject({ amount: 0, deletedAt: null })
    await sync(b)
    expect(server.data.accountSpent).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'card:b', amount: 0 })]))
    // Новая трата партнёра тоже не тает
    await ops(b).saveHand(hand('bb000000000000b2', 7_000), {}, b.client)
    await sync(b)
    await sync(a)
    expect(card(a)).toBe(1_999_000)
    expect(card(b)).toBe(1_999_000)

    at('2026-10-15T08:00:00Z')
    setActivePinia(a.pinia)
    a.store.setSpendAccount('card', null)
    expect(card(a)).toBe(2_000_000)
    expect(await line(a)).toBeNull()
    await sync(a)
    await sync(b)
    expect(card(b)).toBe(2_000_000)
  })

  // Возврат приёмки (2026-10-25): ручная трата, внесённая до сверки того же дня, списывалась второй раз — починено
  // моментом внесения (`at` у ручной траты, `saveHand`).
  it('сверка в день ручной траты: остаток = введённой сумме; трата после сверки того же дня тает', async () => {
    const a = await phone(server, st, 'a')
    await ops(a).saveHand(hand('aa000000000000c1', 3_000), {}, a.client)
    await sync(a)
    expect(card(a)).toBe(1_997_000)

    at('2026-10-15T09:00:00Z')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 1_900_000)
    await sync(a)
    expect(card(a)).toBe(1_900_000)

    at('2026-10-15T10:00:00Z')
    await ops(a).saveHand(hand('aa000000000000c2', 1_000), {}, a.client)
    await sync(a)
    expect(card(a)).toBe(1_899_000)
  })
})
