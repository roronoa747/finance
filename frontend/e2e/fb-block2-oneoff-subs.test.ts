import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { handId, handOperation, ruleMatchOf } from '../src/lib/statements/model'
import { spendCompare, usualSpend } from '../src/lib/finance'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation } from '../src/lib/statements/types'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 2 «Разовые и подписки» бэклога «Фидбек» (FB-10): (а) Р-9 — «Трата» в новом разделе «Подарки» с «Разовая»: неделя
 * с ней, «Месяц» — в «Разовые», не строкой раздела; партнёр видит «Разовые» и раздел «Подарки»; (б) разовая не в «обычно»
 * следующего месяца и не в находках документа; (в) две строки APPLE.COM BILL → «В платежи» → третья в следующей выписке
 * отмечена сама; второй телефон видит платёж и отметки. Синтетика.
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
    await useOperationsStore().loadUploads(p.client)
    await useOperationsStore().pull(p.client)
    await useFinanceStore().syncHousehold(p.client)
    await useFinanceStore().syncPrivate(p.client)
    await useFinanceStore().pullHousehold(p.client)
    await useFinanceStore().pullPrivateDoc(p.client)
  }
}

const finOf = (p: Phone) => (use(p), useFinanceStore())
const total = (p: Phone, id: string) => finOf(p).householdDoc.spendTotals?.find((t) => t.id === id)
const compare = (p: Phone, key: string) => {
  const { state, ctx } = finOf(p).planInput(key)
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

describe('e2e / Фидбек Блок 2 — разовые и «В платежи»', () => {
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

  it('(а) Р-9: «Трата» → «+ Раздел» «Подарки» → «Разовая» → «Сохранить»: «Неделя» с ней, «Месяц» — «Разовые», раздела-строки нет; партнёр видит «Разовые» и «Подарки»', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const B = await phone(server, st, pv, 'u-b')
    await upload(A1, '2026-10-01', '2026-10-15', [buy('c000000000000001', '2026-10-05', 12_000, 'Кофейня', 'sc_cafe')])
    use(A1)
    const gifts = useFinanceStore().addSpendCategory('Подарки')!
    const hand = handOperation({ id: handId(), amount: 50_000, categoryId: gifts, date: '2026-10-14', note: 'Маме' }, 'Подарки')
    await useOperationsStore().saveHand(hand, { oneOff: true }, A1.client)
    await sync(A1, B)

    // «Неделя» — мои траты, с разовой (Р-16).
    expect(total(A1, `a:week:2026-W42:${gifts}`)).toMatchObject({ amount: 50_000, oneOff: 50_000 })
    // «Месяц»: строки «Подарки» нет, «Разовые» 50 000; строки + «Разовые» = потрачено.
    for (const p of [A1, B]) {
      const c = compare(p, '2026-10')
      expect(c.rows.find((r) => r.categoryId === gifts)).toBeUndefined()
      expect(c.oneOff).toBe(50_000)
      expect(c.rows.find((r) => r.categoryId === 'sc_cafe')?.amount).toBe(12_000)
    }
    expect(finOf(B).householdDoc.spendCategories!.find((c) => c.id === gifts)?.name).toBe('Подарки')
    // Правка — в личном документе Ильяса, у партнёра её нет; на сервер флаг не ушёл.
    expect(pv.docs.get('u-b')?.data.opEdits ?? []).toEqual([])
    expect([...(st.ops.get('u-a')?.values() ?? [])].some((o) => 'oneOff' in o)).toBe(false)
  })

  it('(б) разовая не в «обычно» следующего месяца и не в находках документа', async () => {
    at('2026-11-02T07:00:00Z')
    const A1 = await phone(server, st, pv, 'u-a')
    const DIVAN = buy('d000000000000001', '2026-10-20', 300_000, 'DIVAN STORE', 'sc_home')
    await upload(A1, '2026-09-01', '2026-10-31', [
      buy('h000000000000001', '2026-09-10', 20_000, 'LEROY MERLIN', 'sc_home'),
      buy('h000000000000002', '2026-10-10', 20_000, 'LEROY MERLIN', 'sc_home'),
      DIVAN,
    ])
    use(A1)
    // «Диван» словарь не знает — семья относит его к «Дому» ответом (правило по продавцу).
    await useOperationsStore().recategorize(ruleMatchOf(DIVAN), { categoryId: 'sc_home' }, A1.client)
    expect(useFinanceStore().householdDoc.reviewFinds?.some((f) => f.top?.some((t) => t.name === 'DIVAN STORE'))).toBe(true)
    at('2026-11-02T08:00:00Z')
    useOperationsStore().editOp(DIVAN.id, { oneOff: true })
    await sync(A1)

    const { state, ctx } = finOf(A1).planInput('2026-11')
    // Обычно «Дом»: (20 000 + 20 000) / 2 — без дивана.
    expect(usualSpend(state.people ?? [], ctx.totals, ctx.spendCategories, ctx.uploads, '2026-11')?.amounts.get('sc_home')).toBe(20_000)
    const finds = finOf(A1).householdDoc.reviewFinds ?? []
    expect(finds.some((f) => f.name === 'DIVAN STORE' || f.top?.some((t) => t.name === 'DIVAN STORE'))).toBe(false)
    expect(finds.find((f) => f.kind === 'top' && f.period === '2026-10' && f.categoryId === 'sc_home')).toMatchObject({ amount: 20_000, count: 1 })
  })

  it('(в) две строки APPLE.COM BILL → «В платежи» → третья в следующей выписке отмечена сама; второй телефон — платёж и отметки', async () => {
    const A1 = await phone(server, st, pv, 'u-a')
    const A2 = await phone(server, st, pv, 'u-a')
    await upload(A1, '2026-08-01', '2026-09-30', [buy('e000000000000001', '2026-08-14', 4_990, 'APPLE.COM BILL'), buy('e000000000000002', '2026-09-14', 4_990, 'APPLE.COM BILL')])
    use(A1)
    const store = useOperationsStore()
    const line = store.all.find((o) => o.id === 'e000000000000002')!
    const prefill = store.recurringFor(line)!
    expect(prefill).toMatchObject({ name: 'APPLE.COM BILL', amount: 4_990, day: 14 })
    // Форма: имя переписано, «Добавить» → платёж d4, затем отметка и правило.
    const id = useFinanceStore().addObligation({ name: 'Apple Music', note: 'ежемесячно', day: prefill.day, category: 'd4', amount: prefill.amount })
    await store.addToPayments(line.id, id, A1.client)
    expect(store.recurringFor(line)).toBeNull()
    await sync(A1, A2)

    await upload(A2, '2026-10-01', '2026-10-15', [buy('e000000000000003', '2026-10-14', 4_990, 'APPLE.COM BILL')])
    use(A2)
    expect(useOperationsStore().lastAutoMarked).toBe(1)
    await sync(A2, A1)
    for (const p of [A1, A2]) {
      const fin = finOf(p)
      expect(fin.obligations.find((o) => o.id === id)?.name).toBe('Apple Music')
      expect(fin.payments.filter((x) => !x.deletedAt && x.targetId === id).map((x) => [x.period, x.opId])).toEqual([
        ['2026-09', 'e000000000000002'],
        ['2026-10', 'e000000000000003'],
      ])
      // Строки отмеченного платежа — не траты раздела.
      expect(total(p, 'a:month:2026-10:sc_subscriptions')?.unmarked ?? 0).toBe(0)
    }
  })
})
