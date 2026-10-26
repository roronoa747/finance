import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { planFamilyDoc } from '../src/test/planFamily'
import Month from '../src/views/Month.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, tapPutDebt, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 3 «Figma» (FG-17, FG-Х4): шаг плана «Сначала долги» в месяц старта берёт «уже накопленное» с целей на паузе — карта
 * растёт на эту сумму записью сдвига `goal-out`, и тот же приход «с депозита» в выписке второй раз не считается. Семья из
 * двух на моках (`planFamilyDoc`): отпуск 50 000 и машина 200 000 на паузе, «вложить уже накопленное» 150 000 (доли 30 000
 * и 120 000); шаг месяца — 100 000 взносов пауз + 150 000 = 250 000 в «Кредитку» с карты «Kaspi Gold».
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
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const onCard = async (p: Phone) => text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d ]+₸)/)?.[1] ?? null
const nbsp = (s: string) => s.replace(/\s/g, ' ')

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
const fromDeposit = (date: string, amount: number) => row(date, amount, 'С депозита', { kind: 'transfer-in', internal: true })

/** План «Сначала долги» с «Вложить уже накопленное» 150 000; «Кредитку» уже платили с карты — шаг идёт с неё без листа. */
async function planWithLump(a: Phone) {
  setActivePinia(a.pinia)
  a.store.markPaid('credit', 'cc', 'a', { accountId: 'card' })
  a.store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 150_000 }, 'a')
  // Сверка карты после отметки — 2 000 000.
  at('2026-10-15T07:30:00Z')
  a.store.setAccountAmount('card', 2_000_000)
  await sync(a)
}

// Оба describe — одна семья и одни часы.
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
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('e2e / Блок 3 «Figma» — досрочка из целей ↔ выписка (FG-17)', () => {
  it('«Отложил» шаг в «Месяце» → карта −250 000 +150 000; приход «с депозита» в выписке — тот же 1 900 000; вторая такая строка — доход; партнёр видит то же', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    await planWithLump(a)

    at('2026-10-15T08:00:00Z')
    await screen(a.pinia, Month, '/month', undefined, [tapPutDebt()])
    const step = a.store.payments.find((p) => p.kind === 'prepay' && !p.deletedAt)!
    expect(step).toMatchObject({ targetId: 'cc', amount: 250_000, accountId: 'card' })
    expect(card(a)).toBe(1_900_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_900_000)))
    await sync(a)
    // Запись сдвига — одна, в документе семьи: +150 000 с двух целей (без goalId), слот телефона, сегодня.
    expect(server.data.accountShifts).toEqual([expect.objectContaining({ accountId: 'card', amount: 150_000, kind: 'goal-out', by: 'a', date: '2026-10-15' })])
    expect(server.data.accountShifts![0]).not.toHaveProperty('goalId')
    await sync(b)
    expect(card(b)).toBe(1_900_000)

    // Выписка через 2 дня: приход «с депозита» на ту же сумму, что сняли с целей. Строка самой досрочки банку (−шаг) —
    // пара FG-18, describe ниже.
    at('2026-10-17T07:00:00Z')
    await statement(a, [fromDeposit('2026-10-16', 150_000)])
    expect(card(a)).toBe(1_900_000) // не 2 050 000: приход уже на карте записью сдвига
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_900_000)))
    await sync(b)
    expect(card(b)).toBe(1_900_000)
    expect(nbsp(String(await onCard(b)))).toBe(nbsp(money(1_900_000)))

    // Вторая такая же строка — пары нет: обычный приход.
    at('2026-10-18T07:00:00Z')
    await statement(a, [fromDeposit('2026-10-18', 150_000)])
    expect(card(a)).toBe(2_050_000)
    await sync(b)
    expect(card(b)).toBe(2_050_000)
  })

  it('карта только моя: шаг вносит партнёр со своего телефона — приход в моей выписке считается один раз', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setSpendAccount('card', 'a')
    await planWithLump(a)
    await sync(b)

    at('2026-10-15T08:00:00Z')
    await screen(b.pinia, Month, '/month', undefined, [tapPutDebt()])
    expect(b.store.accountShifts).toEqual([expect.objectContaining({ amount: 150_000, kind: 'goal-out', by: 'b' })])
    expect(card(b)).toBe(1_900_000)
    await sync(b)
    await sync(a)
    expect(card(a)).toBe(1_900_000)

    at('2026-10-17T07:00:00Z')
    await statement(a, [fromDeposit('2026-10-16', 150_000)])
    expect(card(a)).toBe(1_900_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_900_000)))
    await sync(b)
    expect(card(b)).toBe(1_900_000)
  })
})

/**
 * FG-18 (FG-Х5): досрочка со счёта уже уменьшила остаток записью платежа — её строка «−сумма» банку в выписке второй раз из
 * «На карте» не вычитается (пара тем же `shiftedOps`, что сдвиги рукой). Та же семья: шаг плана 250 000 в «Кредитку» с карты;
 * «Внёс досрочно» 300 000 в «Кредит» стором (лист покрыт `f2-block2-prepay`).
 */
describe('e2e / Блок 3 «Figma» — досрочка со счёта ↔ строка выписки (FG-18)', () => {
  const bank = (date: string, amount: number) => row(date, amount, 'Погашение кредита', { kind: 'transfer-out' })
  const prepay = async (p: Phone, accountId: string | null) => {
    setActivePinia(p.pinia)
    p.store.applyPrepayment('loan', 'a', { amount: 300_000, mode: 'term', accountId })
    await sync(p)
  }

  it('месяц старта плана: выписка с обеими строками (−шаг и +took) — «На карте» 1 900 000 у обоих; −шаг вне окна — трата', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    await planWithLump(a)
    at('2026-10-15T08:00:00Z')
    await screen(a.pinia, Month, '/month', undefined, [tapPutDebt()])
    expect(card(a)).toBe(1_900_000)
    await sync(a)

    at('2026-10-17T07:00:00Z')
    await statement(a, [bank('2026-10-16', -250_000), fromDeposit('2026-10-16', 150_000)])
    expect(card(a)).toBe(1_900_000) // без FG-18 — 1 650 000, без FG-17 — 1 800 000
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_900_000)))
    await sync(b)
    expect(card(b)).toBe(1_900_000)
    expect(nbsp(String(await onCard(b)))).toBe(nbsp(money(1_900_000)))
    // Итог раздела месяца — со строкой −шаг: пара исключена только из «На карте» (как покупка мечты в FG-15).
    const month = (server.data.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'month' && t.period === '2026-10' && !t.deletedAt)
    expect(month.find((t) => t.categoryId === 'sc_credit')).toMatchObject({ amount: 250_000, unmarked: 250_000 })

    // Вторая строка −250 000 через 10 дней от досрочки — вне окна: обычное списание.
    at('2026-10-26T07:00:00Z')
    await statement(a, [bank('2026-10-25', -250_000)])
    expect(card(a)).toBe(1_650_000)
    await sync(b)
    expect(card(b)).toBe(1_650_000)
  })

  it('«Внёс досрочно» 300 000 → строка −300 000 через день — карта та же; «Снять» — строка снова трата', async () => {
    const a = await phone(server, st, 'a')
    await prepay(a, 'card')
    expect(card(a)).toBe(1_700_000)
    at('2026-10-17T07:00:00Z')
    await statement(a, [bank('2026-10-16', -300_000)])
    expect(card(a)).toBe(1_700_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_700_000)))

    setActivePinia(a.pinia)
    a.store.removePrepayment(a.store.payments.find((p) => p.kind === 'prepay' && !p.deletedAt)!.id)
    await sync(a)
    expect(card(a)).toBe(1_700_000) // досрочки нет — остаток вернулся, строка −300 000 — трата
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_700_000)))
  })

  it('обратный порядок: строка −300 000 загружена раньше досрочки — 1 700 000, не 1 400 000', async () => {
    const a = await phone(server, st, 'a')
    at('2026-10-16T07:00:00Z')
    await statement(a, [bank('2026-10-15', -300_000)])
    expect(card(a)).toBe(1_700_000)
    await prepay(a, 'card')
    expect(card(a)).toBe(1_700_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_700_000)))
  })

  it('досрочка «не списывать» (accountId null) при строке −300 000 — строка считается: 1 700 000', async () => {
    const a = await phone(server, st, 'a')
    await prepay(a, null)
    expect(card(a)).toBe(2_000_000)
    at('2026-10-17T07:00:00Z')
    await statement(a, [bank('2026-10-16', -300_000)])
    expect(card(a)).toBe(1_700_000)
  })

  // Критик Блока 3: строка, отданная платежу по графику (`markedOps`), досрочке не достаётся — её пара — вторая строка.
  it('«Оплатил» кредит и досрочка на ту же сумму 58 000: строка платежа 15-го — отметка, строка 17-го — пара досрочки', async () => {
    const a = await phone(server, st, 'a')
    setActivePinia(a.pinia)
    a.store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
    a.store.applyPrepayment('loan', 'a', { amount: 58_000, mode: 'term', accountId: 'card' })
    await sync(a)
    expect(card(a)).toBe(1_884_000)
    at('2026-10-18T07:00:00Z')
    await statement(a, [bank('2026-10-15', -58_000), bank('2026-10-17', -58_000)])
    expect(card(a)).toBe(1_884_000) // досрочка взяла бы ближайшую строку 15-го — 1 826 000
  })

  it('карта только моя: шаг вносит партнёр — строки −шаг и +took в моей выписке, 1 900 000 у обоих', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setSpendAccount('card', 'a')
    await planWithLump(a)
    await sync(b)

    at('2026-10-15T08:00:00Z')
    await screen(b.pinia, Month, '/month', undefined, [tapPutDebt()])
    expect(b.store.payments.find((p) => p.kind === 'prepay' && !p.deletedAt)).toMatchObject({ by: 'b', accountId: 'card', amount: 250_000 })
    await sync(b)
    await sync(a)
    expect(card(a)).toBe(1_900_000)

    at('2026-10-17T07:00:00Z')
    await statement(a, [bank('2026-10-16', -250_000), fromDeposit('2026-10-16', 150_000)])
    expect(card(a)).toBe(1_900_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(1_900_000)))
    await sync(b)
    expect(card(b)).toBe(1_900_000)
  })
})
