import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { planFamilyDoc } from '../src/test/planFamily'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, setOnline, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 5 «Figma» (FG-27, FG-Х7): тот же человек A на двух телефонах (A1, A2 — один слот 'a', один пользователь), партнёр B;
 * карта «Kaspi Gold» — счёт для трат только A. A1 грузит выписку, копия операций A2 остаётся старой; документ с взносом,
 * досрочкой или «Оплатил» B приходит на A2 фоном — запись потраченного `card:a` считается по свежей копии (A2 перед записью
 * тянет свои операции) и не откатывается; без удачного `pull` в запуске — A2 не пишет. Наблюдатель счёта зовёт `pull` общим
 * `apiClient` — он подменён ручками операций A (оба телефона A — один пользователь).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

let down = false
const failing = async () => {
  throw new Error('нет связи')
}

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  const ops = statementsFor(st, user, slot)
  const client = { ...backend(server), ...ops, listOperations: (...args: []) => (down ? failing() : ops.listOperations(...args)) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  await useOperationsStore().pull(client)
  return { pinia, client, store }
}

/** Круг движка для документа: только документ (операции этот хелпер не тянет — их тянет наблюдатель счёта). */
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
/** Наблюдатель счёта для трат пишет после `pull` — дождаться его микрозадач и запроса. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const card = (p: Phone) => p.store.accounts.find((a) => a.id === 'card')!.amount
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const onCard = async (p: Phone) => text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d ]+₸)/)?.[1] ?? null
const nbsp = (s: string) => s.replace(/\s/g, ' ')
const spentOnServer = (server: FakeServer) => (server.data.accountSpent ?? []).find((s) => s.id === 'card:a')?.amount

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
  vi.useFakeTimers()
  at('2026-10-15T07:00:00Z')
  server = fakeServer(planFamilyDoc())
  st = fakeStatements()
  seq = 0
  down = false
  // Общий клиент — ручки операций A (наблюдатель счёта для трат обоих телефонов A).
  const ua = statementsFor(st, 'u-a', 'a')
  vi.spyOn(apiClient, 'listOperations').mockImplementation((() => (down ? failing() : ua.listOperations())) as never)
  vi.spyOn(apiClient, 'upsertOperations').mockImplementation(ua.upsertOperations as never)
  vi.spyOn(apiClient, 'listStatementUploads').mockImplementation(ua.listStatementUploads as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Семья: карта A сверена 12-го на 2 000 000 (счёт для трат только A); A2 и B открыты раньше выписок A1, A2 видел только первую. */
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
  // Вчера A1 загрузил −250 000, A2 его подтянул (копия не пустая); сегодня A1 грузит −12 500 — A2 об этом не знает.
  at('2026-10-14T19:00:00Z')
  await statement(a1, [row('2026-10-14', -250_000, 'Technodom')])
  await sync(a2)
  expect(card(a2)).toBe(1_750_000)
  at('2026-10-15T07:00:00Z')
  await statement(a1, [row('2026-10-15', -12_500, 'Magnum')])
  expect(card(a1)).toBe(1_737_500)
  expect(spentOnServer(server)).toBe(262_500)
  return { a1, a2, b }
}

/** Остаток карты у всех; «На карте» «Недели» — у телефонов A (у B карта не счёт для трат — строки нет). */
async function sameEverywhere([a1, a2, b]: Phone[], amount: number) {
  for (const p of [a1, a2, b]) expect(card(p)).toBe(amount)
  for (const p of [a1, a2]) expect(nbsp(String(await onCard(p)))).toBe(nbsp(money(amount)))
  expect(await onCard(b)).toBeNull()
}

describe('e2e / Блок 5 «Figma» — второй свой телефон с несвежими операциями (FG-27)', () => {
  it('(1) взнос B с карты A приходит на A2 фоном — запись card:a не откатывается; у A1, A2 и B одно число', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    setActivePinia(b.pinia)
    b.store.shiftAccountAmount('card', -100_000, { kind: 'goal-in', goalId: 'cushion' })
    await sync(b)

    at('2026-10-15T08:01:00Z')
    await docRound(a2) // без FG-27: A2 пишет 250 000 по старой копии → у всех 1 650 000
    expect(spentOnServer(server)).toBe(262_500)
    for (let round = 0; round < 3; round++) {
      at(`2026-10-15T08:0${2 + round}:00Z`)
      for (const p of [a1, a2, b]) await docRound(p)
      expect(spentOnServer(server)).toBe(262_500)
    }
    await sameEverywhere([a1, a2, b], 1_637_500)
  })

  it('(2) досрочка B с карты A — то же: запись card:a прежняя, «На карте» одно у троих', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    setActivePinia(b.pinia)
    b.store.applyPrepayment('loan', 'b', { amount: 300_000, mode: 'term', accountId: 'card' })
    await sync(b)

    at('2026-10-15T08:01:00Z')
    await docRound(a2)
    expect(spentOnServer(server)).toBe(262_500)
    for (let round = 0; round < 3; round++) {
      at(`2026-10-15T08:0${2 + round}:00Z`)
      for (const p of [a1, a2, b]) await docRound(p)
      expect(spentOnServer(server)).toBe(262_500)
    }
    await sameEverywhere([a1, a2, b], 1_437_500)
  })

  it('(3) A2 открыт заново без удачного pull (копия с прошлого запуска) получает документ — запись прежняя; сеть вернулась — пересчитана', async () => {
    const a1 = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a1.pinia)
    a1.store.setSpendAccount('card', 'a')
    at('2026-10-12T07:00:00Z')
    a1.store.setAccountAmount('card', 2_000_000)
    await sync(a1)
    await sync(b)
    at('2026-10-14T19:00:00Z')
    await statement(a1, [row('2026-10-14', -12_500, 'Magnum')])
    // Прошлый запуск A2: подтянул первую выписку; его копия на устройстве — снимок хранилища.
    await phone(server, st, 'a')
    const lastRun = new Map(storage)
    // Перевод B с карты A в цель — в выписке A1 раньше, чем B записал взнос (пары ещё нет: трата).
    at('2026-10-15T07:00:00Z')
    await statement(a1, [row('2026-10-15', -100_000, 'Перевод', { kind: 'transfer-out' }), row('2026-10-15', -5_000, 'Kiosk')])
    expect(spentOnServer(server)).toBe(117_500)

    // A2 открыт снова: на устройстве — копия прошлого запуска, сервер операций не отвечает.
    storage.clear()
    for (const [k, v] of lastRun) storage.set(k, v)
    down = true
    const a2 = await phone(server, st, 'a')
    at('2026-10-15T08:00:00Z')
    setActivePinia(b.pinia)
    b.store.shiftAccountAmount('card', -100_000, { kind: 'goal-in', goalId: 'cushion' })
    await sync(b)
    at('2026-10-15T08:01:00Z')
    await docRound(a2)
    expect(spentOnServer(server)).toBe(117_500) // без гарда pulledOk — 12 500 по старой копии

    down = false
    at('2026-10-15T08:02:00Z')
    await sync(a2) // первый удачный pull — запись по свежей копии: перевод — пара взноса
    expect(spentOnServer(server)).toBe(17_500)
    await docRound(a1)
    await docRound(b)
    await sameEverywhere([a1, a2, b], 1_882_500)
  })

  it('(4) регресс: свой сдвиг рукой на A1 пишется сразу, без запроса (копия свежая); офлайн после удачного pull — тоже', async () => {
    const { a1 } = await family()
    // Переводы в цели — в выписке раньше взносов (пока трата).
    await statement(a1, [row('2026-10-15', -40_000, 'Перевод', { kind: 'transfer-out' }), row('2026-10-15', -30_000, 'Перевод', { kind: 'transfer-out' })])
    expect(spentOnServer(server)).toBe(332_500)
    expect(card(a1)).toBe(1_667_500)
    const mine = () => a1.store.householdDoc.accountSpent?.find((s) => s.id === 'card:a')?.amount
    const ops = vi.mocked(apiClient.listOperations)
    ops.mockClear()
    setActivePinia(a1.pinia)
    a1.store.shiftAccountAmount('card', -40_000, { kind: 'goal-in', goalId: 'cushion' })
    await settle()
    expect(ops).not.toHaveBeenCalled() // копия свежая (pull только что) — без запроса
    expect(mine()).toBe(292_500)
    expect(card(a1)).toBe(1_667_500)

    // Через 10 минут без сети: запроса нет, запись — по локальной копии (удачный pull в запуске был).
    at('2026-10-15T07:10:00Z')
    setOnline(false)
    a1.store.shiftAccountAmount('card', -30_000, { kind: 'goal-in', goalId: 'cushion' })
    await settle()
    expect(ops).not.toHaveBeenCalled()
    expect(mine()).toBe(262_500)
    expect(card(a1)).toBe(1_667_500)
  })

  it('(5) «Оплатил» B (наблюдатель отметок) приходит на A2 после A1 — запись card:a не откатывается и не остаётся старой', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    setActivePinia(b.pinia)
    b.store.markPaid('obligation', 'rent', 'b', { accountId: null })
    await sync(b)

    at('2026-10-15T08:01:00Z')
    await docRound(a1) // свежая копия — та же сумма, новой записи нет
    await docRound(a2) // без пути `byDoc`: A2 пишет 250 000 по старой копии, и A1 её больше не перепишет
    expect(spentOnServer(server)).toBe(262_500)
    for (let round = 0; round < 3; round++) {
      at(`2026-10-15T08:0${2 + round}:00Z`)
      for (const p of [a1, a2, b]) await docRound(p)
      expect(spentOnServer(server)).toBe(262_500)
    }
    await sameEverywhere([a1, a2, b], 1_737_500)
  })
})
