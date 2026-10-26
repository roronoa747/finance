// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView } from 'vue-router'
import type { ApiClient } from '../src/api/client'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { Payment } from '../src/types/finance'
import { money } from '../src/lib/money'
import { planFamilyDoc } from '../src/test/planFamily'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, tapPutDebt, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 3 «Figma» (FG-17, FG-18) — сценарии стенда приёмки, которых нет в `fg-block3-tails`: два месяца плана
 * «Сначала долги» на общей карте у двух телефонов (октябрь — месяц старта с «вложить накопленное»: строки −шаг и +took;
 * ноябрь — обычный шаг без записи сдвига, строка −шаг — частый путь); «Внёс досрочно» и «Снять» настоящим листом кредита при
 * загруженной выписке; карта «оба» — досрочка партнёра сверяется только с его выпиской. «На карте» «Недели» и строка
 * «Kaspi Gold» «Капитала» — у обоих до тенге. Семья `planFamilyDoc` на фейковом сервере, четверг 15 октября 2026.
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
const norm = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()
const onCard = async (p: Phone) => norm(text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d\s]+₸)/)?.[1])
const inCapital = async (p: Phone) => norm(text(await screen(p.pinia, Money, '/money')).match(/Kaspi Gold.*?([\d\s]+₸)/)?.[1])
/** Одно число у обоих: остаток в сторе, «На карте» «Недели», строка карты «Капитала». */
async function both(want: number, ...phones: Phone[]) {
  for (const p of phones) {
    await sync(p)
    expect(card(p)).toBe(want)
    expect(await onCard(p)).toBe(norm(money(want)))
    expect(await inCapital(p)).toBe(norm(money(want)))
  }
}

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
const bank = (date: string, amount: number) => row(date, amount, 'Погашение кредита', { kind: 'transfer-out' })
const fromDeposit = (date: string, amount: number) => row(date, amount, 'С депозита', { kind: 'transfer-in', internal: true })
const prepays = (p: Phone) => p.store.payments.filter((x) => x.kind === 'prepay' && !x.deletedAt)

/** Август: «Кредит» платили с карты — «Внёс досрочно» предлагает её сам (до сверки T0, остаток не двигает). */
const augLoan: Payment = {
  id: 'pay-loan-aug', kind: 'credit', targetId: 'loan', period: '2026-08', amount: 58_000, principal: 30_000, accountId: 'card', by: 'a',
  at: '2026-08-15T05:00:00.000Z', updatedAt: '2026-08-15T05:00:00.000Z',
}

// Лист кредита настоящим DOM (как `f2-block2-prepay`).
let app: App | null = null
const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await nextTick()
}
async function mount(p: Phone, path: string) {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(p.pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(p.pinia)
  app.use(router)
  app.mount(root)
  await tick()
}
const top = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const button = (label: string) => [...top().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!
const tap = async (el: HTMLElement) => {
  el.click()
  await tick()
}
/** «Долги» → «Кредит» → «Внёс досрочно» → сумма → «Внёс» → «Готово» (счёт — прошлой оплаты, Kaspi Gold). */
async function prepayBySheet(p: Phone, amount: number) {
  await mount(p, '/money/debts')
  await tap(document.querySelector<HTMLElement>('[data-debt="loan"]')!)
  await tap(top().querySelector<HTMLElement>('[data-credit-prepay]')!)
  const input = top().querySelector<HTMLInputElement>('[data-prepay-amount]')!
  input.focus()
  input.value = String(amount)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  await tap(button('Внёс'))
  await tap(button('Готово'))
}
/** Лист «Кредит» → «Досрочные взносы · N» → «Снять» → «Снять». */
async function removeBySheet(p: Phone) {
  await mount(p, '/money/debts')
  await tap(document.querySelector<HTMLElement>('[data-debt="loan"]')!)
  await tap(top().querySelector<HTMLElement>('[data-credit-payoff]')!)
  await tap(button('Снять'))
  await tap(button('Снять'))
}

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
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  vi.useFakeTimers()
  at('2026-10-15T07:00:00Z')
  st = fakeStatements()
  seq = 0
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('e2e / приёмка Блока 3 «Figma» — досрочка ↔ выписка', () => {
  it('два месяца плана на общей карте: октябрь (−шаг и +took) и ноябрь (обычный шаг) — «На карте» и «Капитал» у обоих не меняются от строк досрочки; итог «Трат» со строкой −шаг', async () => {
    const server = fakeServer(planFamilyDoc())
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(a.pinia)
    a.store.markPaid('credit', 'cc', 'a', { accountId: 'card' })
    a.store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 150_000 }, 'a')
    at('2026-10-15T07:30:00Z')
    a.store.setAccountAmount('card', 2_000_000)
    await sync(a)
    await both(2_000_000, a, b)

    // Октябрь — месяц старта: шаг 250 000 с карты, из них 150 000 сняты с целей на паузе (запись goal-out).
    at('2026-10-15T08:00:00Z')
    await screen(a.pinia, Month, '/month', undefined, [tapPutDebt()])
    expect(prepays(a).map((p) => [p.targetId, p.period, p.amount, p.accountId])).toEqual([['cc', '2026-10', 250_000, 'card']])
    await sync(a)
    await both(1_900_000, a, b)

    at('2026-10-17T07:00:00Z')
    await statement(a, [bank('2026-10-16', -250_000), fromDeposit('2026-10-16', 150_000), row('2026-10-16', -12_500, 'MAGNUM')])
    await both(1_887_500, a, b) // без FG-18 — 1 637 500; без FG-17 — 1 737 500
    // «Месяц → Траты»: строка −шаг осталась тратой раздела (пара — только в «На карте»).
    expect(text(await screen(a.pinia, Month, '/month')).replace(/\s/g, ' ')).toContain('262 500 потрачено')
    const oct = (server.data.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'month' && t.period === '2026-10' && !t.deletedAt)
    expect(oct.reduce((s, t) => s + t.amount, 0)).toBe(262_500)

    // Ноябрь — обычный шаг (вложенного уже нет): досрочка с карты без записи сдвига, строка −шаг в выписке — пара.
    at('2026-11-12T07:00:00Z')
    await sync(a)
    await screen(a.pinia, Month, '/month', undefined, [tapPutDebt()])
    const nov = prepays(a).find((p) => p.period === '2026-11')!
    expect(nov).toMatchObject({ accountId: 'card', by: 'a' })
    expect(nov.amount).toBeGreaterThan(0)
    expect(a.store.accountShifts).toHaveLength(1) // took = 0 — записи нет
    await sync(a)
    await both(1_887_500 - nov.amount, a, b)

    at('2026-11-14T07:00:00Z')
    await statement(a, [bank('2026-11-13', -nov.amount)])
    await both(1_887_500 - nov.amount, a, b)
    expect((server.data.accountShifts ?? []).map((s) => [s.kind, s.amount, s.by])).toEqual([['goal-out', 150_000, 'a']])
  })

  it('«Внёс досрочно» и «Снять» настоящим листом кредита при загруженной выписке — карта та же у обоих', async () => {
    const server = fakeServer(planFamilyDoc({ payments: [augLoan] }))
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    await both(2_000_000, a, b)

    await prepayBySheet(a, 300_000)
    expect(prepays(a).map((p) => [p.targetId, p.amount, p.accountId, p.by])).toEqual([['loan', 300_000, 'card', 'a']])
    await sync(a)
    await both(1_700_000, a, b)

    at('2026-10-17T07:00:00Z')
    await statement(a, [bank('2026-10-16', -300_000)])
    await both(1_700_000, a, b) // без FG-18 — 1 400 000

    // «Снять»: остаток вернулся, строка −300 000 снова трата — по банку деньги ушли.
    await removeBySheet(a)
    expect(prepays(a)).toHaveLength(0)
    await sync(a)
    expect((server.data.payments ?? []).find((p) => p.kind === 'prepay')!.deletedAt).toBeTruthy()
    await both(1_700_000, a, b)
  })

  it('карта «оба»: досрочка партнёра — пара в его выписке; та же строка в моей выписке — моя трата (только свои досрочки)', async () => {
    const server = fakeServer(planFamilyDoc())
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b')
    setActivePinia(b.pinia)
    b.store.applyPrepayment('loan', 'b', { amount: 100_000, mode: 'term', accountId: 'card' })
    await sync(b)
    await both(1_900_000, a, b)

    at('2026-10-17T07:00:00Z')
    await statement(b, [bank('2026-10-16', -100_000)])
    await both(1_900_000, b, a)

    at('2026-10-17T08:00:00Z')
    await statement(a, [bank('2026-10-16', -100_000)])
    await both(1_800_000, a, b)
  })
})
