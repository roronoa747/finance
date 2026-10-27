import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from './auth'
import { defaultSyncDoc, useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import { handOperation } from '@/lib/statements/model'
import type { OperationsPage } from '@/types/api'
import type { Account } from '@/types/finance'

/**
 * F2-07 (Р-8): телефон хозяина счёта для трат пишет свою запись `<счёт>:<я>` — нетто своих операций после сверки;
 * тот же итог второй раз не пишется; перестал быть хозяином — `amount: 0`; сверка — запись от нового якоря; viewer — ничего.
 */
const storage = new Map<string, string>()
const T0 = '2026-10-01T00:00:00.000Z'
const ANCHOR = '2026-10-10T06:00:00.000Z'

const client = {
  createStatementUpload: vi.fn(),
  listStatementUploads: vi.fn(async () => ({ uploads: [] })),
  upsertOperations: vi.fn(async (ops: unknown[]) => ({ upserted: ops.length })),
  listOperations: vi.fn(async (): Promise<OperationsPage> => ({ operations: [], next: null })),
} as unknown as ApiClient

function signIn(role: 'member' | 'viewer' = 'member', accounts: Account[] = [card()]) {
  useAuthStore().setAuthData({
    token: 't-a',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role, joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.setHouseholdDoc({
    ...defaultSyncDoc(),
    people: [
      { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Аруна', salary: 0, payday: 20, updatedAt: T0 },
    ],
    accounts,
  }, 1)
  return finance
}
function card(p: Partial<Account> = {}): Account {
  return { id: 'k1', name: 'Kaspi Gold', note: '', amount: 245_000, amountSetAt: ANCHOR, kind: 'card', updatedAt: T0, ...p }
}
const hand = (id: string, amount: number) =>
  handOperation({ id, amount, categoryId: 'sc_food', date: '2026-10-20', note: '' }, 'Продукты')
const spent = () => useFinanceStore().householdDoc.accountSpent ?? []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  // Наблюдатель счёта для трат тянет свои операции перед записью (FG-27) — общим клиентом.
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('F2-07: запись «потрачено» счёта для трат', () => {
  it('хозяин: запись `k1:a` от якоря; баланс тает; та же сумма — без новой записи', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', accountId: 'k1', by: 'a', since: ANCHOR, amount: 2_500 })])
    expect(finance.accounts[0].amount).toBe(242_500)
    const at = spent()[0].updatedAt
    vi.setSystemTime(new Date('2026-10-20T07:05:00Z'))
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()[0].updatedAt).toBe(at)
  })

  it('сверка остатка → запись от нового якоря, баланс = введённой сумме; следующая трата снова тает', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.pull(client)
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
    finance.setAccountAmount('k1', 200_000)
    expect(finance.accounts[0].amount).toBe(200_000)
    // Ручная трата, внесённая до сверки того же дня, уже во введённой сумме (момент внесения — `at`, возврат приёмки).
    await vi.waitFor(() => expect(spent()[0]).toMatchObject({ since: '2026-10-20T08:00:00.000Z', amount: 0 }))
    expect(finance.accounts[0].amount).toBe(200_000)
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'))
    await store.saveHand(hand('11aa11bb22cc33dd', 1_000), {}, client)
    expect(finance.accounts[0].amount).toBe(199_000)
  })

  it('момент внесения ручной траты: правка держит прежний, серверная копия (без времени) его не стирает', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    const first = hand('00aa11bb22cc33dd', 2_500)
    await store.saveHand(first, {}, client)
    expect(store.all[0].at).toBe('2026-10-20T07:00:00.000Z')
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
    finance.setAccountAmount('k1', 200_000)
    await nextTick()
    // Правка после сверки (сумма 3 000) — трата всё равно до сверки: остаток = введённой сумме.
    vi.setSystemTime(new Date('2026-10-20T09:00:00Z'))
    await store.saveHand({ ...first, amount: -3_000 }, {}, client)
    expect(store.all[0].at).toBe('2026-10-20T07:00:00.000Z')
    expect(finance.accounts[0].amount).toBe(200_000)
    vi.mocked(client.listOperations).mockResolvedValueOnce({
      operations: [{ id: first.id, bank: 'hand', date: first.date, amount: -3_000, kind: 'purchase', merchant: first.merchant, category_id: 'sc_food', internal: false, updated_at: '2026-10-20T09:00:01Z' }],
      next: null,
    })
    await store.pull(client)
    expect(store.all[0].at).toBe('2026-10-20T07:00:00.000Z')
    expect(finance.accounts[0].amount).toBe(200_000)
  })

  it('перестал быть хозяином — своя запись обнуляется, не удаляется', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.pull(client)
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    finance.setSpendAccount('k1', 'b')
    await vi.waitFor(() => expect(spent()[0]).toMatchObject({ id: 'k1:a', amount: 0 }))
    expect(spent()[0].deletedAt).toBeFalsy()
  })

  it('viewer — ничего не пишет', async () => {
    signIn('viewer')
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()).toEqual([])
  })

  it('нет счёта для трат — записи нет', async () => {
    signIn('member', [card(), card({ id: 'k2' })])
    const store = useOperationsStore()
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(spent()).toEqual([])
  })
})

const partnerShift = (id: string) => {
  const finance = useFinanceStore()
  const shift = { id, accountId: 'k1', amount: -10_000, date: '2026-10-20', by: 'b' as const, kind: 'goal-in' as const, updatedAt: new Date().toISOString() }
  finance.setHouseholdDoc({ ...finance.householdDoc, accountShifts: [...(finance.householdDoc.accountShifts ?? []), shift] }, 2)
}
/** Своя операция в копии без пересчёта итогов — как копия, оставшаяся с прошлого запуска. */
const local = (id: string, amount: number) => {
  const store = useOperationsStore()
  store.ops = { ...store.ops, [id]: { ...hand(id, amount), at: '2026-10-20T06:30:00.000Z' } }
}
const wire = (id: string, amount: number) => ({
  id, bank: 'hand', date: '2026-10-20', amount: -amount, kind: 'purchase', merchant: 'Продукты', category_id: 'sc_food', internal: false, updated_at: '2026-10-20T07:00:01Z',
})

/** Итог раздела «Еда» недели 2026-W43 моих операций. */
const food = (kind: 'week' | 'month' = 'week') =>
  (useFinanceStore().householdDoc.spendTotals ?? []).find((t) => t.by === 'a' && t.kind === kind && t.categoryId === 'sc_food')

/**
 * FG-27 (FG-Х7): документ семьи пришёл фоном (сдвиг партнёра с моей карты) — запись `k1:a` пишется только по свежей
 * копии своих операций: после `pull`; без удачного `pull` в запуске — не пишется (её пишет первый удачный `pull`).
 */
describe('FG-27: второй свой телефон с несвежими операциями', () => {
  it('(1) без удачного pull документ не пишет запись; первый удачный pull — пишет', async () => {
    signIn()
    const store = useOperationsStore()
    local('00aa11bb22cc33dd', 2_500)
    partnerShift('as_00000001')
    await nextTick()
    await Promise.resolve()
    expect(spent()).toEqual([])
    vi.mocked(client.listOperations).mockRejectedValueOnce(new Error('сеть'))
    await store.pull(client)
    expect(spent()).toEqual([])
    await store.pull(client)
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 2_500 })])
  })

  it('(2) после удачного pull документ будит pull, запись — по операциям, пришедшим им', async () => {
    signIn()
    const store = useOperationsStore()
    await store.pull(client)
    local('00aa11bb22cc33dd', 2_500)
    vi.setSystemTime(new Date('2026-10-20T07:01:00Z'))
    vi.mocked(apiClient.listOperations).mockResolvedValueOnce({ operations: [wire('11aa11bb22cc33dd', 12_500)] as never, next: null })
    partnerShift('as_00000001')
    await vi.waitFor(() => expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 15_000 })]))
    expect(apiClient.listOperations).toHaveBeenCalledTimes(1)
  })

  it('(3) порог PULL_FRESH_MS: два сигнала подряд — один запрос операций', async () => {
    signIn()
    const store = useOperationsStore()
    await store.pull(client)
    local('00aa11bb22cc33dd', 2_500)
    vi.setSystemTime(new Date('2026-10-20T07:01:00Z'))
    partnerShift('as_00000001')
    await nextTick()
    partnerShift('as_00000002')
    await nextTick()
    await vi.waitFor(() => expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 2_500 })]))
    expect(apiClient.listOperations).toHaveBeenCalledTimes(1)
  })

  it('(4) демо пишет по локальной копии без запроса; viewer — ничего', async () => {
    useAuthStore().setAuthData({
      token: DEMO_TOKEN, user: { id: 'demo', email: 'demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Я', role: 'member', joined_at: '' },
    })
    const finance = useFinanceStore()
    finance.setHouseholdDoc({ ...defaultSyncDoc(), accounts: [card()] }, 1)
    useOperationsStore()
    local('00aa11bb22cc33dd', 2_500)
    partnerShift('as_00000001')
    await nextTick()
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 2_500 })])
    expect(apiClient.listOperations).not.toHaveBeenCalled()

    setActivePinia(createPinia())
    storage.clear()
    signIn('viewer')
    useOperationsStore()
    local('00aa11bb22cc33dd', 2_500)
    partnerShift('as_00000001')
    await nextTick()
    await Promise.resolve()
    expect(spent()).toEqual([])
    expect(apiClient.listOperations).not.toHaveBeenCalled()
  })

  it('(5) «Оплатил» партнёра (наблюдатель отметок) — потраченное и итоги разделов только после pull, по его операциям (FG-28)', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.pull(client)
    local('00aa11bb22cc33dd', 2_500)
    vi.setSystemTime(new Date('2026-10-20T07:01:00Z'))
    let answer!: (page: OperationsPage) => void
    vi.mocked(apiClient.listOperations).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const now = new Date().toISOString()
    const paid = { id: 'pm_00000001', kind: 'obligation' as const, targetId: 'rent', period: '2026-10', amount: 100_000, accountId: null, by: 'b' as const, at: now, updatedAt: now }
    finance.setHouseholdDoc({ ...finance.householdDoc, payments: [...(finance.householdDoc.payments ?? []), paid] }, 2)
    await nextTick()
    await Promise.resolve()
    // Ни потраченное со счёта, ни итоги разделов старой копией (2 500) не пишутся — ждут pull (FG-28).
    expect(food()).toBeUndefined()
    expect(spent()).toEqual([])
    answer({ operations: [wire('11aa11bb22cc33dd', 12_500)] as never, next: null })
    await vi.waitFor(() => expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 15_000 })]))
    expect(food()).toMatchObject({ amount: 15_000, ops: 2 })
    expect(apiClient.listOperations).toHaveBeenCalledTimes(1)
  })

  it('(6) сервер операций ответил ошибкой после удачного pull — документ не пишет по старой копии; следующий удачный pull — пишет', async () => {
    signIn()
    const store = useOperationsStore()
    await store.pull(client)
    local('00aa11bb22cc33dd', 2_500)
    vi.setSystemTime(new Date('2026-10-20T07:01:00Z'))
    vi.mocked(apiClient.listOperations).mockRejectedValueOnce(new Error('503'))
    partnerShift('as_00000001')
    await vi.waitFor(() => expect(apiClient.listOperations).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(spent()).toEqual([])
    vi.setSystemTime(new Date('2026-10-20T07:02:00Z'))
    await store.pull(client)
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 2_500 })])
  })
})

/** «Оплатил» партнёра без счёта — сигнал документа наблюдателю отметок. */
const partnerPaid = (id: string, targetId = 'rent') => {
  const finance = useFinanceStore()
  const now = new Date().toISOString()
  const paid = { id, kind: 'obligation' as const, targetId, period: '2026-10', amount: 100_000, accountId: null, by: 'b' as const, at: now, updatedAt: now }
  finance.setHouseholdDoc({ ...finance.householdDoc, payments: [...(finance.householdDoc.payments ?? []), paid] }, 2)
}
const ticks = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

/**
 * FG-28 (FG-Х8): итоги разделов по сигналу документа — тем же путём, что потраченное со счёта (FG-27): только по свежей
 * копии после `pull`; до удачного `pull` — отложены (`totalsDue`). `pull`, принёсший новые для копии строки, сам
 * пересчитывает их периоды.
 */
describe('FG-28: итоги разделов второго своего телефона', () => {
  it('(1) «Оплатил» партнёра при старой копии — итоги не пишутся до ответа pull (ни 2 500, ни 0), после — 15 000; запрос один', async () => {
    signIn()
    const store = useOperationsStore()
    await store.pull(client)
    local('00aa11bb22cc33dd', 2_500)
    vi.setSystemTime(new Date('2026-10-20T07:01:00Z'))
    let answer!: (page: OperationsPage) => void
    vi.mocked(apiClient.listOperations).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    partnerPaid('pm_00000001')
    await nextTick()
    await ticks()
    expect(useFinanceStore().householdDoc.spendTotals ?? []).toEqual([])
    answer({ operations: [wire('11aa11bb22cc33dd', 12_500)] as never, next: null })
    await vi.waitFor(() => expect(food()).toMatchObject({ amount: 15_000, ops: 2 }))
    expect(food('month')).toMatchObject({ amount: 15_000 })
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 15_000 })])
    expect(apiClient.listOperations).toHaveBeenCalledTimes(1)
  })

  it('(2) без удачного pull сигнал итоги не пишет (`totalsDue`); первый удачный pull — пишет по пришедшим; ошибка сервера после удачного — то же', async () => {
    signIn()
    const store = useOperationsStore()
    local('00aa11bb22cc33dd', 2_500)
    partnerPaid('pm_00000001')
    await nextTick()
    await ticks()
    expect(food()).toBeUndefined()
    expect(apiClient.listOperations).not.toHaveBeenCalled()
    // Первый удачный pull новых строк не принёс — отложенное сигналом пишется им же (`totalsDue`), по подтверждённой копии.
    await store.pull(client)
    expect(food()).toMatchObject({ amount: 2_500, ops: 1 })
    // Пришедшие строки — тоже.
    vi.setSystemTime(new Date('2026-10-20T07:00:30Z'))
    vi.mocked(client.listOperations).mockResolvedValueOnce({ operations: [wire('11aa11bb22cc33dd', 12_500)] as never, next: null })
    await store.pull(client)
    expect(food()).toMatchObject({ amount: 15_000, ops: 2 })

    // Удачный pull был, следующий запрос — ошибка: сигнал по старой копии не пишет, следующий удачный pull — пишет.
    local('22aa11bb22cc33dd', 1_000)
    vi.setSystemTime(new Date('2026-10-20T07:01:00Z'))
    vi.mocked(apiClient.listOperations).mockRejectedValueOnce(new Error('503'))
    partnerPaid('pm_00000002')
    await vi.waitFor(() => expect(apiClient.listOperations).toHaveBeenCalledTimes(1))
    await ticks()
    expect(food()).toMatchObject({ amount: 15_000 })
    vi.setSystemTime(new Date('2026-10-20T07:02:00Z'))
    await store.pull(client)
    expect(food()).toMatchObject({ amount: 16_000, ops: 3 })
  })

  it('(3) pull без сигнала принёс строку этой недели с другого телефона — итоги и потраченное переписаны; повторный pull без новых строк документ не трогает', async () => {
    const finance = signIn()
    const store = useOperationsStore()
    await store.pull(client)
    await store.saveHand(hand('00aa11bb22cc33dd', 2_500), {}, client)
    expect(food()).toMatchObject({ amount: 2_500 })
    vi.mocked(client.listOperations).mockResolvedValueOnce({ operations: [wire('11aa11bb22cc33dd', 12_500)] as never, next: null })
    await store.pull(client)
    expect(food()).toMatchObject({ amount: 15_000, ops: 2 })
    expect(spent()).toEqual([expect.objectContaining({ id: 'k1:a', amount: 15_000 })])
    const mutate = vi.spyOn(finance, 'mutateHouseholdDoc')
    const set = vi.spyOn(finance, 'setHouseholdDoc')
    vi.mocked(client.listOperations).mockResolvedValueOnce({ operations: [wire('11aa11bb22cc33dd', 12_500)] as never, next: null })
    await store.pull(client)
    await store.pull(client)
    expect(mutate).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('(4) демо — итоги сразу по копии, без запроса; viewer — ничего', async () => {
    useAuthStore().setAuthData({
      token: DEMO_TOKEN, user: { id: 'demo', email: 'demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Я', role: 'member', joined_at: '' },
    })
    useFinanceStore().setHouseholdDoc({ ...defaultSyncDoc(), accounts: [card()] }, 1)
    useOperationsStore()
    local('00aa11bb22cc33dd', 2_500)
    partnerPaid('pm_00000001')
    await nextTick()
    expect(food()).toMatchObject({ amount: 2_500 })
    expect(apiClient.listOperations).not.toHaveBeenCalled()

    setActivePinia(createPinia())
    storage.clear()
    signIn('viewer')
    useOperationsStore()
    local('00aa11bb22cc33dd', 2_500)
    partnerPaid('pm_00000001')
    await nextTick()
    await ticks()
    expect(useFinanceStore().householdDoc.spendTotals ?? []).toEqual([])
    expect(apiClient.listOperations).not.toHaveBeenCalled()
  })
})
