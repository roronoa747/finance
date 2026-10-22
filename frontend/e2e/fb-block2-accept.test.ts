import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { spendCompare } from '../src/lib/finance'
import { handId, handOperation } from '../src/lib/statements/model'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation } from '../src/lib/statements/types'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 2 «Фидбек» (стенд на выписке владельца, синтетика): (а) «Разовая» у строки выписки на первом телефоне —
 * второй телефон и партнёр видят те же «Разовые» и строку раздела без неё; (а2) снятие со второго телефона — у всех как
 * было; (б) продавец с тремя подписками разной цены (каждый месяц, как на выписке владельца): «В платежи» у самой
 * дорогой строки заполняет её сумму, а не медианой всех строк продавца; (в) ручная разовая доходит до второго телефона; (г)
 * «В платежи»: после синка строка не трата ни у кого. (а2), (б), (г) — **возврат приёмки**, `it.fails` до починки
 * (исполнитель снимает `.fails`).
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

async function sync(...phones: Phone[]) {
  for (const p of phones) {
    use(p)
    await useOperationsStore().loadUploads(p.client)
    await useOperationsStore().pull(p.client)
    await useFinanceStore().syncHousehold(p.client)
    await useFinanceStore().syncPrivate(p.client)
    await useFinanceStore().pullHousehold(p.client)
    await useFinanceStore().pullPrivateDoc(p.client)
  }
}

const compare = (p: Phone, key: string) => {
  use(p)
  const { state, ctx } = useFinanceStore().planInput(key)
  return spendCompare(state, ctx)
}
const buy = (id: string, date: string, amount: number, merchant: string, categoryId: string | null = null): Operation => ({
  id, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false,
})
async function upload(p: Phone, from: string, to: string, ops: Operation[]) {
  use(p)
  const store = useOperationsStore()
  store.setDraft([{ name: 'kaspi.pdf', parsed: { bank: 'kaspi' as const, from, to, skipped: 0, operations: ops } }])
  await store.send(p.client)
}

describe('e2e / Фидбек Блок 2 — приёмка', () => {
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
    at('2026-09-26T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const cafeMonth = { oneOff: 0, rows: [expect.objectContaining({ categoryId: 'sc_cafe', amount: 42_000 })] }
  const EDA = buy('e000000000000001', '2026-09-21', 12_000, 'WOLT', 'sc_cafe')
  async function marked() {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    const B = await phone(server, st, pv, 'u-b')
    await upload(A1, '2026-09-01', '2026-09-26', [buy('e000000000000002', '2026-09-10', 30_000, 'COFFEE BOOM', 'sc_cafe'), EDA])
    await sync(A1, A2, B)
    for (const p of [A1, A2, B]) expect(compare(p, '2026-09')).toMatchObject(cafeMonth)
    use(A1)
    at('2026-09-26T07:05:00Z')
    useOperationsStore().editOp(EDA.id, { oneOff: true })
    await sync(A1, A2, B)
    return { A1, A2, B }
  }

  it('(а) «Разовая» у строки выписки: второй телефон и партнёр — те же «Разовые», строка раздела без неё', async () => {
    const { A1, A2, B } = await marked()
    for (const p of [A1, A2, B]) {
      const c = compare(p, '2026-09')
      expect(c.oneOff).toBe(12_000)
      expect(c.rows.find((r) => r.categoryId === 'sc_cafe')?.amount).toBe(30_000)
    }
    use(A2)
    expect(useOperationsStore().all.find((o) => o.id === EDA.id)?.oneOff).toBe(true)
    expect(pv.docs.get('u-b')?.data.opEdits ?? []).toEqual([])
  })

  // Возврат приёмки: итог без разовых пишется без поля `oneOff`, а слияние (`mergeList`, правило 3) оставляет поле
  // проигравшего — старые «Разовые» возвращаются всем, и тому, кто снял (стенд: на сервере `oneOff` остался при снятой правке).
  it('(а2) снятая «Разовая» со второго телефона — у всех как было (возврат приёмки)', async () => {
    const { A1, A2, B } = await marked()
    use(A2)
    at('2026-09-26T07:10:00Z')
    useOperationsStore().editOp(EDA.id, { oneOff: null })
    await sync(A2, A1, B)
    for (const p of [A1, A2, B]) expect(compare(p, '2026-09')).toMatchObject(cafeMonth)
  })

  it('(в) ручная разовая на A1 — второй телефон после синка видит те же «Разовые»', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    await upload(A1, '2026-09-01', '2026-09-26', [buy('e000000000000002', '2026-09-10', 30_000, 'COFFEE BOOM', 'sc_cafe')])
    await sync(A1, A2)
    use(A1)
    at('2026-09-26T07:05:00Z')
    const gifts = useFinanceStore().addSpendCategory('Подарки')!
    const hand = handOperation({ id: handId(), amount: 25_000, categoryId: gifts, date: '2026-09-26', note: '' }, 'Подарки')
    await useOperationsStore().saveHand(hand, { oneOff: true }, A1.client)
    await sync(A1)
    at('2026-09-26T07:06:00Z')
    await sync(A2, A1)
    for (const p of [A1, A2]) expect(compare(p, '2026-09').oneOff).toBe(25_000)
  })

  // Возврат приёмки: та же причина, что (а2), — отмеченная строка платежа пишет итог без `unmarked`, слияние возвращает
  // прежний `unmarked`: после синка подписка снова трата и у того, кто нажал «В платежи», и у партнёра.
  it('(г) «В платежи»: после синка строка не трата ни у Ильяса, ни у партнёра (возврат приёмки)', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const B = await phone(server, st, pv, 'u-b')
    await upload(A1, '2026-09-01', '2026-09-26', [buy('f000000000000001', '2026-09-14', 4_990, 'APPLE.COM BILL')])
    await sync(A1, B)
    const unmarked = (p: Phone) => (use(p), useFinanceStore().householdDoc.spendTotals?.find((t) => t.id === 'a:month:2026-09:sc_subscriptions')?.unmarked ?? 0)
    expect(unmarked(B)).toBe(4_990)
    use(A1)
    at('2026-09-26T07:05:00Z')
    const id = useFinanceStore().addObligation({ name: 'Apple Music', note: '', day: 14, category: 'd4', amount: 4_990 })
    await useOperationsStore().addToPayments('f000000000000001', id, A1.client)
    await sync(A1, B, A1)
    expect([unmarked(A1), unmarked(B)]).toEqual([0, 0])
  })

  it.fails('(б) три подписки у одного продавца: «В платежи» у дорогой строки — её сумма и день (возврат приёмки)', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const ops: Operation[] = []
    for (const [i, m] of ['07', '08', '09'].entries()) {
      ops.push(buy(`a${i}00000000000001`, `2026-${m}-15`, 2_490, 'APPLE.COM BILL'))
      ops.push(buy(`a${i}00000000000002`, `2026-${m}-20`, 990, 'APPLE.COM BILL'))
      ops.push(buy(`a${i}00000000000003`, `2026-${m}-20`, 5_500, 'APPLE.COM BILL'))
    }
    await upload(A1, '2026-07-01', '2026-09-26', ops)
    use(A1)
    const store = useOperationsStore()
    const row = store.all.find((o) => o.id === 'a200000000000003')!
    expect(store.recurringFor(row)).toMatchObject({ amount: 5_500, day: 20 })
  })
})
