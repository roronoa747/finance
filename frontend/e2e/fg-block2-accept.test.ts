import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { Account, Goal, SyncDoc } from '../src/types/finance'
import { money } from '../src/lib/money'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import GoalDetail from '../src/views/GoalDetail.vue'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 2 «Figma» (FG-14, FG-15, F2-Х1) — сценарии стенда приёмки (Chrome 390, Go-моки, партнёр — отдельный
 * пользователь со своими операциями), которых нет в `fg-block2-goal-statement`: вся цепочка на общей карте у двух телефонов
 * через экраны («Внести», «Записать», «Сбылось» и «Вернуть в мечты» из меню цели); взнос и доход партнёра на карту одного
 * хозяина; сдвиг другого счёта и документ без `accountShifts` (до Блока 2) — прежние числа. Четверг 15 октября 2026.
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
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
/** Остаток карты так, как его видит человек: «На карте» «Недели» (у хозяина) и строка «Kaspi Gold» «Капитала». */
const onCard = async (p: Phone) => norm(text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d\s]+₸)/)?.[1])
const inCapital = async (p: Phone) => norm(text(await screen(p.pinia, Money, '/money')).match(/Kaspi Gold.*?([\d\s]+₸)/)?.[1])
const card = (p: Phone) => p.store.accounts.find((a) => a.id === 'card')!.amount

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
const DEP: Partial<Operation> = { kind: 'transfer-out', internal: true }

/** «Пополнить» → сумма → «Списать со счёта» → «Внести» (`GoalDetail.applyDeposit`). */
const deposit = (p: Phone, goalId: string, amount: number, accountId = 'card') =>
  screen(p.pinia, GoalDetail, `/goals/${goalId}`, undefined, [
    screenMixin({ openDepositModal: true, depositOperation: 'deposit', depositAmount: String(amount), depositAccountId: accountId }, (s) => (s.applyDeposit as () => void)()),
  ])
/** «Внеплановый доход» → сумма → «На счёт: Kaspi Gold» → «Записать» (`ExtraIncomeSheet.applyExtraIncome`). */
const income = (p: Phone, amount: number) =>
  screen(p.pinia, Month, '/month', undefined, [
    screenMixin({ extraIncomeAmount: String(amount), extraIncomeTarget: 'account:card' }, (s) => (s.applyExtraIncome as () => void)()),
  ])
/** Меню цели → «Сбылось» / «Вернуть в мечты» (`GoalDetail.menu`). */
const goalMenu = (p: Phone, goalId: string, action: 'done' | 'undo') =>
  screen(p.pinia, GoalDetail, `/goals/${goalId}`, undefined, [screenMixin({}, (s) => (s.menu as (a: string) => void)(action))])

const kaspi = (extra: Partial<Account> = {}): Account => ({ id: 'card', name: 'Kaspi Gold', note: '', amount: 2_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0, ...extra })
const bike: Goal = { id: 'bike', name: 'Велосипед', need: 150_000, seed: 120_000, have: 120_000, monthly: 10_000, hue: 'ochre', planPct: 0, movements: [], accountId: 'card', updatedAt: T0 }

describe('e2e / приёмка Блока 2 «Figma» — взнос ↔ выписка', () => {
  const storage = new Map<string, string>()
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
    st = fakeStatements()
    seq = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('общая карта: взнос → выписка → доход → перевод партнёра → «Сбылось» → покупка → «Вернуть в мечты» — у обоих одна цифра на экранах', async () => {
    const server = fakeServer(planFamilyDoc({ goals: [...planFamilyDoc().goals!, bike] }))
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    await sync(a)
    await sync(b)
    const both = async (want: number) => {
      for (const p of [a, b]) {
        expect(card(p)).toBe(want)
        expect(await onCard(p)).toBe(norm(money(want)))
        expect(await inCapital(p)).toBe(norm(money(want)))
      }
    }
    await both(500_000)

    at('2026-10-15T08:00:00Z')
    await deposit(a, 'trip', 50_000)
    await sync(a)
    await sync(b)
    await both(450_000)

    at('2026-10-16T07:00:00Z')
    await statement(a, [row('2026-10-16', -50_000, 'На депозит', DEP), row('2026-10-16', -12_500, 'MAGNUM')])
    await sync(b)
    await both(437_500) // не 387 500

    at('2026-10-16T08:00:00Z')
    await income(a, 30_000)
    await sync(a)
    await statement(a, [row('2026-10-16', 30_000, 'Премия')])
    await sync(b)
    await both(467_500) // не 497 500

    // Перевод партнёра на ту же сумму с общей карты — его трата: его записи сдвига нет, мой сдвиг уже в паре.
    at('2026-10-16T09:00:00Z')
    await statement(b, [row('2026-10-16', -50_000, 'На депозит', DEP)])
    await sync(a)
    await both(417_500)

    at('2026-10-17T08:00:00Z')
    await goalMenu(a, 'bike', 'done')
    expect(a.store.accountShifts.filter((s) => s.kind === 'done')).toEqual([expect.objectContaining({ amount: -120_000, goalId: 'bike', by: 'a', date: '2026-10-17' })])
    await sync(a)
    await statement(a, [row('2026-10-17', -120_000, 'Decathlon')])
    await sync(b)
    await both(297_500) // не 177 500
    // Покупка — трата месяца у раздела (пара исключена только из «На карте»): MAGNUM + покупка.
    const month = (server.data.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'month' && t.period === '2026-10' && !t.deletedAt)
    expect(month.reduce((s, t) => s + t.amount, 0)).toBe(132_500)

    // «Вернуть в мечты»: база назад, запись «Сбылось» — надгробие, покупка снова трата — карта та же.
    at('2026-10-17T09:00:00Z')
    await goalMenu(a, 'bike', 'undo')
    await sync(a)
    await sync(b)
    expect((server.data.accountShifts ?? []).filter((s) => s.kind === 'done').map((s) => !!s.deletedAt)).toEqual([true])
    await both(297_500)
  })

  it('карта одного хозяина: взнос и доход партнёра с его телефона приходят выпиской хозяина один раз; выписка партнёра карту не трогает', async () => {
    const server = fakeServer(planFamilyDoc({ accounts: [kaspi({ spendBy: 'a' })] }))
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    await sync(a)
    await sync(b)

    at('2026-10-15T08:00:00Z')
    await deposit(b, 'trip', 30_000)
    at('2026-10-15T08:00:01Z')
    await income(b, 20_000)
    await sync(b)
    expect((server.data.accountShifts ?? []).map((s) => [s.kind, s.amount, s.by])).toEqual([['goal-in', -30_000, 'b'], ['income', 20_000, 'b']])
    await sync(a)
    expect(card(a)).toBe(490_000)

    at('2026-10-16T07:00:00Z')
    // Строки — днём позже сверки (тот же день уже в сверенной сумме, `spentSince`).
    await statement(a, [row('2026-10-16', -30_000, 'На депозит', DEP), row('2026-10-16', 20_000, 'Перевод от Аруны'), row('2026-10-16', -12_500, 'MAGNUM')])
    expect(card(a)).toBe(477_500) // не 467 500
    expect(await onCard(a)).toBe(norm(money(477_500)))
    await sync(b)
    expect(card(b)).toBe(477_500)
    expect(await inCapital(b)).toBe(norm(money(477_500)))

    // Партнёр не тратит с этой карты: его перевод на ту же сумму — не её строка.
    at('2026-10-16T08:00:00Z')
    await statement(b, [row('2026-10-16', -30_000, 'На депозит', DEP)])
    await sync(a)
    expect(card(a)).toBe(477_500)
    expect(card(b)).toBe(477_500)
  })

  it('сдвиг другого счёта не съедает строку карты; документ без `accountShifts` (до Блока 2) — числа как раньше', async () => {
    const doc: SyncDoc = planFamilyDoc({
      accounts: [kaspi(), { id: 'dep', name: 'Депозит', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'deposit', updatedAt: T0 }],
    })
    delete doc.accountShifts
    const server = fakeServer(doc)
    const a = await phone(server, st, 'a')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    await sync(a)

    // Взнос, записанный до Блока 2 (движение цели без записи сдвига), — перевод в выписке вычитается, как раньше.
    at('2026-10-15T08:00:00Z')
    a.store.contribute('trip', 50_000, 'a')
    at('2026-10-16T07:00:00Z')
    await statement(a, [row('2026-10-16', -50_000, 'На депозит', DEP)])
    expect(a.store.accountShifts).toEqual([])
    expect(card(a)).toBe(450_000)

    // Взнос со вклада: запись — на вклад; перевод с карты на ту же сумму — настоящий расход карты.
    at('2026-10-16T08:00:00Z')
    await deposit(a, 'trip', 50_000, 'dep')
    expect(a.store.accountShifts).toEqual([expect.objectContaining({ accountId: 'dep', amount: -50_000, kind: 'goal-in' })])
    expect(a.store.accounts.find((x) => x.id === 'dep')!.amount).toBe(950_000)
    at('2026-10-17T07:00:00Z')
    await statement(a, [row('2026-10-17', -50_000, 'На депозит', DEP)])
    expect(card(a)).toBe(400_000)
    expect(await onCard(a)).toBe(norm(money(400_000)))
  })
})
