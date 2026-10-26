import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { planFamilyDoc } from '../src/test/planFamily'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 5 «Figma» (FG-27): тот же человек A на двух телефонах (A1, A2 — слот 'a', один пользователь), партнёр B;
 * карта «Kaspi Gold» — счёт для трат только A. Сценарии сверх e2e исполнителя и критика (`fg-block5-two-phones`):
 * (1) A2 после удачных `pull` получает ошибку сервера операций — запись `card:a` не по его старой копии, сеть вернулась —
 * то же число; (2) свежий вход A с пустой копией при ошибке сервера — не пишет, после восстановления — то же число;
 * (3) «цена» отклонения 4: своё действие через > 5 с после `pull` ждёт один запрос операций; (4) хвост FG-Х9 — окно
 * `PULL_FRESH_MS` после `pull` второго своего телефона (закрепляет нынешнее поведение до решения владельца).
 * Наблюдатель счёта тянет общим `apiClient` — он подменён ручками операций телефона, чей pinia активен (A1 и A2 — один
 * пользователь A, B — свои операции); отказ сервера — тоже по телефону.
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
/** Взнос B с карты A в «Подушку» — как лист цели: взнос и сдвиг остатка с записью `goal-in`. */
function depositFromCardA(b: Phone, amount: number) {
  setActivePinia(b.pinia)
  b.store.contribute('cushion', amount, 'b')
  b.store.shiftAccountAmount('card', -amount, { kind: 'goal-in', goalId: 'cushion' })
}

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
async function rounds(phones: Phone[], n: number, minute: number, want: number) {
  for (let r = 0; r < n; r++) {
    at(`2026-10-15T${String(8 + Math.floor((minute + r) / 60)).padStart(2, '0')}:${String((minute + r) % 60).padStart(2, '0')}:00Z`)
    for (const p of phones) await docRound(p)
    expect(spentOnServer(server)).toBe(want)
  }
}

describe('e2e / приёмка Блока 5 «Figma» — второй свой телефон (FG-27)', () => {
  it('(1) A2 после удачных pull получает ошибку сервера операций — card:a не по его старой копии; сеть вернулась — то же число', async () => {
    const { a1, a2, b } = await family()
    down.add(a2.pinia)
    // A1 грузит перевод в цель (пока трата) и покупку; A2 о них не знает и тянуть не может.
    at('2026-10-15T07:30:00Z')
    await statement(a1, [row('2026-10-15', -50_000, 'Перевод', { kind: 'transfer-out' }), row('2026-10-15', -2_500, 'Bakery')])
    expect(spentOnServer(server)).toBe(315_000)
    // B вносит 50 000 с карты A — перевод из выписки A1 становится парой взноса.
    at('2026-10-15T08:00:00Z')
    depositFromCardA(b, 50_000)
    await sync(b)

    at('2026-10-15T08:01:00Z')
    await docRound(a2) // без гарда `pullFailed`: A2 пишет 250 000 по старой копии
    expect(mine(a2)).toBe(315_000)
    expect(spentOnServer(server)).toBe(315_000)
    await docRound(a1) // свежая копия — пара: 315 000 − 50 000
    expect(spentOnServer(server)).toBe(265_000)
    await rounds([a2, a1, b], 3, 2, 265_000)
    await sameEverywhere([a1, a2], b, 1_685_000)

    // Сеть вернулась: удачный pull A2 пишет отложенную запись по свежей копии — то же число.
    down.delete(a2.pinia)
    at('2026-10-15T08:10:00Z')
    await sync(a2)
    expect(mine(a2)).toBe(265_000)
    expect(spentOnServer(server)).toBe(265_000)
    await rounds([a2, a1, b], 2, 11, 265_000)
    await sameEverywhere([a1, a2], b, 1_685_000)
  })

  it('(2) свежий вход A (пустая копия) при ошибке сервера операций — не пишет; после восстановления — то же число', async () => {
    const { a1, b } = await family()
    // Новое устройство A: хранилище пустое, сервер операций не отвечает с первого запроса.
    storage.clear()
    const a3 = await phone(server, st, 'a', { broken: true })
    at('2026-10-15T08:00:00Z')
    depositFromCardA(b, 30_000)
    await sync(b)
    at('2026-10-15T08:01:00Z')
    await docRound(a3)
    expect(spentOnServer(server)).toBe(262_500) // не ноль и не «старьё»
    await rounds([a3, a1, b], 3, 2, 262_500)
    await sameEverywhere([a1, a3], b, 1_707_500)

    down.delete(a3.pinia)
    at('2026-10-15T08:10:00Z')
    await sync(a3)
    expect(useOperationsStore().all.length).toBe(2)
    expect(spentOnServer(server)).toBe(262_500)
    await rounds([a3, a1, b], 2, 11, 262_500)
    await sameEverywhere([a1, a3], b, 1_707_500)
  })

  it('(3) «цена» отклонения 4: своё действие через > 5 с после pull ждёт один запрос операций, остальное — сразу', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T07:30:00Z')
    await statement(a1, [row('2026-10-15', -40_000, 'Перевод', { kind: 'transfer-out' })])
    expect(spentOnServer(server)).toBe(302_500)
    await docRound(a2)
    await docRound(b)

    // Через полчаса (последний pull давно) A1 вносит 40 000 с карты в «Подушку»; ответ сервера операций придержан.
    at('2026-10-15T08:00:00Z')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const ops = vi.mocked(apiClient.listOperations)
    ops.mockClear()
    const a1ops = handles.get(a1.pinia)!
    ops.mockImplementationOnce((async (...args: []) => {
      await gate
      return a1ops.listOperations(...args)
    }) as never)
    setActivePinia(a1.pinia)
    a1.store.contribute('cushion', 40_000, 'a')
    a1.store.shiftAccountAmount('card', -40_000, { kind: 'goal-in', goalId: 'cushion' })
    await settle()
    // Взнос и сдвиг — сразу; запись потраченного ждёт ответа: до него строка пары считается дважды (1 657 500).
    expect(a1.store.goals.find((g) => g.id === 'cushion')!.have).toBe(440_000)
    expect(ops).toHaveBeenCalledTimes(1)
    expect(mine(a1)).toBe(302_500)
    expect(card(a1)).toBe(1_657_500)

    release()
    await settle()
    expect(ops).toHaveBeenCalledTimes(1)
    expect(mine(a1)).toBe(262_500)
    expect(card(a1)).toBe(1_697_500)
    await sync(a1)
    expect(spentOnServer(server)).toBe(262_500)
    await rounds([a2, a1, b], 3, 1, 262_500)
    await sameEverywhere([a1, a2], b, 1_697_500)
  })

  it('(4) хвост FG-Х9 (нынешнее поведение до решения владельца): в окне PULL_FRESH_MS после pull A2 его копия «свежая» — выписка A1 из этого окна теряется', async () => {
    const { a1, a2, b } = await family()
    // A2 тянет свои операции (открыл «Неделю») — копия свежая на 08:00:00.
    at('2026-10-15T08:00:00Z')
    setActivePinia(a2.pinia)
    await useOperationsStore().pull(a2.client)
    // Через секунду A1 грузит выписку, ещё через секунду B отмечает «Оплатил» — сигнал документа.
    at('2026-10-15T08:00:01Z')
    await statement(a1, [row('2026-10-15', -7_500, 'Kiosk')])
    expect(spentOnServer(server)).toBe(270_000)
    at('2026-10-15T08:00:02Z')
    setActivePinia(b.pinia)
    b.store.markPaid('obligation', 'rent', 'b', { accountId: null })
    await sync(b)
    await docRound(a1) // A1 — свежий: то же число
    expect(spentOnServer(server)).toBe(270_000)
    // A2 через 3 с после своего pull: pullFresh не шлёт запрос — запись по копии без −7 500.
    at('2026-10-15T08:00:03Z')
    const ops = vi.mocked(apiClient.listOperations)
    ops.mockClear()
    await docRound(a2)
    expect(ops).not.toHaveBeenCalled()
    expect(spentOnServer(server)).toBe(262_500) // FG-Х9: откат; правка хвоста переворачивает ожидание на 270 000
    // Откат держится: сигналов больше нет — ни A1, ни A2 запись не пересчитывают.
    await rounds([a1, a2, b], 3, 1, 262_500)
    expect(card(a1)).toBe(1_737_500) // правда — 1 730 000
  })
})
