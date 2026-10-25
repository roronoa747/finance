import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, ApiError, type ApiClient } from '@/api/client'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import { ruleMatchOf, unknownGroups } from '@/lib/statements/model'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Operation } from '@/lib/statements/types'
import type { OperationsPage, OperationWire } from '@/types/api'

// FB-01 (Р-1, Р-15): вопрос по одной операции — один раз. Перевод человеку пушем и строкой выписки — один ключ правила;
// «Нет, это другое» помнит операцию, а не только пару. Имена и суммы — синтетические.

const storage = new Map<string, string>()

function signIn() {
  useAuthStore().setAuthData({
    token: 't-a',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  useFinanceStore().claimFor('h1')
}

function fakeServer() {
  const server = { feed: [] as OperationWire[], sent: [] as OperationWire[] }
  const client = {
    upsertOperations: vi.fn(async (ops: OperationWire[]) => {
      server.sent.push(...ops)
      return { upserted: ops.length }
    }),
    listOperations: vi.fn(async (): Promise<OperationsPage> => {
      const operations = server.feed
      server.feed = []
      return { operations, next: operations.length ? '2026-10-16T10:00:00Z' : null }
    }),
    listStatementUploads: vi.fn(async () => ({ uploads: [] })),
    createStatementUpload: vi.fn(async (u: object) => ({ id: '00000000-0000-4000-8000-000000000001', slot: 'a', ...u, created_at: '' })),
    fxRates: vi.fn(async (code: string) => ({ code, rates: {}, partial: false })),
  }
  return { server, client: client as unknown as ApiClient }
}

/** Пуш о переводе человеку — как `applepay` сервера: продавец «Перевод Имя Ф.», получателя нет. */
const push = (id: string, merchant: string, amount: number, kind = 'transfer-out'): OperationWire => ({
  id, bank: 'kaspi', date: '2026-10-14', amount, kind, merchant, category_id: null, internal: false,
  source: 'push', occurred_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:01Z',
})

/** Строка выписки Kaspi о том же переводе: продавец и получатель — «Имя Ф.». */
const statement = (ops: Omit<Operation, 'categoryId' | 'internal' | 'bank'>[]) => [{
  name: 'kaspi.pdf',
  parsed: {
    bank: 'kaspi' as const, from: '2026-10-01', to: '2026-10-15', skipped: 0,
    operations: ops.map((o) => ({ bank: 'kaspi' as const, categoryId: null, internal: false, ...o })),
  },
}]

const live = () => useFinanceStore().merchantRules.filter((r) => !r.deletedAt)
const opOf = (id: string) => useOperationsStore().all.find((o) => o.id === id)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T08:00:00Z'))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('FB-01 — перевод человеку: пуш и строка выписки — один ключ', () => {
  it('пуш «Перевод Имя Ф.» — получатель выведен, «Переводы людям», в пачку «Без раздела» не попадает; на сервер получатель не уходит', async () => {
    signIn()
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [push('p1', 'Перевод Айгерим С.', -30_000), push('p2', 'Перевод', -5_000)]
    await store.pull(client)
    expect(opOf('p1')).toMatchObject({ counterparty: 'Айгерим С.', categoryId: 'sc_people' })
    // «Перевод» без имени — заглушка: получателя нет, вопрос «Без раздела» — как был.
    expect(opOf('p2')?.counterparty).toBeUndefined()
    expect(unknownGroups(store.all).map((g) => g.label)).toEqual(['Перевод'])
    // Раздел ушёл на сервер, выведенный получатель — нет.
    expect(server.sent.find((o) => o.id === 'p1')).toMatchObject({ category_id: 'sc_people', counterparty: null })
  })

  it('ответ по пушу — правило по получателю; строка выписки о том же переводе берёт ответ и вопросом не становится', async () => {
    signIn()
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [push('p1', 'Перевод Айгерим С.', -30_000)]
    await store.pull(client)
    await store.recategorize(ruleMatchOf(opOf('p1')!), { categoryId: 'sc_other' }, client)
    expect(live().map((r) => r.match)).toEqual([{ counterparty: 'айгерим с.' }])

    await store.upload(statement([{ id: 'f0000001', date: '2026-10-14', amount: -30_000, kind: 'transfer-out', merchant: 'Айгерим С.', counterparty: 'Айгерим С.', note: 'Перевод' }]), client)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.all.map((o) => o.id)).toEqual(['f0000001'])
    expect(opOf('f0000001')?.categoryId).toBe('sc_other')
    expect(unknownGroups(store.all)).toEqual([])
    // В «Разборе трат» настроек — одна строка.
    expect(live()).toHaveLength(1)
  })

  it('старая копия на диске (до FB-01): получатель пуша выводится при чтении', () => {
    storage.set('ff_operations', JSON.stringify({ owner: 'h1:u-a', ops: { p1: { id: 'p1', bank: 'kaspi', date: '2026-10-14', amount: -30_000, kind: 'transfer-out', merchant: 'Перевод Айгерим С.', categoryId: null, internal: false, source: 'push' } } }))
    signIn()
    expect(useOperationsStore().ops.p1.counterparty).toBe('Айгерим С.')
  })
})

describe('FB-01 — «Нет, это другое» помнит операцию', () => {
  // Два платежа семьи одной суммы 14-го — у владельца несколько платежей ≈ 30 000.
  const doc = () =>
    planFamilyDoc({
      obligations: [
        { id: 'o1', name: 'Платёж 1', note: '', day: 14, category: 'd1', versions: [{ from: '2000-01', amount: 30_000 }], updatedAt: T0 },
        { id: 'o2', name: 'Платёж 2', note: '', day: 14, category: 'd1', versions: [{ from: '2000-01', amount: 30_000 }], updatedAt: T0 },
      ],
    })

  it('отклонённая операция другой цели не предлагается — и после отметки первой пары руками', async () => {
    signIn()
    const finance = useFinanceStore()
    finance.setHouseholdDoc(doc(), 1)
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [push('p1', 'ТОО Получатель', -30_000, 'purchase')]
    await store.pull(client)
    const first = store.pendingMatches.find((c) => c.opId === 'p1')!
    expect(first).toBeTruthy()
    store.declineMatch(first)
    expect(store.pendingMatches.filter((c) => c.opId === 'p1')).toEqual([])
    // Пару отметили руками — операция свободна, но «нет» сказано про неё.
    finance.markPaid('obligation', first.targetId, 'a', { period: first.period })
    expect(store.pendingMatches.filter((c) => c.opId === 'p1')).toEqual([])
  })

  it('«нет» по пушу переходит к строке выписки, что его заменила', async () => {
    signIn()
    useFinanceStore().setHouseholdDoc(doc(), 1)
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [push('p1', 'ТОО Получатель', -30_000, 'purchase')]
    await store.pull(client)
    store.declineMatch(store.pendingMatches.find((c) => c.opId === 'p1')!)
    await store.upload(statement([{ id: 'f0000001', date: '2026-10-14', amount: -30_000, kind: 'purchase', merchant: 'ТОО Получатель' }]), client)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(store.all.map((o) => o.id)).toEqual(['f0000001'])
    expect(store.pendingMatches).toEqual([])
  })

  it('старая запись без операции (`kind:target:period`) после переезда (TL-08) читается как раньше — отклонена пара этого месяца', async () => {
    privateServer()
    storage.set('ff_operations', JSON.stringify({ owner: 'h1:u-a', ops: {} }))
    storage.set('ff_match_declined', JSON.stringify(['obligation:o1:2026-10']))
    signIn()
    useFinanceStore().setHouseholdDoc(doc(), 1)
    await useFinanceStore().pullPrivateDoc()
    const store = useOperationsStore()
    const { server, client } = fakeServer()
    server.feed = [push('p1', 'ТОО Получатель', -30_000, 'purchase')]
    await store.pull(client)
    expect(store.pendingMatches).toEqual([])
    useFinanceStore().markPaid('obligation', 'o1', 'a', { period: '2026-10' })
    expect(store.pendingMatches.map((c) => c.targetId)).toEqual(['o2'])
  })
})

/**
 * Личный документ на сервере (как `sync.go` private): одна копия на человека, ревизия и 409. `down` — сети нет
 * (`TypeError` — устройство досылает позже).
 */
function privateServer() {
  const s = { rev: 0, data: {} as Record<string, unknown>, pushes: 0, down: false }
  const snap = () => ({ household_id: 'h1', user_id: 'u-a', rev: s.rev, data: JSON.parse(JSON.stringify(s.data)), updated_at: '' })
  vi.spyOn(apiClient, 'getPrivateDoc').mockImplementation(async () => {
    if (s.down) throw new TypeError('Failed to fetch')
    return snap()
  })
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => {
    if (s.down) throw new TypeError('Failed to fetch')
    if (rev !== s.rev) throw new ApiError('conflict', 409, { error: 'conflict', server_doc: snap() })
    s.rev += 1
    s.data = JSON.parse(JSON.stringify(data))
    s.pushes += 1
    return snap()
  })
  return s
}

describe('TL-08 — ответы «Нет, это другое» и «Потом» в личном документе (Р-5)', () => {
  const doc = () =>
    planFamilyDoc({
      obligations: [{ id: 'o1', name: 'Платёж 1', note: '', day: 14, category: 'd1', versions: [{ from: '2000-01', amount: 30_000 }], updatedAt: T0 }],
    })
  const answers = (s: { data: Record<string, unknown> }) => (s.data.answers as { id: string; kind: string; until?: string }[] | undefined) ?? []

  it('переезд при первом синке: живые ответы с устройства — в документ, протухший «Потом» — нет; ключи удалены; повтор ничего не пишет', async () => {
    const s = privateServer()
    const until = '2026-10-17T07:00:00.000Z'
    storage.set('ff_match_declined', JSON.stringify(['p1|obligation:o1:2026-10']))
    storage.set('ff_decisions_deferred', JSON.stringify({ 'unknownBatch:2026-W42': until, 'unknownBatch:2026-W41': '2026-10-15T07:00:00.000Z' }))
    signIn()
    await useFinanceStore().pullPrivateDoc()
    expect(answers(s)).toEqual([
      { id: 'p1|obligation:o1:2026-10', kind: 'declined', updatedAt: expect.any(String) },
      { id: 'unknownBatch:2026-W42', kind: 'deferred', until, updatedAt: expect.any(String) },
    ])
    expect(storage.has('ff_match_declined')).toBe(false)
    expect(storage.has('ff_decisions_deferred')).toBe(false)
    expect(useFinanceStore().deferredUntil()).toEqual({ 'unknownBatch:2026-W42': until })

    // Ключи вернулись (старая вкладка дописала) — повтор по id: та же запись второй раз не уходит.
    storage.set('ff_match_declined', JSON.stringify(['p1|obligation:o1:2026-10']))
    const pushes = s.pushes
    await useFinanceStore().pullPrivateDoc()
    expect(s.pushes).toBe(pushes)
    expect(answers(s)).toHaveLength(2)
    expect(storage.has('ff_match_declined')).toBe(false)
  })

  it('сети нет — ключи устройства остаются (ответ не потерян); следующий пулл досылает и только тогда удаляет', async () => {
    const s = privateServer()
    storage.set('ff_match_declined', JSON.stringify(['p1|obligation:o1:2026-10']))
    signIn()
    const finance = useFinanceStore()
    // Первый пулл прошёл, отправки — нет (фоновая из записи и та, что ждёт переезд).
    const offline = new TypeError('Failed to fetch')
    vi.mocked(apiClient.pushPrivateDoc).mockRejectedValueOnce(offline).mockRejectedValueOnce(offline)
    await finance.pullPrivateDoc()
    expect(storage.has('ff_match_declined')).toBe(true)
    expect(finance.declinedKeys).toEqual(['p1|obligation:o1:2026-10'])
    expect(answers(s)).toEqual([])
    await finance.pullPrivateDoc()
    expect(answers(s).map((a) => a.id)).toEqual(['p1|obligation:o1:2026-10'])
    expect(storage.has('ff_match_declined')).toBe(false)
  })

  it('два телефона одного человека: «Нет, это другое» на первом — второй после синка вопрос не задаёт', async () => {
    const s = privateServer()
    // Телефон 1.
    signIn()
    useFinanceStore().setHouseholdDoc(doc(), 1)
    const one = fakeServer()
    one.server.feed = [push('p1', 'ТОО Получатель', -30_000, 'purchase')]
    await useOperationsStore().pull(one.client)
    useOperationsStore().declineMatch(useOperationsStore().pendingMatches.find((c) => c.opId === 'p1')!)
    await vi.advanceTimersByTimeAsync(0)
    expect(answers(s).map((a) => a.id)).toEqual([expect.stringMatching(/^p1\|obligation:o1:/)])

    // Телефон 2: своё устройство, тот же человек.
    storage.clear()
    setActivePinia(createPinia())
    signIn()
    useFinanceStore().setHouseholdDoc(doc(), 1)
    const two = fakeServer()
    two.server.feed = [push('p1', 'ТОО Получатель', -30_000, 'purchase')]
    await useOperationsStore().pull(two.client)
    expect(useOperationsStore().pendingMatches.map((c) => c.opId)).toEqual(['p1'])
    await useFinanceStore().pullPrivateDoc()
    expect(useOperationsStore().pendingMatches).toEqual([])
  })

  it('«Потом» — сутки во всех телефонах; протухший выбрасывается следующей записью; выход стирает копию, не документ', async () => {
    const s = privateServer()
    signIn()
    const finance = useFinanceStore()
    finance.deferAnswers(['unknownBatch:2026-W42'])
    await vi.advanceTimersByTimeAsync(0)
    expect(answers(s)).toEqual([{ id: 'unknownBatch:2026-W42', kind: 'deferred', until: '2026-10-17T08:00:00.000Z', updatedAt: expect.any(String) }])
    vi.setSystemTime(new Date('2026-10-17T09:00:00Z'))
    expect(finance.deferredUntil()).toEqual({})
    // Тот же вопрос снова «Потом» — новая запись того же ключа; другая запись выбрасывает протухшую.
    finance.deferAnswers(['unknownBatch:2026-W43'])
    await vi.advanceTimersByTimeAsync(0)
    expect(answers(s).map((a) => a.id)).toEqual(['unknownBatch:2026-W43'])
    finance.deferAnswers(['unknownBatch:2026-W43'])
    expect(s.pushes).toBe(2)

    // Выход: локальная копия стёрта, на сервере ответы остались.
    useOperationsStore().clear()
    finance.clearLocal()
    expect(finance.deferredUntil()).toEqual({})
    expect(answers(s).map((a) => a.id)).toEqual(['unknownBatch:2026-W43'])
  })
})
