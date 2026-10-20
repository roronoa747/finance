import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import { DEMO_TOKEN, useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { PHONE_PULL_MS, UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { at, backend, fakeServer, fakeStatements, serverTap, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 1 «Касание» бэклога «Apple Pay» (2026-10-16): сценарии, которых не было в `ap-block1-tap` — замена
 * выпиской настоящим путём загрузки (тост «Отменить», `upload` → `commitUpload` → `send`) с итогом Аруны в каждой
 * фазе; «Отменить» ничего не убирает; правила Р-16 одной выпиской на двух телефонах Ильяса; возврат в приложение
 * подтягивает не чаще раза в 30 с, у viewer и в демо — никогда. Четверг 15 октября 2026: неделя 12–18 (W42).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore>; list: ReturnType<typeof vi.fn> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', o: { role?: 'member' | 'viewer'; demo?: boolean } = {}): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const role = o.role ?? 'member'
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: o.demo ? DEMO_TOKEN : `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const ops = statementsFor(st, user, slot)
  const client = { ...backend(server), ...ops, fxRates: vi.fn(async () => { throw new Error('offline') }) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const operations = useOperationsStore()
  await operations.loadUploads(client)
  await operations.pull(client)
  return { pinia, client, store, list: ops.listOperations }
}

async function pull(p: Phone) {
  setActivePinia(p.pinia)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}

/** Итог недели W42 Ильяса — из документа семьи (у партнёра) или с выпиской, ждущей тост (у Ильяса, `shownTotals`). */
const sum = (totals: { by: string; kind: string; period: string; amount: number }[]) =>
  totals.filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W42').reduce((a, t) => a + t.amount, 0)
const docWeek = (p: Phone) => sum(p.store.householdDoc.spendTotals ?? [])
const shownWeek = (p: Phone) => {
  setActivePinia(p.pinia)
  return sum(useOperationsStore().shownTotals)
}
const opsOf = (p: Phone) => {
  setActivePinia(p.pinia)
  return useOperationsStore().all
}
const line = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...extra,
})
const statement = (lines: Omit<Operation, 'id'>[], to = '2026-10-14'): ParsedStatement => ({
  bank: 'kaspi', from: '2026-10-01', to, skipped: 0, operations: assignIds(lines),
})

describe('e2e / Apple Pay Блок 1 — приёмка', () => {
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

  it('выписка через загрузку с тостом: у Ильяса и у Аруны 5 000, а не 10 000 — во время тоста и после; надгробие — только после тоста', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    serverTap(st, 'u-a', { id: 'a100000000000001', date: '2026-10-13', amount: -5_000, merchant: 'Magnum' })
    await pull(A)
    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(docWeek(B)).toBe(5_000)

    setActivePinia(A.pinia)
    await useOperationsStore().upload([{ name: 'kaspi.pdf', parsed: statement([line('2026-10-13', -5_000, 'MAGNUM ALMATY KZ')]) }], A.client)
    // Тост висит (половина срока): Ильяс видит неделю уже без дубля, сервер ничего необратимого не получил.
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS / 2)
    expect(useOperationsStore().held).toBe(true)
    expect(shownWeek(A)).toBe(5_000)
    expect(st.ops.get('u-a')!.get('a100000000000001')!.deleted).toBeUndefined()
    expect([...st.ops.get('u-a')!.values()].filter((o) => !o.source)).toEqual([])
    await A.store.syncHousehold(A.client)
    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(docWeek(B)).toBe(5_000)

    // Тост ушёл: выписка отправлена, касание — надгробием; итоги у обоих — одна покупка.
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS + 100)
    expect(st.ops.get('u-a')!.get('a100000000000001')).toMatchObject({ deleted: true, source: 'tap' })
    expect(opsOf(A).map((o) => o.merchant)).toEqual(['MAGNUM ALMATY KZ'])
    await A.store.syncHousehold(A.client)
    expect(docWeek(A)).toBe(5_000)
    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(docWeek(B)).toBe(5_000)
    await useOperationsStore().pull(B.client)
    expect(opsOf(B)).toEqual([])
  })

  it('«Отменить» в тосте: касание на месте, надгробия и строк выписки на сервере нет, итог прежний', async () => {
    const A = await phone(server, st, 'a')
    serverTap(st, 'u-a', { id: 'a100000000000002', date: '2026-10-13', amount: -5_000, merchant: 'Magnum' })
    serverTap(st, 'u-a', { id: 'a100000000000003', date: '2026-10-12', amount: -777, merchant: 'Отклонённая' })
    await pull(A)
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'kaspi.pdf', parsed: statement([line('2026-10-13', -5_000, 'MAGNUM ALMATY KZ')]) }], A.client)
    expect(shownWeek(A)).toBe(5_000) // касание заменено, фантом убран — пока висит тост
    ops.undoUpload()
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS + 100)
    expect(opsOf(A).map((o) => o.id).sort()).toEqual(['a100000000000002', 'a100000000000003'])
    expect([...st.ops.get('u-a')!.values()].some((o) => o.deleted)).toBe(false)
    expect([...st.ops.get('u-a')!.values()].filter((o) => !o.source)).toEqual([])
    expect(docWeek(A)).toBe(5_777)
  })

  it('Р-16 одной выпиской на двух телефонах: п. 1, п. 2 (банк «карта»), фантом — убраны; последний день и Halyk — остаются', async () => {
    const A = await phone(server, st, 'a')
    const A2 = await phone(server, st, 'a')
    serverTap(st, 'u-a', { id: 'a200000000000001', date: '2026-10-13', amount: -5_000, merchant: 'Magnum' }) // п. 1: тот же продавец, +1 день
    serverTap(st, 'u-a', { id: 'a200000000000002', bank: 'card', date: '2026-10-12', amount: -3_300, merchant: 'Apple Pay' }) // п. 2
    serverTap(st, 'u-a', { id: 'a200000000000003', date: '2026-10-08', amount: -777, merchant: 'Отклонённая' }) // фантом
    serverTap(st, 'u-a', { id: 'a200000000000004', date: '2026-10-14', amount: -778, merchant: 'Kiosk' }) // последний день — остаётся
    serverTap(st, 'u-a', { id: 'a200000000000005', bank: 'halyk', date: '2026-10-13', amount: -779, merchant: 'Halyk shop' }) // другой банк — остаётся
    await pull(A)
    await pull(A2)
    expect(opsOf(A2)).toHaveLength(5)

    setActivePinia(A.pinia)
    await useOperationsStore().upload([{
      name: 'kaspi.pdf',
      parsed: statement([line('2026-10-12', -5_000, 'MAGNUM ALMATY KZ'), line('2026-10-12', -3_300, 'IP AHMETOV')]),
    }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS + 100)
    const gone = ['a200000000000001', 'a200000000000002', 'a200000000000003']
    for (const id of gone) expect(st.ops.get('u-a')!.get(id)!.deleted).toBe(true)
    expect(st.ops.get('u-a')!.get('a200000000000004')!.deleted).toBeUndefined()
    expect(st.ops.get('u-a')!.get('a200000000000005')!.deleted).toBeUndefined()
    await A.store.syncHousehold(A.client)
    expect(docWeek(A)).toBe(5_000 + 3_300 + 778 + 779)

    await pull(A2)
    expect(opsOf(A2).filter((o) => o.source).map((o) => o.id).sort()).toEqual(['a200000000000004', 'a200000000000005'])
    expect(docWeek(A2)).toBe(5_000 + 3_300 + 778 + 779)
  })

  it('возврат в приложение: подтягивает не чаще раза в 30 с; viewer и демо — никогда', async () => {
    const A = await phone(server, st, 'a')
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const calls = () => A.list.mock.calls.length
    const before = calls()
    ops.pullOnReturn(A.client) // только что подтянуто при старте
    expect(calls()).toBe(before)
    await vi.advanceTimersByTimeAsync(PHONE_PULL_MS + 1)
    serverTap(st, 'u-a', { id: 'a300000000000001', date: '2026-10-15', amount: -3_001, merchant: 'Return One' })
    ops.pullOnReturn(A.client)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(before + 1)
    expect(opsOf(A).map((o) => o.merchant)).toContain('Return One')
    ops.pullOnReturn(A.client) // второй возврат сразу — без запроса
    expect(calls()).toBe(before + 1)

    for (const o of [{ role: 'viewer' as const }, { demo: true }]) {
      const p = await phone(server, st, 'a', o)
      setActivePinia(p.pinia)
      await vi.advanceTimersByTimeAsync(PHONE_PULL_MS + 1)
      const n = p.list.mock.calls.length
      useOperationsStore().pullOnReturn(p.client)
      await vi.advanceTimersByTimeAsync(0)
      expect(p.list.mock.calls.length).toBe(n)
    }
  })
})
