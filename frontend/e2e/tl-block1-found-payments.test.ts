import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import { foundPayments } from '../src/lib/statements/firstRun'
import { todayIso } from '../src/lib/dates'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Month from '../src/views/Month.vue'
import Money from '../src/views/Money.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 1 «Хвосты» (TL-01…TL-03; Р-1…Р-3): «нашли в выписке» — только похожее на платежи. Новая семья, пятница 23 октября
 * 2026; выписка 1–22 октября (три недели).
 *
 * Ручной расчёт (TL-01):
 *   Netflix 3 990 7-го — словарь (подписка) → «нашли».
 *   Coffee Boom 2 500 по два раза в неделю (1, 2, 8, 9, 15, 16) и Yandex Go 3 000 (5, 6, 12, 13, 19, 20) — близкие суммы в
 *   близкие дни (`detectRecurring` их ловит), но в месяце по шесть списаний → мимо (Р-1). Magnum — продукты, разные суммы →
 *   мимо. Итог: «нашли 1 в выписке», в списке только Netflix.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const K = '2026-10'
const op = (date: string, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const statement = (ops: Omit<Operation, 'id'>[], from = '2026-10-01', to = '2026-10-22'): ParsedStatement => ({ bank: 'kaspi', from, to, skipped: 0, operations: assignIds(ops) })
const day = (d: number) => `${K}-${String(d).padStart(2, '0')}`
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ')
const between = (html: string, from: string, to: string) => {
  const i = html.indexOf(from)
  if (i < 0) return ''
  const j = html.indexOf(to, i + from.length)
  return html.slice(i, j < 0 ? undefined : j)
}
const THREE_WEEKS = () => [
  op(day(7), -3_990, 'NETFLIX.COM', 'sc_subscriptions'),
  ...[1, 2, 8, 9, 15, 16].map((d) => op(day(d), -2_500, 'Coffee Boom', 'sc_cafe')),
  ...[5, 6, 12, 13, 19, 20].map((d) => op(day(d), -3_000, 'Yandex Go', 'sc_transport')),
  op(day(3), -12_400, 'Magnum', 'sc_food'), op(day(10), -18_700, 'Magnum', 'sc_food'), op(day(17), -9_300, 'Magnum', 'sc_food'),
]

describe('e2e / Хвосты Блок 1 — платежи из выписки', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-23T07:00:00Z')
    server = fakeServer({ ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }], setupDoneAt: T0 })
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function phone(): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData({
      token: 't-u-a', user: { id: 'u-a', email: 'u-a@family.kz', created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
    })
    const client = { ...backend(server), ...statementsFor(st, 'u-a', 'a'), ...privateFor(pv, 'u-a') } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await store.pullPrivateDoc(client)
    await useOperationsStore().loadUploads(client)
    await useOperationsStore().pull(client)
    return { pinia, client, store }
  }

  async function uploaded(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    await useOperationsStore().upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }

  const month = (p: Phone, state: Record<string, unknown> = {}) => {
    setActivePinia(p.pinia)
    return screen(p.pinia, Month, '/month', undefined, [screenMixin(state)])
  }
  const found = (p: Phone) => {
    setActivePinia(p.pinia)
    return foundPayments(useOperationsStore().all, { rules: p.store.merchantRules, payments: p.store.payments, today: todayIso() })
  }

  it('TL-01: три недели выписки — «нашли 1 в выписке», в списке только подписка; кофейня, такси и магазин — мимо', async () => {
    const A = await phone()
    await uploaded(A, statement(THREE_WEEKS()))
    const html = await month(A, { opened: 'dues' })
    expect(html).toContain('data-section-found="1"')
    expect(html).toContain('нашли 1 в выписке')
    const rows = [...html.matchAll(/data-found-row="([^"]+)"/g)].map((m) => m[1])
    expect(rows).toEqual(found(A).map((f) => f.opId))
    expect(found(A).map((f) => [f.name, f.amount, f.kind])).toEqual([['NETFLIX.COM', 3_990, 'subscription']])
    for (const m of ['Coffee Boom', 'Yandex Go', 'Magnum']) expect(html).not.toContain(m)
  })

  it('TL-02: магазин приложений, две подписки (1 990 и 4 990) — обе заводятся через «В платежи», обе в «Деньгах», в траты не уходят; ноябрь отмечается сам', async () => {
    const A = await phone()
    const apple = (date: string, amount: number) => op(date, -amount, 'APPLE.COM BILL', 'sc_subscriptions')
    await uploaded(A, statement([apple('2026-09-02', 1_990), apple('2026-09-14', 4_990), apple('2026-10-02', 1_990), apple('2026-10-14', 4_990)], '2026-09-01', '2026-10-22'))
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const line = (amount: number, month = K) => ops.all.find((o) => o.amount === -amount && o.date.startsWith(month))!

    // «Нашли в выписке» — одна строка продавца; «В платежи» → форма с её суммой → платёж.
    const [first] = found(A)
    expect(found(A)).toHaveLength(1)
    const firstId = A.store.addObligation({ name: 'Apple Music', note: 'ежемесячно', day: first.day, category: 'd4', every: 'month', amount: first.amount })
    await ops.addToPayments(first.opId, firstId, A.client)
    // Вторая подписка — «В платежи» у её строки (лист операции): продавец уже платёж, но в месяце обе суммы.
    const other = first.amount === 1_990 ? 4_990 : 1_990
    const pre = ops.recurringFor(line(other))!
    expect(pre).toMatchObject({ amount: other, kind: 'subscription' })
    const secondId = A.store.addObligation({ name: 'iCloud', note: 'ежемесячно', day: pre.day, category: 'd4', every: 'month', amount: pre.amount })
    await ops.addToPayments(line(other).id, secondId, A.client)
    await A.store.syncHousehold(A.client)

    const marks = (id: string) => A.store.payments.filter((p) => !p.deletedAt && p.targetId === id).map((p) => [p.period, p.amount])
    expect(marks(firstId)).toEqual([[K, first.amount]])
    expect(marks(secondId)).toEqual([[K, other]])
    expect(A.store.householdDoc.spendTotals?.find((t) => t.id === `a:month:${K}:sc_subscriptions`)?.unmarked ?? 0).toBe(0)
    expect(found(A)).toEqual([])
    // «Деньги → Платежи»: подписки одной строкой — обе, сумма 6 980.
    const subs = between(await screen(A.pinia, Money, '/money'), 'data-subs', '</button>')
    expect(text(subs)).toContain('Подписки · 2')
    expect(text(subs)).toContain('6 980')

    // Ноябрь: обе строки отмечаются правилами сами, каждая своей суммой.
    at('2026-11-20T07:00:00Z')
    await uploaded(A, statement([apple('2026-11-02', 1_990), apple('2026-11-14', 4_990)], '2026-11-01', '2026-11-19'))
    expect(marks(firstId).find((m) => m[0] === '2026-11')).toEqual(['2026-11', first.amount])
    expect(marks(secondId).find((m) => m[0] === '2026-11')).toEqual(['2026-11', other])
    expect(A.store.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2026-11:sc_subscriptions')?.unmarked ?? 0).toBe(0)
  })

  it('TL-03: «нашли» → строка кредита → «В платежи» (лист кредита: платёж и день из выписки) → остаток → кредит в «Деньгах → Долг» с остатком, платёж октября отмечен, раздел «Кредиты»', async () => {
    const A = await phone()
    await uploaded(A, statement([...THREE_WEEKS(), op(day(5), -32_000, 'Kaspi Кредит', 'sc_credit')]))
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const credit = found(A).find((f) => f.kind === 'credit')!
    expect(credit).toMatchObject({ name: 'Kaspi Кредит', amount: 32_000, day: 5 })
    expect(found(A).map((f) => f.kind).sort()).toEqual(['credit', 'subscription'])
    expect(await month(A, { opened: 'dues' })).toContain(`data-found-row="${credit.opId}"`)
    // Как `NewDebtSheet` с `prefill`: «Банку», имя, платёж и день из выписки; остаток вводит человек.
    const id = A.store.addCredit({ name: credit.name, note: 'рассрочка', principal: 450_000, annualRate: 0, payment: credit.amount, day: credit.day })
    await ops.addToPayments(credit.opId, id, A.client)
    await A.store.syncHousehold(A.client)

    expect(A.store.obligations).toEqual([])
    expect(A.store.payments.filter((p) => !p.deletedAt && p.targetId === id)).toEqual([expect.objectContaining({ kind: 'credit', period: K, amount: 32_000, opId: credit.opId })])
    expect(ops.all.find((o) => o.id === credit.opId)!.categoryId).toBe('sc_credit')
    expect(A.store.householdDoc.spendTotals?.find((t) => t.id === `a:month:${K}:sc_credit`)?.unmarked ?? 0).toBe(0)
    expect(found(A).map((f) => f.kind)).toEqual(['subscription'])
    const debts = text(await screen(A.pinia, Money, '/money/debts'))
    expect(debts).toContain('Kaspi Кредит')
    // Отметка из выписки — до ввода остатка (`operationAt`), остаток не уменьшается второй раз.
    expect(debts).toContain('450 000')
    expect(server.data.credits).toEqual([expect.objectContaining({ id, name: 'Kaspi Кредит', payment: 32_000 })])
  })
})
