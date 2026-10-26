import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import GoalDetail from '../src/views/GoalDetail.vue'
import Month from '../src/views/Month.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 2 «Figma» (FG-14, FG-15, F2-Х1): взнос в цель с карты, внеплановый доход и «Сбылось» двигают «На карте» сами, а тот
 * же перевод, пришедший выпиской, второй раз не вычитается. Семья из двух на моках (`planFamilyDoc`), карта «Kaspi Gold» —
 * счёт для трат обоих; четверг 15 октября 2026, карта сверена на 500 000.
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
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ')
const onCard = async (p: Phone) => text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d ]+₸)/)?.[1] ?? null
const nbsp = (s: string) => s.replace(/ /g, ' ')

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

/** «Положить» / «Снять» в листе цели со счётом — как нажатие «Внести» (`GoalDetail.applyDeposit`). */
const deposit = (p: Phone, goalId: string, amount: number, operation: 'deposit' | 'withdraw' = 'deposit') =>
  screen(p.pinia, GoalDetail, `/goals/${goalId}`, undefined, [
    screenMixin({ openDepositModal: true, depositOperation: operation, depositAmount: String(amount), depositAccountId: 'card' }, (s) => (s.applyDeposit as () => void)()),
  ])
/** «Внеплановый доход» на карту (`ExtraIncomeSheet.applyExtraIncome`, лист «Месяца»). */
const income = (p: Phone, amount: number) =>
  screen(p.pinia, Month, '/month', undefined, [
    screenMixin({ extraIncomeAmount: String(amount), extraIncomeTarget: 'account:card' }, (s) => (s.applyExtraIncome as () => void)()),
  ])

describe('e2e / Блок 2 «Figma» — взнос ↔ выписка (F2-Х1)', () => {
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

  it('A: взнос 50 000 с карты → 450 000; выписка с тем же переводом — по-прежнему 450 000; другая трата и доход — один раз; партнёр видит то же', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    await sync(a)
    expect(card(a)).toBe(500_000)

    at('2026-10-15T08:00:00Z')
    await deposit(a, 'trip', 50_000)
    expect(card(a)).toBe(450_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(450_000)))
    await sync(a)
    // Запись сдвига — в документе семьи, у партнёра после синка тоже.
    expect(server.data.accountShifts).toEqual([expect.objectContaining({ accountId: 'card', amount: -50_000, kind: 'goal-in', goalId: 'trip', by: 'a', date: '2026-10-15' })])
    await sync(b)
    expect(b.store.accountShifts).toHaveLength(1)
    expect(card(b)).toBe(450_000)

    // Через 2 дня выписка: тот же перевод на депозит и обычная трата.
    at('2026-10-17T07:00:00Z')
    await statement(a, [
      row('2026-10-17', -50_000, 'На депозит', { kind: 'transfer-out', internal: true }),
      row('2026-10-16', -12_500, 'MAGNUM'),
    ])
    expect(card(a)).toBe(437_500) // не 387 500: перевод уже вычтен взносом
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(437_500)))
    await sync(b)
    expect(card(b)).toBe(437_500)
    expect(nbsp(String(await onCard(b)))).toBe(nbsp(money(437_500)))

    // Внеплановый доход 30 000 на карту + тот же приход в выписке — один раз.
    at('2026-10-18T07:00:00Z')
    await income(a, 30_000)
    expect(card(a)).toBe(467_500)
    await sync(a)
    await statement(a, [row('2026-10-18', 30_000, 'Премия')])
    expect(card(a)).toBe(467_500)
    await sync(b)
    expect(card(b)).toBe(467_500)
  })

  it('A: без записи сдвига (вторая такая же строка) — трата; снятие с цели на карту ↔ приход — один раз', async () => {
    const a = await phone(server, st, 'a')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    at('2026-10-15T08:00:00Z')
    await deposit(a, 'trip', 50_000)
    at('2026-10-17T07:00:00Z')
    // Два одинаковых перевода, сдвиг один — вторая строка вычитается.
    await statement(a, [
      row('2026-10-16', -50_000, 'На депозит', { kind: 'transfer-out', internal: true }),
      row('2026-10-17', -50_000, 'На депозит', { kind: 'transfer-out', internal: true }),
    ])
    expect(card(a)).toBe(400_000)

    at('2026-10-18T07:00:00Z')
    await deposit(a, 'trip', 20_000, 'withdraw')
    expect(card(a)).toBe(420_000)
    await statement(a, [row('2026-10-19', 20_000, 'С депозита', { kind: 'transfer-in', internal: true })])
    expect(card(a)).toBe(420_000)
  })

  it('A: сдвиг до сверки, строка после новой сверки — не вычитается (якорь)', async () => {
    const a = await phone(server, st, 'a')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    at('2026-10-15T08:00:00Z')
    await deposit(a, 'trip', 20_000)
    expect(card(a)).toBe(480_000)
    await sync(a)

    // Сверка с банком на следующий день — те же 480 000.
    at('2026-10-16T07:00:00Z')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 480_000)
    await sync(a)
    // Строка выписки датой после сверки — пара сдвига, второй раз не вычитается.
    at('2026-10-18T07:00:00Z')
    await statement(a, [row('2026-10-17', -20_000, 'На депозит', { kind: 'transfer-out', internal: true })])
    expect(card(a)).toBe(480_000)
  })

  it('B: «Сбылось» у мечты на карте — карта −have; покупка в выписке не вычитается второй раз, но остаётся тратой раздела', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    a.store.updateGoal('trip', { accountId: 'card' })
    const have = a.store.goals.find((g) => g.id === 'trip')!.have
    expect(have).toBeGreaterThan(0)
    at('2026-10-15T08:00:00Z')
    a.store.markGoalDone('trip')
    expect(card(a)).toBe(500_000 - have)
    await sync(a)

    at('2026-10-17T07:00:00Z')
    // Мечта куплена в рассрочку — строка в разделе платежей «Кредиты и рассрочки»: её сумма остаётся «без отметки» раздела.
    await statement(a, [row('2026-10-16', -have, 'Kaspi рассрочка', { categoryId: 'sc_credit' })])
    expect(card(a)).toBe(500_000 - have)
    await sync(b)
    expect(card(b)).toBe(500_000 - have)
    // Итог раздела за месяц — с покупкой (пара исключена только из «На карте»).
    const month = (server.data.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'month' && t.period === '2026-10' && !t.deletedAt)
    expect(month.reduce((s, t) => s + t.amount, 0)).toBe(have)
    expect(month.find((t) => t.categoryId === 'sc_credit')).toMatchObject({ amount: have, unmarked: have })
  })

  // Критик Блока 2: чей сдвиг сверяется с чьей выпиской.
  it('C: карта только моя — взнос с неё с телефона партнёра в моей выписке один раз; общая («оба») — строка партнёра на ту же сумму — его трата', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    await sync(a)
    await sync(b)

    // «Оба»: мой взнос 50 000 — в моей выписке пара; у партнёра перевод на ту же сумму в те же дни — его трата.
    at('2026-10-15T08:00:00Z')
    await deposit(a, 'trip', 50_000)
    await sync(a)
    at('2026-10-17T07:00:00Z')
    await statement(b, [row('2026-10-16', -50_000, 'На депозит', { kind: 'transfer-out', internal: true })])
    await statement(a, [row('2026-10-15', -50_000, 'На депозит', { kind: 'transfer-out', internal: true })])
    await sync(b)
    expect(card(a)).toBe(400_000)
    expect(card(b)).toBe(400_000)

    // Карта только моя (`spendBy` a, новая сверка): партнёр вносит с неё со своего телефона — запись его слота, перевод
    // приходит моей выпиской и второй раз не вычитается.
    at('2026-10-18T07:00:00Z')
    setActivePinia(a.pinia)
    a.store.setSpendAccount('card', 'a')
    a.store.setAccountAmount('card', 400_000)
    await sync(a)
    await sync(b)
    at('2026-10-19T08:00:00Z')
    await deposit(b, 'trip', 30_000)
    await sync(b)
    expect(b.store.accountShifts.at(-1)).toMatchObject({ by: 'b', amount: -30_000, kind: 'goal-in' })
    await sync(a)
    expect(card(a)).toBe(370_000)
    at('2026-10-20T07:00:00Z')
    await statement(a, [row('2026-10-19', -30_000, 'На депозит', { kind: 'transfer-out', internal: true })])
    expect(card(a)).toBe(370_000) // не 340 000
    await sync(b)
    expect(card(b)).toBe(370_000)
  })

  it('D: выписка раньше взноса — новая запись сдвига сразу пересчитывает «На карте»; «Вернуть в мечты» — покупка снова трата', async () => {
    const a = await phone(server, st, 'a')
    setActivePinia(a.pinia)
    a.store.setAccountAmount('card', 500_000)
    at('2026-10-16T07:00:00Z')
    await statement(a, [row('2026-10-16', -50_000, 'На депозит', { kind: 'transfer-out', internal: true })])
    expect(card(a)).toBe(450_000)
    // Взнос записан после выписки: база −50 000, строка — пара сдвига, а не трата (иначе 400 000).
    at('2026-10-16T09:00:00Z')
    await deposit(a, 'trip', 50_000)
    expect(card(a)).toBe(450_000)
    expect(nbsp(String(await onCard(a)))).toBe(nbsp(money(450_000)))

    // «Сбылось» у мечты на карте, покупка пришла выпиской, затем «Вернуть в мечты»: запись «Сбылось» — надгробие, база
    // назад, а покупка из выписки — снова трата (деньги с карты ушли).
    setActivePinia(a.pinia)
    a.store.updateGoal('trip', { accountId: 'card' })
    const have = a.store.goals.find((g) => g.id === 'trip')!.have
    at('2026-10-17T08:00:00Z')
    a.store.markGoalDone('trip')
    expect(card(a)).toBe(450_000 - have)
    await statement(a, [row('2026-10-17', -have, 'AVIATA')])
    expect(card(a)).toBe(450_000 - have)
    at('2026-10-17T09:00:00Z')
    // Через час после своего pull наблюдатель счёта сначала тянет свои операции (FG-27) — общим клиентом, ручками A.
    vi.spyOn(apiClient, 'listOperations').mockImplementation(statementsFor(st, 'u-a', 'a').listOperations as never)
    setActivePinia(a.pinia)
    a.store.undoGoalDone('trip')
    await nextTick()
    expect(a.store.accountShifts.filter((s) => s.kind === 'done')).toEqual([])
    // не 450 000: пересчёт будит снятая запись, не ждёт синка документа
    await vi.waitFor(() => expect(card(a)).toBe(450_000 - have))
    expect(apiClient.listOperations).toHaveBeenCalledTimes(1)
    await sync(a)
    expect(card(a)).toBe(450_000 - have)
  })
})
