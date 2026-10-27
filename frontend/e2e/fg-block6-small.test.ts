import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds, handId, handOperation } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { planFamilyDoc } from '../src/test/planFamily'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 6 «Маленькая пачка» «Figma» (FG-28…FG-32) — общий e2e исполнителя. Семья и помощники — из приёмки Блока 5
 * (`fg-block5-accept`): тот же человек A на двух телефонах (A1, A2 — слот 'a', один пользователь), партнёр B; карта
 * «Kaspi Gold» — счёт для трат только A. Наблюдатели тянут операции общим `apiClient` — он подменён ручками телефона, чей
 * pinia активен.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

/** Телефоны, у которых сервер операций отвечает ошибкой; ручки операций каждого телефона — для общего `apiClient`. */
const down = new Set<Pinia>()
const handles = new Map<Pinia, ReturnType<typeof statementsFor>>()
const failing = async () => {
  throw new Error('503 Service Unavailable')
}

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', { broken = false } = {}): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (broken) down.add(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  const ops = statementsFor(st, user, slot)
  handles.set(pinia, ops)
  const client = { ...backend(server), ...ops, listOperations: (...args: []) => (down.has(pinia) ? failing() : ops.listOperations(...args)) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  await useOperationsStore().pull(client)
  return { pinia, client, store }
}

/** Круг движка для документа (операции тянет наблюдатель счёта по сигналу). */
async function docRound(p: Phone) {
  setActivePinia(p.pinia)
  await p.store.pullHousehold(p.client)
  await settle()
  await p.store.syncHousehold(p.client)
}
/** Полный круг: свои операции + документ. */
async function sync(p: Phone) {
  setActivePinia(p.pinia)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const card = (p: Phone) => p.store.accounts.find((a) => a.id === 'card')!.amount
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const onCard = async (p: Phone) => text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d ]+₸)/)?.[1] ?? null
const nbsp = (s: string) => s.replace(/\s/g, ' ')
const spentOnServer = (server: FakeServer) => (server.data.accountSpent ?? []).find((s) => s.id === 'card:a')?.amount
const mine = (p: Phone) => p.store.householdDoc.accountSpent?.find((s) => s.id === 'card:a')?.amount

let seq = 0
async function statement(p: Phone, rows: Omit<Operation, 'id'>[]) {
  setActivePinia(p.pinia)
  const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-10-01', to: rows.map((r) => r.date).sort().pop()!, skipped: 0, operations: assignIds(rows) }
  useOperationsStore().setDraft([{ name: `kaspi-${++seq}.pdf`, parsed }])
  await useOperationsStore().send(p.client)
  await sync(p)
}
const row = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false, ...extra,
})

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
  down.clear()
  handles.clear()
  vi.useFakeTimers()
  at('2026-10-15T07:00:00Z')
  server = fakeServer(planFamilyDoc())
  st = fakeStatements()
  seq = 0
  // Общий клиент — ручки операций телефона, чей pinia активен в момент запроса; отказ — у него же.
  const own = () => handles.get(getActivePinia()!)!
  vi.spyOn(apiClient, 'listOperations').mockImplementation(((...args: []) => (down.has(getActivePinia()!) ? failing() : own().listOperations(...args))) as never)
  vi.spyOn(apiClient, 'upsertOperations').mockImplementation(((...args: [never]) => own().upsertOperations(...args)) as never)
  vi.spyOn(apiClient, 'listStatementUploads').mockImplementation((() => own().listStatementUploads()) as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Семья: карта A сверена 12-го на 2 000 000; A1 загрузил −250 000 (A2 подтянул) и −12 500 (A2 не знает). */
async function family() {
  const a1 = await phone(server, st, 'a')
  const a2 = await phone(server, st, 'a')
  const b = await phone(server, st, 'b')
  setActivePinia(a1.pinia)
  a1.store.setSpendAccount('card', 'a')
  at('2026-10-12T07:00:00Z')
  a1.store.setAccountAmount('card', 2_000_000)
  await sync(a1)
  await sync(b)
  at('2026-10-14T19:00:00Z')
  await statement(a1, [row('2026-10-14', -250_000, 'Technodom')])
  await sync(a2)
  at('2026-10-15T07:00:00Z')
  await statement(a1, [row('2026-10-15', -12_500, 'Magnum')])
  expect(spentOnServer(server)).toBe(262_500)
  return { a1, a2, b }
}

/** Остаток карты у всех; «На карте» «Недели» — у телефонов A (у B карта не счёт для трат — строки нет). */
async function sameEverywhere(phonesA: Phone[], b: Phone, amount: number) {
  for (const p of [...phonesA, b]) expect(card(p)).toBe(amount)
  for (const p of phonesA) expect(nbsp(String(await onCard(p)))).toBe(nbsp(money(amount)))
  expect(await onCard(b)).toBeNull()
}

/** Итоги недели A на сервере (документ семьи моков): раздел → сумма; ноль — тоже запись. */
const weekOnServer = (server: FakeServer) =>
  Object.fromEntries((server.data.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === WEEK).map((t) => [t.categoryId, t.amount]))
const weekMine = (p: Phone) =>
  Object.fromEntries((p.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === WEEK).map((t) => [t.categoryId, t.amount]))
const WEEK = '2026-W42'
/** Круг движка участника: документ + `pullFresh` (FG-27). */
async function engineRound(p: Phone) {
  setActivePinia(p.pinia)
  await p.store.pullHousehold(p.client)
  await useOperationsStore().pullFresh(p.client)
  await settle()
  await p.store.syncHousehold(p.client)
}
async function hand(p: Phone, amount: number) {
  setActivePinia(p.pinia)
  const op = handOperation({ id: handId(), amount, categoryId: 'sc_food', date: '2026-10-15', note: '' }, 'Продукты')
  await useOperationsStore().saveHand(op, {}, p.client)
}

describe('e2e / Блок 6 «Маленькая пачка» — FG-28: итоги разделов второго своего телефона', () => {
  it('(1) проба критика: выписка A1 → «Оплатил» B → документ на A2 раньше его pull — «Еда» недели A на сервере 12 500 все 3 круга', async () => {
    const { a1, a2, b } = await family()
    const before = weekOnServer(server)
    expect(before.sc_food).toBe(12_500)
    at('2026-10-15T08:00:00Z')
    setActivePinia(b.pinia)
    b.store.markPaid('obligation', 'rent', 'b', { accountId: null })
    await sync(b)
    // Круг A2 на медленной сети: ответ операций придержан, документ уходит раньше — итоги по старой копии не пишутся.
    at('2026-10-15T08:00:30Z')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const a2ops = handles.get(a2.pinia)!
    vi.mocked(apiClient.listOperations).mockImplementationOnce((async (...args: []) => {
      await gate
      return a2ops.listOperations(...args)
    }) as never)
    await docRound(a2)
    expect(weekOnServer(server)).toEqual(before)
    expect(weekMine(a2)).toEqual(before)
    release()
    await settle()
    await sync(a2)
    expect(weekOnServer(server)).toEqual(before)
    for (let r = 0; r < 3; r++) {
      at(`2026-10-15T08:0${r + 1}:00Z`)
      for (const p of [a2, a1, b]) {
        await docRound(p)
        expect(weekOnServer(server)).toEqual(before)
        expect(spentOnServer(server)).toBe(262_500)
      }
    }
    expect(weekMine(a2)).toEqual(before)
  })

  it('(2) самодогон: ручная трата A2 со старой копией — итоги по копии A2; его круг приносит выписку A1 — 16 000; у A1 после круга — то же', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    await hand(a2, 3_500)
    // Прямой путь — по копии A2 (выписки −12 500 в ней нет).
    expect(weekMine(a2).sc_food).toBe(3_500)
    await sync(b)
    at('2026-10-15T08:01:00Z')
    await engineRound(a2)
    expect(weekMine(a2).sc_food).toBe(16_000)
    expect(mine(a2)).toBe(266_000)
    expect(weekOnServer(server).sc_food).toBe(16_000)
    at('2026-10-15T08:02:00Z')
    await engineRound(a1)
    expect(weekMine(a1).sc_food).toBe(16_000)
    expect(mine(a1)).toBe(266_000)
    for (let r = 0; r < 3; r++) {
      at(`2026-10-15T08:1${r}:00Z`)
      for (const p of [a1, a2, b]) await engineRound(p)
      expect(weekOnServer(server).sc_food).toBe(16_000)
      expect(spentOnServer(server)).toBe(266_000)
    }
    await sameEverywhere([a1, a2], b, 1_734_000)
  })

  it('(3) регресс: ручная трата на свежем телефоне — итоги и «На карте» сразу, без запроса операций', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    const ops = vi.mocked(apiClient.listOperations)
    ops.mockClear()
    await hand(a1, 1_500)
    expect(ops).not.toHaveBeenCalled()
    expect(weekMine(a1).sc_food).toBe(14_000)
    expect(mine(a1)).toBe(264_000)
    expect(card(a1)).toBe(1_736_000)
    await sync(a1)
    expect(weekOnServer(server).sc_food).toBe(14_000)
    at('2026-10-15T08:01:00Z')
    for (const p of [a2, b]) await engineRound(p)
    await sameEverywhere([a1, a2], b, 1_736_000)
  })
})
