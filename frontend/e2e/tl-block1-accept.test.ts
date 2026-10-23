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
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 1 «Хвосты» (TL-01…TL-03; Р-1…Р-3) — то, чего нет в `tl-block1-found-payments`:
 *   (а) садик одной суммой два месяца подряд — в «нашли» вместе со словарными подпиской и кредитом; кофейня, такси,
 *       магазин за три месяца — мимо; садик со вторым списанием в одном месяце — мимо (Р-1);
 *   (б) две подписки одного продавца заведены, в следующем месяце одна подорожала (4 990 → 5 900): дешёвая отмечена сама,
 *       подорожавшая остаётся в «Подписках» (не трата) и даёт находку «Подорожало» по своей цели (Р-2);
 *   (в) одно правило «продавец целиком» — как до блока: следующая строка отмечается сама.
 * Новая семья на моках, пятница 23 октября 2026.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const op = (date: string, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const statement = (ops: Omit<Operation, 'id'>[], from: string, to: string): ParsedStatement => ({ bank: 'kaspi', from, to, skipped: 0, operations: assignIds(ops) })
const d = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}`
const MONTHS = ['2026-08', '2026-09', '2026-10']
const NOISE = () => MONTHS.flatMap((m) => [
  ...[1, 2, 8, 9, 15].map((x) => op(d(m, x), -2_500, 'Coffee Boom', 'sc_cafe')),
  ...[5, 12, 19].map((x) => op(d(m, x), -3_000, 'Yandex Go', 'sc_transport')),
  op(d(m, 3), -12_400, 'Magnum', 'sc_food'), op(d(m, 17), -9_300, 'Magnum', 'sc_food'),
  op(d(m, 7), -3_990, 'NETFLIX.COM', 'sc_subscriptions'),
  op(d(m, 5), -32_000, 'Kaspi Кредит', 'sc_credit'),
])

describe('e2e / приёмка Хвосты Блок 1 — платежи из выписки', () => {
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
  const found = (p: Phone) => {
    setActivePinia(p.pinia)
    return foundPayments(useOperationsStore().all, { rules: p.store.merchantRules, payments: p.store.payments, today: todayIso() })
  }

  it('(а) три месяца выписки: «нашли» — садик, кредит, подписка; кофейня, такси, магазин — мимо', async () => {
    const A = await phone()
    const kid = MONTHS.slice(1).map((m) => op(d(m, 1), -40_000, 'ИП Солнышко', null, { kind: 'transfer-out' }))
    await uploaded(A, statement([...NOISE(), ...kid], '2026-08-01', '2026-10-22'))
    expect(found(A).map((f) => [f.name, f.amount, f.kind]).sort()).toEqual([
      ['Kaspi Кредит', 32_000, 'credit'], ['NETFLIX.COM', 3_990, 'subscription'], ['Солнышко', 40_000, 'obligation'],
    ].sort())
  })

  it('(а) садик со вторым списанием в октябре — мимо (ровно одно в месяц)', async () => {
    const A = await phone()
    const kid = [op('2026-09-01', -40_000, 'ИП Солнышко', null, { kind: 'transfer-out' }), op('2026-10-01', -40_000, 'ИП Солнышко', null, { kind: 'transfer-out' }), op('2026-10-15', -40_000, 'ИП Солнышко', null, { kind: 'transfer-out' })]
    await uploaded(A, statement([...NOISE(), ...kid], '2026-08-01', '2026-10-22'))
    expect(found(A).map((f) => f.kind).sort()).toEqual(['credit', 'subscription'])
  })

  it('(б) две подписки продавца, в ноябре одна подорожала: дешёвая отмечена, дорогая — в «Подписках» и «Подорожало» по своей цели', async () => {
    const A = await phone()
    const apple = (date: string, amount: number) => op(date, -amount, 'APPLE.COM BILL', 'sc_subscriptions')
    await uploaded(A, statement([apple('2026-09-02', 1_990), apple('2026-09-14', 4_990), apple('2026-10-02', 1_990), apple('2026-10-14', 4_990)], '2026-09-01', '2026-10-22'))
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const line = (amount: number, month: string) => ops.all.find((o) => o.amount === -amount && o.date.startsWith(month))!
    for (const [amount, name] of [[1_990, 'Apple Music'], [4_990, 'iCloud']] as const) {
      const pre = ops.recurringFor(line(amount, '2026-10'))!
      expect(pre).toMatchObject({ amount, kind: 'subscription' })
      const id = A.store.addObligation({ name, note: 'ежемесячно', day: pre.day, category: 'd4', every: 'month', amount })
      await ops.addToPayments(line(amount, '2026-10').id, id, A.client)
    }
    await A.store.syncHousehold(A.client)
    const [music, cloud] = A.store.obligations.map((o) => o.id)

    at('2026-11-20T07:00:00Z')
    await uploaded(A, statement([apple('2026-11-02', 1_990), apple('2026-11-14', 5_900)], '2026-11-01', '2026-11-19'))
    const nov = (id: string) => A.store.payments.filter((p) => !p.deletedAt && p.targetId === id && p.period === '2026-11')
    expect(nov(music)).toEqual([expect.objectContaining({ amount: 1_990 })])
    expect(nov(cloud)).toEqual([])
    expect(line(5_900, '2026-11').categoryId).toBe('sc_subscriptions')
    const pricier = (A.store.householdDoc.reviewFinds ?? []).filter((f) => f.kind === 'pricier' && f.period === '2026-11' && f.amount)
    expect(pricier.map((f) => [f.amount, f.was, f.targetId])).toEqual([[5_900, 4_990, cloud]])
  })

  it('(в) одно правило «продавец целиком»: следующая строка продавца отмечается сама', async () => {
    const A = await phone()
    await uploaded(A, statement([op('2026-09-07', -3_990, 'NETFLIX.COM', 'sc_subscriptions'), op('2026-10-07', -3_990, 'NETFLIX.COM', 'sc_subscriptions')], '2026-09-01', '2026-10-22'))
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const [f] = found(A)
    const id = A.store.addObligation({ name: 'Netflix', note: 'ежемесячно', day: f.day, category: 'd4', every: 'month', amount: f.amount })
    await ops.addToPayments(f.opId, id, A.client)
    expect(A.store.merchantRules.filter((r) => !r.deletedAt && 'payment' in r.to)).toHaveLength(1)
    at('2026-11-20T07:00:00Z')
    await uploaded(A, statement([op('2026-11-07', -3_990, 'NETFLIX.COM', 'sc_subscriptions')], '2026-11-01', '2026-11-19'))
    expect(A.store.payments.filter((p) => !p.deletedAt && p.targetId === id && p.period === '2026-11')).toEqual([expect.objectContaining({ amount: 3_990 })])
  })
})
