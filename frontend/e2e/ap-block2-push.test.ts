import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { assignIds, unknownGroups } from '../src/lib/statements/model'
import { useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { WalletStatus } from '../src/types/api'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, screen, serverPush, serverTap, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 2 «Пуши банков» бэклога «Apple Pay» (AP-12): пуши пишет сервер (`serverPush` — как `InsertPhoneOperation` Go:
 * склейка с касанием и пара «перевод себе»), телефон подтягивает и раскладывает так же, как касания; приход зарплаты —
 * точка «Пришла?» у зарплаты; выписка заменяет. Четверг 15 октября 2026: неделя 12–18 (W42), зарплата Ильяса — 10-го.
 * Суммы и имена — синтетические.
 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const STATUS: WalletStatus = {
  connected: true, phones: 1,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
  push_shortcut_url: 'https://www.icloud.com/shortcuts/stub-push',
}

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
  const client = {
    ...backend(server), ...statementsFor(st, user, slot),
    walletStatus: vi.fn(async () => ({ ...STATUS })),
    fxRates: vi.fn(async (code: string) => ({ code, rates: {}, partial: false })),
  } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  useApplePayStore().userAgent = IPHONE
  await useApplePayStore().load(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

async function pull(p: Phone) {
  setActivePinia(p.pinia)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}

const weekTotal = (p: Phone) =>
  (p.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W42').reduce((a, t) => a + t.amount, 0)
const opsOf = (p: Phone) => {
  setActivePinia(p.pinia)
  return useOperationsStore().all
}
const minutes = (n: number) => at(new Date(Date.now() + n * 60_000).toISOString())
const purchase = (id: string, amount: number, merchant: string, bank = 'kaspi', date = '2026-10-15') => ({ id, date, amount, merchant, kind: 'purchase', bank })

describe('e2e / Apple Pay Блок 2 — пуши банков', () => {
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
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('пуш покупки → трата в «Неделе»; касание + пуш одной покупки → одна операция с банком пуша', async () => {
    const A = await phone(server, st, 'a')
    expect(serverPush(st, 'u-a', purchase('b000000000000001', -3_000, 'MAGNUM'))).toBe('saved')
    await pull(A)
    expect(weekTotal(A)).toBe(3_000)
    expect(opsOf(A).find((o) => o.id === 'b000000000000001')).toMatchObject({ source: 'push', categoryId: 'sc_food' })

    minutes(5)
    serverTap(st, 'u-a', { id: 'b000000000000002', bank: 'card', date: '2026-10-15', amount: -2_500, merchant: 'Small' })
    minutes(3)
    expect(serverPush(st, 'u-a', purchase('b000000000000003', -2_500, 'SMALL 7'))).toBe('duplicate')
    await pull(A)
    const phoneOps = opsOf(A).filter((o) => o.source)
    expect(phoneOps).toHaveLength(2)
    expect(phoneOps.find((o) => o.id === 'b000000000000002')).toMatchObject({ bank: 'kaspi', merchant: 'Small', source: 'tap' })
    expect(weekTotal(A)).toBe(5_500)
  })

  it('перевод себе Kaspi → Freedom — не трата, итог недели не вырос; перевод человеку — трата «Без раздела»', async () => {
    const A = await phone(server, st, 'a')
    serverPush(st, 'u-a', { id: 'c000000000000001', date: '2026-10-15', amount: -20_000, merchant: 'Перевод', kind: 'transfer-out', bank: 'kaspi' })
    // Телефон подтянул списание раньше, чем пришло пополнение: пока это трата.
    await pull(A)
    expect(weekTotal(A)).toBe(20_000)
    minutes(4)
    serverPush(st, 'u-a', { id: 'c000000000000002', date: '2026-10-15', amount: 20_000, merchant: 'Пополнение', kind: 'transfer-in', bank: 'freedom' })
    await pull(A)
    expect(opsOf(A).filter((o) => o.id.startsWith('c0')).every((o) => o.internal)).toBe(true)
    expect(weekTotal(A)).toBe(0)

    minutes(30)
    serverPush(st, 'u-a', { id: 'c000000000000003', date: '2026-10-15', amount: -7_000, merchant: 'Перевод Айгерим С.', kind: 'transfer-out', bank: 'freedom' })
    await pull(A)
    expect(weekTotal(A)).toBe(7_000)
    expect(unknownGroups(opsOf(A)).map((g) => g.label)).toEqual(['Перевод Айгерим С.'])
  })

  it('приход зарплаты из пуша → точка у «Пришла» Ильяса; «Пришла» — отметка суммой прихода, точка ушла; у Аруны точки нет', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    serverPush(st, 'u-a', { id: 'd000000000000001', date: '2026-10-14', amount: 690_000, merchant: 'Зарплата', kind: 'income', bank: 'freedom' })
    await pull(A)
    setActivePinia(A.pinia)
    const arrival = useOperationsStore().salaryArrival('a', '2026-10')
    expect(arrival?.op.id).toBe('d000000000000001')
    expect(await screen(A.pinia, Month, '/month')).toContain('data-arrival-dot')
    // Приход — не трата.
    expect(weekTotal(A)).toBe(0)

    setActivePinia(A.pinia)
    await useOperationsStore().acceptMatch(arrival!.candidate, A.client)
    await A.store.syncHousehold(A.client)
    expect(A.store.payments.find((p) => p.kind === 'salary' && p.targetId === 'a' && p.period === '2026-10' && !p.deletedAt)).toMatchObject({
      amount: 690_000, opId: 'd000000000000001',
    })
    expect(await screen(A.pinia, Month, '/month')).not.toContain('data-arrival-dot')

    // Аруна: операции Ильяса ей не видны — точки нет ни у кого.
    await pull(B)
    expect(await screen(B.pinia, Month, '/month')).not.toContain('data-arrival-dot')
    expect(B.store.payments.some((p) => p.kind === 'salary' && p.targetId === 'a' && p.period === '2026-10')).toBe(true)
  })

  it('выписка с покупкой из пуша — одна операция, пуш убран надгробием', async () => {
    const A = await phone(server, st, 'a')
    serverPush(st, 'u-a', purchase('e000000000000001', -5_000, 'MAGNUM', 'kaspi', '2026-10-13'))
    await pull(A)
    const operations: Omit<Operation, 'id'>[] = [
      { bank: 'kaspi', date: '2026-10-13', amount: -5_000, kind: 'purchase', merchant: 'MAGNUM ALMATY KZ', categoryId: null, internal: false },
    ]
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-10-01', to: '2026-10-14', skipped: 0, operations: assignIds(operations) }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'kaspi.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)
    expect(opsOf(A).filter((o) => o.source)).toEqual([])
    expect(weekTotal(A)).toBe(5_000)
    expect(st.ops.get('u-a')!.get('e000000000000001')).toMatchObject({ deleted: true, source: 'push' })
  })
})
