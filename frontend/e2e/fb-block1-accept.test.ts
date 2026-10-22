import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { liveOpEdits, ruleMatchOf } from '../src/lib/statements/model'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation } from '../src/lib/statements/types'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, serverPush, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 1 «Операции» бэклога «Фидбек» — дороги, которых нет в e2e исполнителя (`fb-block1-operations`):
 * (а) правки пуша (заметка и «Мне вернули» наличными) сделаны на одном телефоне, а выписку, которая заменяет пуш,
 * грузит второй — правки переезжают к строке выписки на обоих телефонах, итоги остаются меньше у всех (и у партнёра),
 * повторная загрузка той же выписки их не стирает, на сервер ничего не уходит; (б) «+ Раздел» с тем же именем на
 * втором телефоне — тот же раздел, а перенос трат в новый раздел не меняет сумму месяца. Четверг 15 октября 2026, W42.
 */
type Phone = { pinia: Pinia; client: ApiClient; storage: Map<string, string> }
let cur = new Map<string, string>()
const use = (p: Phone) => {
  setActivePinia(p.pinia)
  cur = p.storage
}

async function phone(server: FakeServer, st: FakeStatements, pv: FakePrivate, user: 'u-a' | 'u-b'): Promise<Phone> {
  const storage = new Map<string, string>()
  cur = storage
  const pinia = createPinia()
  setActivePinia(pinia)
  const slot = user === 'u-a' ? 'a' : 'b'
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot), ...privateFor(pv, user), fxRates: vi.fn(async (code: string) => ({ code, rates: {}, partial: false })) } as unknown as ApiClient
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  await finance.pullPrivateDoc(client)
  await useOperationsStore().loadUploads(client)
  await useOperationsStore().pull(client)
  return { pinia, client, storage }
}

/** Часы идут: каждый шаг синка — на секунду позже (как на телефоне). */
const tick = () => vi.setSystemTime(new Date(Date.now() + 1_000))

async function sync(...phones: Phone[]) {
  for (const p of phones) {
    tick()
    use(p)
    await useOperationsStore().pull(p.client)
    tick()
    await useFinanceStore().syncHousehold(p.client)
    await useFinanceStore().syncPrivate(p.client)
    await useFinanceStore().pullHousehold(p.client)
    tick()
    await useFinanceStore().pullPrivateDoc(p.client)
  }
}

const opsOf = (p: Phone) => (use(p), useOperationsStore().all)
const finOf = (p: Phone) => (use(p), useFinanceStore())
const total = (p: Phone, id: string) => finOf(p).householdDoc.spendTotals?.find((t) => t.id === id)

const PUSH = { id: 'f000000000000001', date: '2026-10-14', amount: -30_000, merchant: 'Перевод Айгерим С.', kind: 'transfer-out', bank: 'kaspi' }
const ROW: Operation = { id: 'a000000000000001', bank: 'kaspi', date: '2026-10-14', amount: -30_000, kind: 'transfer-out', merchant: 'Айгерим С.', counterparty: 'Айгерим С.', note: 'Перевод', categoryId: null, internal: false }
const cafe = (n: number, day: number, amount: number): Operation => ({
  id: `c00000000000000${n}`, bank: 'kaspi', date: `2026-10-${String(day).padStart(2, '0')}`, amount: -amount, kind: 'purchase', merchant: ['Coffee Boom', 'Starbucks', 'Del Papa'][n - 1], categoryId: 'sc_cafe', internal: false,
})
const CAFE = [cafe(1, 2, 1_000), cafe(2, 4, 1_500), cafe(3, 6, 2_000)]
const statement = (ops: Operation[]) => [{ name: 'kaspi.pdf', parsed: { bank: 'kaspi' as const, from: '2026-10-01', to: '2026-10-15', skipped: 0, operations: ops } }]

async function upload(p: Phone, ops: Operation[]) {
  use(p)
  const store = useOperationsStore()
  store.setDraft(statement(ops))
  await store.send(p.client)
}

describe('e2e / приёмка Фидбек Блок 1 — правки пуша на другом телефоне, дубль раздела', () => {
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => cur.get(k) ?? null,
      setItem: (k: string, v: string) => cur.set(k, String(v)),
      removeItem: (k: string) => cur.delete(k),
      clear: () => cur.clear(),
    })
    vi.useFakeTimers()
    at('2026-10-15T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('(а) заметка и «Наличными» у пуша на A1 → выписку грузит A2 → правки у строки на обоих, итоги меньше у всех, повторная загрузка их не стирает', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    const B = await phone(server, st, pv, 'u-b')
    serverPush(st, 'u-a', PUSH)
    await sync(A1, A2, B)

    at('2026-10-15T08:00:00Z')
    use(A1)
    useOperationsStore().editOp(PUSH.id, { memo: 'вернула часть', refund: { amount: 10_000 } })
    await sync(A1, A2, B)
    for (const p of [A1, A2, B]) expect(total(p, 'a:week:2026-W42:sc_people')).toMatchObject({ amount: 20_000, ops: 1 })

    // Вечером выписку грузит второй телефон: строка заменяет пуш и забирает его правки.
    at('2026-10-15T15:00:00Z')
    await upload(A2, [ROW])
    await sync(A2, A1, B)
    // Хвост Х-4 (приёмка): A1 получает строку раньше её правок (операции синкаются до личного документа) и успевает
    // отправить итог без возврата — партнёр видит 30 000 до следующего синка A1, затем сходится.
    expect(total(B, 'a:week:2026-W42:sc_people')).toMatchObject({ amount: 30_000 })
    at('2026-10-15T15:05:00Z')
    await sync(A1, A2, B)
    for (const p of [A1, A2]) {
      expect(opsOf(p).map((o) => o.id)).toEqual([ROW.id])
      expect(opsOf(p)[0]).toMatchObject({ memo: 'вернула часть', refund: { amount: 10_000 } })
      expect(liveOpEdits(finOf(p).opEdits).map((e) => e.id)).toEqual([ROW.id])
    }
    for (const p of [A1, A2, B]) {
      expect(total(p, 'a:week:2026-W42:sc_people')).toMatchObject({ amount: 20_000, ops: 1 })
      expect(total(p, 'a:month:2026-10:sc_people')).toMatchObject({ amount: 20_000 })
    }

    // Та же выписка ещё раз с первого телефона — правка и итог на месте.
    at('2026-10-15T16:00:00Z')
    await upload(A1, [ROW])
    await sync(A1, A2)
    for (const p of [A1, A2]) expect(opsOf(p)[0]).toMatchObject({ memo: 'вернула часть', refund: { amount: 10_000 } })
    expect(total(A1, 'a:week:2026-W42:sc_people')).toMatchObject({ amount: 20_000 })

    // Партнёр — только итоги; на сервер правки не ушли.
    expect(opsOf(B)).toEqual([])
    expect(pv.docs.get('u-b')?.data.opEdits ?? []).toEqual([])
    expect([...(st.ops.get('u-a')?.values() ?? [])].some((o) => 'memo' in o || 'refund' in o)).toBe(false)
  })

  it('(б) «+ Раздел» с тем же именем на втором телефоне — тот же раздел; перенос трат в него не меняет сумму месяца', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    await upload(A1, CAFE)
    await sync(A1, A2)

    use(A1)
    const id = useFinanceStore().addSpendCategory('Подарки')!
    await sync(A1, A2)
    use(A2)
    expect(useFinanceStore().addSpendCategory('  подарки ')).toBe(id)
    expect(finOf(A2).householdDoc.spendCategories!.filter((c) => !c.deletedAt && c.name.toLowerCase() === 'подарки')).toHaveLength(1)

    const month = (p: Phone) => (finOf(p).householdDoc.spendTotals ?? []).filter((t) => t.kind === 'month' && t.period === '2026-10' && !t.deletedAt).reduce((s, t) => s + t.amount, 0)
    const before = month(A1)
    expect(before).toBe(4_500)
    const cafeBefore = total(A1, 'a:month:2026-10:sc_cafe')!.amount

    at('2026-10-15T08:00:00Z')
    use(A2)
    await useOperationsStore().recategorize(ruleMatchOf(opsOf(A2).find((o) => o.id === CAFE[0].id)!), { categoryId: id }, A2.client)
    await sync(A2, A1)
    expect(total(A1, `a:month:2026-10:${id}`)).toMatchObject({ amount: 1_000, ops: 1 })
    expect(total(A1, 'a:month:2026-10:sc_cafe')!.amount).toBe(cafeBefore - 1_000)
    for (const p of [A1, A2]) expect(month(p)).toBe(before)
  })
})
