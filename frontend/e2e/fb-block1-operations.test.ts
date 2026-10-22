import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { ruleMatchOf, unknownGroups } from '../src/lib/statements/model'
import { sectionMonth } from '../src/lib/finance'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation } from '../src/lib/statements/types'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, serverPush, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 1 «Операции» бэклога «Фидбек» (FB-06): два телефона одного человека (A1, A2 — свои хранилища) и партнёр (B).
 * Пуш перевода и строка выписки о нём — один ключ, вопроса нет, ответ держится; «Мне вернули» переводом — итоги меньше
 * у обоих телефонов, партнёр видит только итог раздела и правок не видит; заметка — на втором телефоне; «+ Раздел» —
 * у партнёра; лист раздела «Месяца» — операции и «Ещё N». Четверг 15 октября 2026, неделя W42. Синтетика.
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

/** Синк телефона: операции, общий и личный документы. */
async function sync(...phones: Phone[]) {
  for (const p of phones) {
    use(p)
    await useOperationsStore().pull(p.client)
    await useFinanceStore().syncHousehold(p.client)
    await useFinanceStore().syncPrivate(p.client)
    // Чужие правки — с сервера (синк сам только отправляет своё).
    await useFinanceStore().pullHousehold(p.client)
    await useFinanceStore().pullPrivateDoc(p.client)
  }
}

const opsOf = (p: Phone) => (use(p), useOperationsStore().all)
const finOf = (p: Phone) => (use(p), useFinanceStore())
const total = (p: Phone, id: string) => finOf(p).householdDoc.spendTotals?.find((t) => t.id === id)

const PUSH = { id: 'f000000000000001', date: '2026-10-14', amount: -30_000, merchant: 'Перевод Айгерим С.', kind: 'transfer-out', bank: 'kaspi' }
const ROW: Operation = { id: 'a000000000000001', bank: 'kaspi', date: '2026-10-14', amount: -30_000, kind: 'transfer-out', merchant: 'Айгерим С.', counterparty: 'Айгерим С.', note: 'Перевод', categoryId: null, internal: false }
const BACK: Operation = { id: 'a000000000000002', bank: 'kaspi', date: '2026-10-15', amount: 30_000, kind: 'transfer-in', merchant: 'Айгерим С.', counterparty: 'Айгерим С.', note: 'Перевод', categoryId: null, internal: false }
const cafe = (n: number, day: number, amount: number): Operation => ({
  id: `c00000000000000${n}`, bank: 'kaspi', date: `2026-10-${String(day).padStart(2, '0')}`, amount: -amount, kind: 'purchase', merchant: `Кофейня ${n}`, categoryId: 'sc_cafe', internal: false,
})
const CAFE = [cafe(1, 2, 1_000), cafe(2, 4, 1_500), cafe(3, 6, 2_000), cafe(4, 8, 2_500), cafe(5, 10, 3_000), cafe(6, 12, 3_500), cafe(7, 13, 4_000)]
const statement = (ops: Operation[]) => [{ name: 'kaspi.pdf', parsed: { bank: 'kaspi' as const, from: '2026-10-01', to: '2026-10-15', skipped: 0, operations: ops } }]

async function upload(p: Phone, ops: Operation[]) {
  use(p)
  const store = useOperationsStore()
  store.setDraft(statement(ops))
  await store.send(p.client)
}

describe('e2e / Фидбек Блок 1 — операции на двух телефонах и у партнёра', () => {
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

  it('(а) пуш «Перевод Имя Ф.» и строка выписки о нём — вопроса нет, ответ один на оба и держится после синка и повторной загрузки', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    serverPush(st, 'u-a', PUSH)
    await sync(A1, A2)
    // Пуш — «Переводы людям», в пачке «Без раздела» его нет ни на одном телефоне.
    for (const p of [A1, A2]) {
      expect(opsOf(p).find((o) => o.id === PUSH.id)).toMatchObject({ counterparty: 'Айгерим С.', categoryId: 'sc_people' })
      expect(unknownGroups(opsOf(p))).toEqual([])
    }
    // Ответ на A1 из листа операции: «Прочее» (возврат долга — свой раздел семьи) — правило по получателю.
    use(A1)
    await useOperationsStore().recategorize(ruleMatchOf(opsOf(A1).find((o) => o.id === PUSH.id)!), { categoryId: 'sc_other' }, A1.client)
    await sync(A1, A2)
    // Выписку загружает второй телефон: строка заменяет пуш и берёт ответ.
    await upload(A2, [ROW])
    await sync(A2, A1)
    for (const p of [A1, A2]) {
      expect(opsOf(p).map((o) => o.id)).toEqual([ROW.id])
      expect(opsOf(p)[0].categoryId).toBe('sc_other')
      expect(unknownGroups(opsOf(p))).toEqual([])
    }
    expect(finOf(A1).merchantRules.map((r) => r.match)).toEqual([{ counterparty: 'айгерим с.' }])
    // Та же выписка ещё раз — ничего не меняется.
    await upload(A1, [ROW])
    expect(opsOf(A1)[0].categoryId).toBe('sc_other')
    expect(total(A1, 'a:week:2026-W42:sc_other')).toMatchObject({ amount: 30_000, ops: 1 })
  })

  it('(б) «Мне вернули» переводом — неделя и месяц меньше у обоих телефонов; партнёр видит только итог, правок у него нет; (в) заметка — на втором телефоне', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    const B = await phone(server, st, pv, 'u-b')
    await upload(A1, [ROW, BACK])
    await sync(A1, A2, B)
    expect(total(B, 'a:month:2026-10:sc_people')).toMatchObject({ amount: 30_000 })

    // Правка — позже загрузки (часы теста стоят, а слияние итогов — по времени правки).
    at('2026-10-15T08:00:00Z')
    use(A1)
    const store = useOperationsStore()
    const incomes = store.refundsFor(opsOf(A1).find((o) => o.id === ROW.id)!)
    expect(incomes.map((o) => o.id)).toEqual([BACK.id])
    store.editOp(ROW.id, { refund: { amount: 30_000, opId: BACK.id }, memo: 'вернула долг' })
    await sync(A1, A2, B)

    for (const p of [A1, A2]) {
      expect(total(p, 'a:week:2026-W42:sc_people')).toMatchObject({ amount: 0, ops: 1 })
      expect(total(p, 'a:month:2026-10:sc_people')).toMatchObject({ amount: 0, ops: 1 })
      expect(opsOf(p).find((o) => o.id === ROW.id)).toMatchObject({ memo: 'вернула долг', refund: { amount: 30_000, opId: BACK.id } })
      expect(opsOf(p).find((o) => o.id === BACK.id)?.internal).toBe(true)
    }
    // Партнёр: итог раздела — 0, операций Ильяса и правок нет.
    expect(total(B, 'a:month:2026-10:sc_people')).toMatchObject({ amount: 0 })
    expect(opsOf(B)).toEqual([])
    expect(pv.docs.get('u-b')?.data.opEdits ?? []).toEqual([])
    expect((pv.docs.get('u-a')?.data.opEdits as unknown[]).length).toBe(1)
    // На сервер правки не ушли.
    expect([...(st.ops.get('u-a')?.values() ?? [])].some((o) => 'memo' in o || 'refund' in o)).toBe(false)
    expect(st.ops.get('u-a')?.get(BACK.id)?.internal).toBe(false)
  })

  it('(г) «+ Раздел» из листа — у партнёра; (д) лист раздела «Месяца» — свои операции и «Ещё N»', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const B = await phone(server, st, pv, 'u-b')
    await upload(A1, CAFE)
    use(A1)
    const id = useFinanceStore().addSpendCategory('Подарки')!
    await sync(A1, B)
    expect(finOf(B).householdDoc.spendCategories!.find((c) => c.id === id)?.name).toBe('Подарки')

    use(A1)
    const m = sectionMonth(useOperationsStore().shown, { month: '2026-10', categoryId: 'sc_cafe' })
    // 1 000 + 1 500 + 2 000 + 2 500 + 3 000 + 3 500 + 4 000 = 17 500; видно 5 свежих, «Ещё 2 · 2 500».
    expect(m).toMatchObject({ total: 17_500, count: 7, more: { count: 2, amount: 2_500 } })
    expect(m.total).toBe(total(A1, 'a:month:2026-10:sc_cafe')!.amount)
    // У партнёра своих операций в этом разделе нет — лист без блока.
    use(B)
    expect(sectionMonth(useOperationsStore().shown, { month: '2026-10', categoryId: 'sc_cafe' }).count).toBe(0)
  })
})
