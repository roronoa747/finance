import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from './auth'
import { useFinanceStore } from './finance'
import { BATCH_SIZE, PULL_LIMIT, toWire, useOperationsStore } from './operations'
import { assignIds, draftSummary, normalizeMerchant } from '@/lib/statements/model'
import { parseStatement } from '@/lib/statements/parsers'
import type { Operation, ParsedStatement } from '@/lib/statements/types'
import type { OperationsPage, OperationWire, StatementUploadResponse } from '@/types/api'
import kaspi01 from '@/lib/statements/fixtures/kaspi-01.rows.json'
import { planFamilyDoc } from '@/test/planFamily'
import { freeByFact } from '@/lib/finance'

const storage = new Map<string, string>()

function signIn(slot: 'a' | 'b' = 'a', role: 'member' | 'viewer' = 'member', household = 'h1') {
  useAuthStore().setAuthData({
    token: `t-${slot}`,
    user: { id: `u-${slot}`, email: `${slot}@b.kz`, created_at: '' },
    household: { id: household, name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: household, user_id: `u-${slot}`, slot, display_name: slot, role, joined_at: '' },
  })
  useFinanceStore().claimFor(household)
}

function fakeServer(slot = 'a') {
  const server = { uploads: [] as StatementUploadResponse[], ops: new Map<string, OperationWire>(), batches: [] as number[] }
  const client = {
    createStatementUpload: vi.fn(async (u: Omit<StatementUploadResponse, 'id' | 'slot' | 'created_at'>) => {
      const record = { id: `00000000-0000-4000-8000-00000000000${server.uploads.length + 1}`, slot, ...u, created_at: '2026-09-26T10:00:00Z' } as StatementUploadResponse
      server.uploads.unshift(record)
      return record
    }),
    listStatementUploads: vi.fn(async () => ({ uploads: [...server.uploads] })),
    upsertOperations: vi.fn(async (ops: OperationWire[]) => {
      server.batches.push(ops.length)
      for (const o of ops) server.ops.set(o.id, o)
      return { upserted: ops.length }
    }),
    listOperations: vi.fn(async (_since: string | null, _limit: number): Promise<OperationsPage> => ({ operations: [], next: null })),
  }
  return { server, client: client as unknown as ApiClient, calls: client }
}

const kaspi = (): ParsedStatement => parseStatement(kaspi01)
const draftOf = (parsed: ParsedStatement) => [{ name: 'выписка.pdf', parsed }]
const spentIn = (ops: Operation[], month: string) =>
  ops.filter((o) => o.amount < 0 && !o.internal && o.date.startsWith(month)).reduce((s, o) => s - o.amount, 0)

beforeEach(() => {
  vi.useFakeTimers() // синк документа по таймеру в сеть не уходит
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  // Правила уходят в личный документ — сеть в тестах стора не нужна.
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('stores/operations — отправка выписки', () => {
  it('батчи по 500; запись загрузки одна, операции получают её id; список загрузок обновлён', async () => {
    signIn()
    const store = useOperationsStore()
    const { client, server, calls } = fakeServer()
    const ops = assignIds(
      Array.from({ length: 1200 }, (_, i) => ({
        bank: 'kaspi' as const, date: `2026-09-${String((i % 20) + 1).padStart(2, '0')}`, amount: -(100 + i),
        kind: 'purchase' as const, merchant: 'Magnum', categoryId: null, internal: false,
      })),
    )
    store.setDraft(draftOf({ bank: 'kaspi', from: '2026-09-01', to: '2026-09-26', operations: ops, skipped: 0 }))
    await store.send(client)

    expect(calls.createStatementUpload).toHaveBeenCalledTimes(1)
    expect(calls.createStatementUpload).toHaveBeenCalledWith({ bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-26', ops_count: 1200 })
    expect(server.batches).toEqual([BATCH_SIZE, BATCH_SIZE, 200])
    expect([...server.ops.values()].every((o) => o.upload_id === server.uploads[0].id)).toBe(true)
    expect(store.all.every((o) => o.uploadId === server.uploads[0].id)).toBe(true)
    expect(store.pending).toEqual([])
    expect(store.uploads.map((u) => u.bank)).toEqual(['kaspi'])
    expect(store.draft).toBeNull()
  })

  it('пересекающиеся выписки в одном выборе: сводка как у одной, операция уходит один раз', async () => {
    signIn()
    const store = useOperationsStore()
    const { client, server, calls } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    const single = draftSummary(store.draftOps, () => false)
    store.setDraft([...draftOf(kaspi()), { name: 'та же.pdf', parsed: kaspi() }])
    expect(store.draftOps).toHaveLength(60)
    expect(draftSummary(store.draftOps, () => false)).toEqual(single)

    await store.send(client)
    // Обе записи загрузок — со своим числом операций; второй батч пустой и не отправляется.
    expect(calls.createStatementUpload).toHaveBeenCalledTimes(2)
    expect(calls.createStatementUpload.mock.calls.map(([u]) => u.ops_count)).toEqual([60, 60])
    expect(server.batches).toEqual([60])
    expect(store.pending).toEqual([])
  })

  it('итоги — в общем документе по id, из всех своих операций периода; повторная отправка не удваивает', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client, server } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)

    expect(finance.householdDoc.spendCategories?.length).toBeGreaterThan(0)
    const july = () => (finance.householdDoc.spendTotals ?? []).filter((t) => t.id.startsWith('a:month:2025-07:'))
    const julySum = () => july().reduce((s, t) => s + t.amount, 0)
    expect(julySum()).toBe(spentIn(store.all, '2025-07'))
    expect(july().every((t) => t.id === `a:month:2025-07:${t.categoryId}` && Number.isInteger(t.amount))).toBe(true)
    const before = JSON.stringify(july().map((t) => [t.id, t.amount, t.ops]))

    // Загрузка части месяца пересчитывает месяц из всех операций, а не только из новых.
    const part = kaspi()
    part.operations = part.operations.filter((o) => o.date === '2025-07-26')
    store.setDraft(draftOf(part))
    await store.send(client)
    expect(JSON.stringify(july().map((t) => [t.id, t.amount, t.ops]))).toBe(before)

    // Тот же файл ещё раз: те же id, операций столько же, итоги те же.
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    expect(store.all).toHaveLength(60)
    expect(server.ops.size).toBe(60)
    expect(JSON.stringify(july().map((t) => [t.id, t.amount, t.ops]))).toBe(before)
  })

  it('перед итогами забирает свои операции со второго устройства; двойное «Отправить» — одна отправка', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client, calls } = fakeServer()
    // Со второго устройства уже ушла покупка в июле — в этой копии её ещё нет.
    const [other] = assignIds([
      { bank: 'freedom', date: '2025-07-10', amount: -7_000, kind: 'purchase', merchant: 'Magnum', categoryId: 'sc_food', internal: false },
    ])
    calls.listOperations.mockResolvedValueOnce({
      operations: [{ ...toWire(other), updated_at: '2026-09-26T10:00:00Z' }],
      next: '2026-09-26T10:00:00Z',
    })
    store.setDraft(draftOf(kaspi()))
    await Promise.all([store.send(client), store.send(client)])

    expect(calls.createStatementUpload).toHaveBeenCalledTimes(1)
    expect(store.ops[other.id]).toBeDefined()
    const julySum = (finance.householdDoc.spendTotals ?? [])
      .filter((t) => t.id.startsWith('a:month:2025-07:'))
      .reduce((s, t) => s + t.amount, 0)
    expect(julySum).toBe(spentIn(store.all, '2025-07'))
    expect(julySum).toBe(spentIn(kaspi().operations, '2025-07') + 7_000)
  })

  it('без сети: итоги сразу, операции — в очереди (и на диске); сеть вернулась — досылаются', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const down = fakeServer()
    vi.mocked(down.calls.upsertOperations).mockRejectedValue(new TypeError('Failed to fetch'))
    store.setDraft(draftOf(kaspi()))
    await store.send(down.client)

    expect(store.status).toBe('offline')
    expect(store.pendingCount).toBe(60)
    expect(JSON.parse(storage.get('ff_operations_pending')!)[0].ops).toHaveLength(60)
    expect((finance.householdDoc.spendTotals ?? []).length).toBeGreaterThan(0)

    const up = fakeServer()
    await store.flush(up.client)
    expect(store.pendingCount).toBe(0)
    expect(up.server.ops.size).toBe(60)
    // Запись загрузки создана первым сервером — второй раз не создаётся.
    expect(up.calls.createStatementUpload).not.toHaveBeenCalled()
    expect([...up.server.ops.values()].every((o) => o.upload_id === down.server.uploads[0].id)).toBe(true)
  })

  it('смена раздела задним числом: правило, пересчёт операций и итогов, досыл изменённых', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client, server } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    const unknownJuly = () => finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2025-07:_unknown')
    const asanova = store.all.filter((o) => o.merchant === 'IP ASANOVA')
    expect(asanova.every((o) => o.categoryId === null)).toBe(true)
    const unknownBefore = unknownJuly()!.amount

    server.batches.length = 0
    await store.recategorize({ merchant: 'asanova' }, { categoryId: 'sc_home' }, client)
    expect(store.all.filter((o) => o.merchant === 'IP ASANOVA').every((o) => o.categoryId === 'sc_home')).toBe(true)
    expect(unknownJuly()!.amount).toBe(unknownBefore - 17_684)
    expect(finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2025-07:sc_home')?.amount).toBe(17_684)
    expect(server.batches).toEqual([1])
    expect(finance.merchantRules.map((r) => r.match)).toEqual([{ merchant: 'asanova' }])
  })

  it('раздел, из которого ушли все траты периода, обнуляется, а не удаляется', async () => {
    signIn()
    const store = useOperationsStore()
    const finance = useFinanceStore()
    const { client } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    await store.recategorize({ merchant: 'steam' }, { categoryId: 'sc_other' }, client)
    const fun = finance.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2025-07:sc_fun')
    expect(fun).toMatchObject({ amount: 0, ops: 0 })
    expect(fun?.deletedAt).toBeFalsy()
  })
})

describe('stores/operations — курсор, семья, демо', () => {
  it('pull идёт по курсору страницами и помнит курсор', async () => {
    signIn()
    const store = useOperationsStore()
    const { client, calls } = fakeServer()
    const wire = (i: number): OperationWire => ({
      id: (0x1000000 + i).toString(16), bank: 'kaspi', date: '2026-09-01', amount: -1, kind: 'purchase',
      merchant: 'Magnum', category_id: 'sc_food', internal: false,
    })
    const T1 = '2026-09-26T10:00:00.000001Z'
    const T2 = '2026-09-26T10:05:00.000002Z'
    vi.mocked(calls.listOperations)
      .mockResolvedValueOnce({ operations: Array.from({ length: PULL_LIMIT }, (_, i) => wire(i)), next: T1 })
      .mockResolvedValueOnce({ operations: [wire(PULL_LIMIT)], next: T2 })
      .mockResolvedValueOnce({ operations: [], next: null })
    await store.pull(client)
    expect(vi.mocked(calls.listOperations).mock.calls.map((c) => c[0])).toEqual([null, T1])
    expect(store.all).toHaveLength(PULL_LIMIT + 1)
    expect(store.cursor).toBe(T2)
    // Следующий pull — с запасом в минуту (транзакция, закоммиченная позже); пустой ответ
    // курсор назад не двигает.
    await store.pull(client)
    expect(vi.mocked(calls.listOperations).mock.calls[2][0]).toBe('2026-09-26T10:04:00.000Z')
    expect(store.cursor).toBe(T2)
    // Запас вернул уже известную строку и новую — копия по id, без дублей; курсор — вперёд.
    vi.mocked(calls.listOperations).mockResolvedValueOnce({ operations: [wire(PULL_LIMIT), wire(PULL_LIMIT + 1)], next: '2026-09-26T10:06:00Z' })
    await store.pull(client)
    expect(store.all).toHaveLength(PULL_LIMIT + 2)
    expect(store.cursor).toBe('2026-09-26T10:06:00Z')
  })

  it('вход в другую семью и выход стирают операции, курсор и очередь', async () => {
    signIn()
    const store = useOperationsStore()
    const { client } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    expect(store.all).toHaveLength(60)
    expect(storage.has('ff_operations')).toBe(true)

    useFinanceStore().claimFor('h2')
    await nextTick()
    expect(store.all).toHaveLength(0)
    expect(store.pending).toEqual([])
    expect(storage.has('ff_operations')).toBe(false)
  })

  it('другой вход в той же семье не видит копию на диске; выход стирает ключи операций', async () => {
    signIn('a')
    const store = useOperationsStore()
    const { client } = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(client)
    expect(storage.has('ff_operations')).toBe(true)

    // Партнёр входит на этом же телефоне, стор операций в сессии ещё не создан.
    setActivePinia(createPinia())
    signIn('b')
    expect(useOperationsStore().all).toHaveLength(0)

    useFinanceStore().clearLocal()
    for (const k of ['ff_operations', 'ff_operations_cursor', 'ff_operations_pending']) expect(storage.has(k)).toBe(false)
  })

  it('копия чужой семьи на диске при старте не подхватывается', () => {
    storage.set('ff_operations', JSON.stringify({ owner: 'h-old:u-a', ops: { abc12345: { id: 'abc12345' } } }))
    signIn()
    expect(useOperationsStore().all).toHaveLength(0)
  })

  it('viewer не тянет операции; демо разбирает и считает локально, без запросов', async () => {
    signIn('b', 'viewer')
    const viewer = fakeServer()
    await useOperationsStore().pull(viewer.client)
    expect(viewer.calls.listOperations).not.toHaveBeenCalled()

    setActivePinia(createPinia())
    storage.clear()
    useAuthStore().setAuthData({
      token: DEMO_TOKEN, user: { id: 'demo', email: 'demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Я', role: 'member', joined_at: '' },
    })
    const store = useOperationsStore()
    const demo = fakeServer()
    store.setDraft(draftOf(kaspi()))
    await store.send(demo.client)
    for (const m of Object.values(demo.calls)) expect(m).not.toHaveBeenCalled()
    expect(store.uploads.map((u) => [u.bank, u.ops_count])).toEqual([['kaspi', 60]])
    expect(useFinanceStore().householdDoc.spendTotals?.length).toBeGreaterThan(0)
  })
})

describe('stores/operations — сопоставление с отметками (Р-6, B2C-15)', () => {
  const op = (date: string, amount: number, merchant: string): Omit<Operation, 'id'> => ({
    bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false,
  })
  const statement = (from: string, to: string, ...list: Omit<Operation, 'id'>[]): ParsedStatement => ({
    bank: 'kaspi', from, to, operations: assignIds(list), skipped: 0,
  })

  function family() {
    signIn('a')
    // Ильяс a / Аруна b, аренда 220 000 5-го, кредит 58 000 15-го (33 %), карта Kaspi Gold.
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
    return useFinanceStore()
  }

  it('«да»: запись payments с источником «выписка» и id операции, сумма операции, счёт не списывается; правило «это платёж по …»; раздел операции — плановый; остаток кредита — минус тело', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    store.setDraft(draftOf(statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'Оплата Kaspi Кредита'), op('2026-09-06', -220_000, 'PEREVOD ARENDA'), op('2026-09-11', 700_000, 'ТОО Работодатель'))))
    await store.send(client)
    expect(store.lastAutoMarked).toBe(0)
    expect(store.pendingMatches.map((c) => [c.kind, c.targetId, c.period])).toEqual([
      ['credit', 'loan', '2026-09'],
      ['obligation', 'rent', '2026-09'],
      ['salary', 'a', '2026-09'],
    ])

    const credit = store.pendingMatches[0]
    await store.acceptMatch(credit, client)
    const record = finance.payments.find((p) => p.kind === 'credit')!
    expect(record).toMatchObject({ targetId: 'loan', period: '2026-09', amount: 58_000, accountId: null, source: 'statement', opId: credit.opId, by: 'a' })
    // 1 000 000 × 0,33 / 12 = 27 500 банку, 30 500 в долг.
    expect(record.principal).toBe(30_500)
    expect(finance.credits.find((c) => c.id === 'loan')!.principal).toBe(969_500)
    expect(finance.merchantRules.map((r) => r.to)).toEqual([{ payment: { kind: 'credit', targetId: 'loan', categoryId: 'sc_credit' } }])
    expect(store.all.find((o) => o.id === credit.opId)!.categoryId).toBe('sc_credit')
    expect(finance.householdDoc.spendTotals!.find((t) => t.id === 'a:month:2026-09:sc_credit')?.amount).toBe(58_000)
    expect(store.pendingMatches.map((c) => c.kind)).toEqual(['obligation', 'salary'])

    // «Нет» — на этот месяц, на устройстве; правила нет.
    store.declineMatch(store.pendingMatches[0])
    expect(store.pendingMatches.map((c) => c.kind)).toEqual(['salary'])
    expect(JSON.parse(storage.get('ff_match_declined')!)).toEqual(['obligation:rent:2026-09'])
    expect(finance.merchantRules).toHaveLength(1)

    // «Да, зарплата» — запись зачисления от участника, правило по получателю.
    await store.acceptMatch(store.pendingMatches[0], client)
    expect(finance.payments.find((p) => p.kind === 'salary')).toMatchObject({ targetId: 'a', amount: 700_000, source: 'statement', accountId: null })
    expect(finance.merchantRules.find((r) => 'payment' in r.to && r.to.payment.kind === 'salary')?.to).toEqual({ payment: { kind: 'salary', targetId: 'a', categoryId: null } })
    expect(store.pendingMatches).toEqual([])
  })

  it('повтор того же файла — второй отметки нет; следующий месяц отмечается сам по правилу; «снять» не предлагает снова', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    const september = statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'Оплата Kaspi Кредита'))
    store.setDraft(draftOf(september))
    await store.send(client)
    await store.acceptMatch(store.pendingMatches[0], client)
    expect(finance.payments.filter((p) => !p.deletedAt)).toHaveLength(1)

    // Тот же файл ещё раз: операция та же (тот же id) — пара «кредит · сентябрь» уже отмечена.
    store.setDraft(draftOf(september))
    expect(store.draftAutoMatches).toEqual([])
    await store.send(client)
    expect(store.lastAutoMarked).toBe(0)
    expect(finance.payments.filter((p) => !p.deletedAt)).toHaveLength(1)
    expect(store.pendingMatches).toEqual([])

    // Октябрь: строка по правилу отмечается сама — «Отмечено по выписке: 1».
    vi.setSystemTime(new Date('2026-10-16T07:00:00Z'))
    store.setDraft(draftOf(statement('2026-10-01', '2026-10-16', op('2026-10-15', -58_000, 'Оплата Kaspi Кредита'))))
    expect(store.draftAutoMatches.map((c) => [c.period, c.confidence])).toEqual([['2026-10', 'rule']])
    await store.send(client)
    expect(store.lastAutoMarked).toBe(1)
    const october = finance.payments.find((p) => p.period === '2026-10')!
    expect(october).toMatchObject({ kind: 'credit', targetId: 'loan', source: 'statement', amount: 58_000 })
    expect(store.pendingMatches).toEqual([])

    // Снять отметку — надгробие; снова не предлагается. «Оплата Kaspi Кредита» и без правила — кредит по
    // словарю, поэтому раздел тот же (продавец не из словаря возвращается в траты — тест ниже).
    finance.unmarkPaid('credit', 'loan', '2026-10')
    await nextTick()
    expect(finance.payments.find((p) => p.period === '2026-10' && !p.deletedAt)).toBeUndefined()
    expect(store.pendingMatches).toEqual([])
    expect(store.all.find((o) => o.id === october.opId)!.categoryId).toBe('sc_credit')
    expect(finance.merchantRules.filter((r) => !r.deletedAt)).toHaveLength(1)
  })

  it('возврат приёмки п. 5: «Снять отметку» возвращает операцию в траты — итоги переписаны, «Свободно» меньше на её сумму; повтор выписки не возвращает её в кредиты; месяц отметили снова — обратно', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    // Кредит платится переводом ИП — продавца нет в словаре: плановый раздел даёт только правило платежа.
    const september = statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'ИП Жолдасбеков'))
    store.setDraft(draftOf(september))
    await store.send(client)
    const id = store.all[0].id
    await store.acceptMatch(store.pendingMatches[0], client)
    const month = () => Object.fromEntries((finance.householdDoc.spendTotals ?? []).filter((t) => t.id.startsWith('a:month:2026-09:')).map((t) => [t.categoryId, t.amount]))
    const free = () =>
      freeByFact({ ...finance.householdDoc, credits: finance.credits }, finance.householdDoc.spendTotals ?? [], finance.householdDoc.spendCategories ?? [], '2026-09', [
        { slot: 'a', period_from: '2026-09-01', period_to: '2026-09-20' },
      ]).amount

    // До: трата в разделе кредитов — «Свободно» её не вычитает, платёж уже в платежах месяца.
    expect(store.ops[id].categoryId).toBe('sc_credit')
    expect(month()).toEqual({ sc_credit: 58_000, _unknown: 0 })
    const before = free()

    // Снять: платёж снова в плане месяца, а операция — снова трата (раздел по словарю: незнакомое).
    finance.unmarkPaid('credit', 'loan', '2026-09')
    await nextTick()
    expect(store.ops[id].categoryId).toBeNull()
    expect(month()).toEqual({ sc_credit: 0, _unknown: 58_000 })
    expect(free()).toBe(before - 58_000)
    // Правило не удаляется (снять — в настройках разбора), строка снова не предлагается; на сервер — новый раздел.
    expect(finance.merchantRules).toHaveLength(1)
    expect(store.pendingMatches).toEqual([])
    expect(store.pending.flatMap((j) => j.ops).find((o) => o.id === id)?.categoryId).toBeNull()

    // Та же выписка ещё раз: операция остаётся тратой, месяц сам не отмечается.
    store.setDraft(draftOf(september))
    await store.send(client)
    expect(store.lastAutoMarked).toBe(0)
    expect(store.ops[id].categoryId).toBeNull()

    // Месяц отметили снова вручную — эта операция и есть платёж: обратно в кредиты, «Свободно» как было.
    finance.markPaid('credit', 'loan', 'a', { period: '2026-09', amount: 58_000, accountId: null })
    await nextTick()
    expect(store.ops[id].categoryId).toBe('sc_credit')
    expect(free()).toBe(before)
  })

  it('критик возврата: копия операции с сервера старше снятия отметки (новый вход) — после pull снова трата, итоги переписаны', async () => {
    const finance = family()
    const { server, client, calls } = fakeServer()
    let store = useOperationsStore()
    store.setDraft(draftOf(statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'ИП Жолдасбеков'))))
    await store.send(client)
    const id = store.all[0].id
    await store.acceptMatch(store.pendingMatches[0], client)
    expect(server.ops.get(id)!.category_id).toBe('sc_credit')

    // Новый вход: документы — с надгробием отметки (снял партнёр), копии операций на телефоне нет.
    const doc = JSON.parse(JSON.stringify(finance.householdDoc))
    const priv = JSON.parse(JSON.stringify(finance.privateDoc))
    setActivePinia(createPinia())
    storage.clear()
    signIn('a')
    const again = useFinanceStore()
    again.setHouseholdDoc(doc, 1)
    again.privateDoc = priv
    again.unmarkPaid('credit', 'loan', '2026-09')
    store = useOperationsStore()
    expect(store.all).toEqual([])

    vi.mocked(calls.listOperations).mockResolvedValueOnce({ operations: [...server.ops.values()], next: null })
    await store.pull(client)
    expect(store.ops[id].categoryId).toBeNull()
    const month = Object.fromEntries((again.householdDoc.spendTotals ?? []).filter((t) => t.id.startsWith('a:month:2026-09:')).map((t) => [t.categoryId, t.amount]))
    expect(month).toEqual({ sc_credit: 0, _unknown: 58_000 })
    expect(server.ops.get(id)!.category_id).toBeNull()
  })

  it('критик возврата: «снял ошибочное — принял верное» — снятая строка остаётся тратой; пересчёт по другому правилу и снятие правила её не возвращают', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    const september = statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'ИП Жолдасбеков'), op('2026-09-15', -58_000, 'Оплата Kaspi Кредита'))
    store.setDraft(draftOf(september))
    await store.send(client)
    const wrong = store.all.find((o) => o.merchant === 'ИП Жолдасбеков')!.id
    const month = () => Object.fromEntries((finance.householdDoc.spendTotals ?? []).filter((t) => t.id.startsWith('a:month:2026-09:')).map((t) => [t.categoryId, t.amount]))

    // «Да» на ИП (ошибка) → снять: строка снова трата.
    await store.acceptMatch(store.pendingMatches.find((c) => c.opId === wrong)!, client)
    finance.unmarkPaid('credit', 'loan', '2026-09')
    await nextTick()
    expect(store.ops[wrong].categoryId).toBeNull()

    // Настоящий платёж по кредиту отмечает тот же месяц — снятая строка ИП от этого не становится платежом.
    await store.acceptMatch(store.pendingMatches.find((c) => c.opId !== wrong)!, client)
    await nextTick()
    expect(finance.payments.filter((p) => !p.deletedAt).map((p) => p.opId)).not.toContain(wrong)
    expect(store.ops[wrong].categoryId).toBeNull()
    expect(month()).toEqual({ sc_credit: 58_000, _unknown: 58_000 })

    // Любой пересчёт по правилам (ответ «Что это?» о другом продавце, снятие правила) держит её в тратах.
    await store.recategorize({ merchant: normalizeMerchant('Magnum') }, { categoryId: 'sc_food' }, client)
    expect(store.ops[wrong].categoryId).toBeNull()
    await store.forgetRule(finance.merchantRules.find((r) => !r.deletedAt && r.match.merchant === normalizeMerchant('Magnum'))!, client)
    expect(store.ops[wrong].categoryId).toBeNull()
    expect(month()).toEqual({ sc_credit: 58_000, _unknown: 58_000 })
  })

  it('возврат приёмки 2 п. 2: правило платежа на «Перевод с карты на карту» — плановый раздел и отметки только строкам в допуске суммы; «Свободно» меньше не на все переводы', async () => {
    const finance = family()
    const p2p = finance.addObligation({ name: 'Переводы', day: 20, category: 'd4', amount: 15_000 })
    const { client } = fakeServer()
    const store = useOperationsStore()
    // Freedom печатает все переводы без получателя одним названием: 15 000 — обязательство, остальное — траты.
    const transfer = (date: string, amount: number) => ({ ...op(date, amount, 'Перевод с карты на карту'), kind: 'transfer-out' as const })
    store.setDraft(draftOf(statement('2026-08-01', '2026-09-20',
      transfer('2026-08-19', -40_000), transfer('2026-08-20', -15_000),
      transfer('2026-09-03', -2_000), transfer('2026-09-12', -280_000), transfer('2026-09-20', -15_000),
    )))
    await store.send(client)
    const idOf = (date: string) => store.all.find((o) => o.date === date)!.id
    const free = () =>
      freeByFact({ ...finance.householdDoc, credits: finance.credits }, finance.householdDoc.spendTotals ?? [], finance.householdDoc.spendCategories ?? [], '2026-09', [
        { slot: 'a', period_from: '2026-08-01', period_to: '2026-09-20' },
      ]).amount
    const before = free()

    // «Да» на сентябрьские 15 000: правило по продавцу; август отмечается сам — строкой 15 000, не 40 000.
    await store.acceptMatch(store.pendingMatches.find((c) => c.targetId === p2p && c.period === '2026-09')!, client)
    expect(finance.payments.filter((p) => !p.deletedAt).map((p) => [p.period, p.amount, p.opId])).toEqual([
      ['2026-09', 15_000, idOf('2026-09-20')],
      ['2026-08', 15_000, idOf('2026-08-20')],
    ])
    // Плановый раздел — только двум строкам 15 000; 2 000, 280 000 и 40 000 остаются тратами.
    expect(store.all.map((o) => [o.date, o.categoryId])).toEqual([
      ['2026-08-19', null], ['2026-08-20', 'sc_subscriptions'], ['2026-09-03', null], ['2026-09-12', null], ['2026-09-20', 'sc_subscriptions'],
    ])
    // Сентябрь: 15 000 больше не вычитается дважды (план и трата) — «Свободно» больше ровно на него, а не на 297 000.
    expect(free()).toBe(before + 15_000)
  })

  it('критик возврата 2: ответ «куда отнести?» о продавце с правилом платежа — раздел остальных строк, правило платежа живо; следующая выписка отмечает 15 000 сама, остальное — в тот раздел', async () => {
    const finance = family()
    const p2p = finance.addObligation({ name: 'Переводы', day: 20, category: 'd4', amount: 15_000 })
    const { client } = fakeServer()
    const store = useOperationsStore()
    const transfer = (date: string, amount: number) => ({ ...op(date, amount, 'Перевод с карты на карту'), kind: 'transfer-out' as const })
    store.setDraft(draftOf(statement('2026-08-01', '2026-09-20',
      transfer('2026-08-19', -40_000), transfer('2026-08-20', -15_000),
      transfer('2026-09-03', -2_000), transfer('2026-09-12', -280_000), transfer('2026-09-20', -15_000),
    )))
    await store.send(client)
    const match = { merchant: normalizeMerchant('Перевод с карты на карту') }
    const month = (key: string) => Object.fromEntries((finance.householdDoc.spendTotals ?? []).filter((t) => t.id.startsWith(`a:month:${key}:`) && t.amount).map((t) => [t.categoryId, t.amount]))
    const free = () =>
      freeByFact({ ...finance.householdDoc, credits: finance.credits }, finance.householdDoc.spendTotals ?? [], finance.householdDoc.spendCategories ?? [], '2026-09', [
        { slot: 'a', period_from: '2026-08-01', period_to: '2026-09-20' },
      ]).amount
    await store.acceptMatch(store.pendingMatches.find((c) => c.targetId === p2p && c.period === '2026-09')!, client)
    const after = free()
    expect(month('2026-09')).toEqual({ _unknown: 282_000, sc_subscriptions: 15_000 })

    // «Перевод с карты на карту — куда отнести?» → «Переводы людям»: правило платежа остаётся, раздел — остальным строкам.
    await store.recategorize(match, { categoryId: 'sc_people' }, client)
    const rules = finance.merchantRules.filter((r) => !r.deletedAt)
    expect(rules).toHaveLength(1)
    expect(rules[0].to).toEqual({ payment: { kind: 'obligation', targetId: p2p, categoryId: 'sc_subscriptions', restCategoryId: 'sc_people' } })
    expect(store.all.map((o) => o.categoryId)).toEqual(['sc_people', 'sc_subscriptions', 'sc_people', 'sc_people', 'sc_subscriptions'])
    expect(month('2026-09')).toEqual({ sc_people: 282_000, sc_subscriptions: 15_000 })
    // «Свободно» не меняется: платёж по-прежнему один раз (план), 282 000 — траты как и были.
    expect(free()).toBe(after)

    // Октябрьская выписка: 15 000 отмечается само по правилу, 2 000 — сразу в «Переводы людям», вопросов нет.
    vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
    store.setDraft(draftOf(statement('2026-10-01', '2026-10-20', transfer('2026-10-03', -2_000), transfer('2026-10-20', -15_000))))
    expect(store.draftOps.map((o) => o.categoryId)).toEqual(['sc_people', 'sc_subscriptions'])
    expect(store.draftAutoMatches.map((c) => [c.period, c.confidence])).toEqual([['2026-10', 'rule']])
    await store.send(client)
    expect(store.lastAutoMarked).toBe(1)
    expect(finance.payments.filter((p) => !p.deletedAt && p.period === '2026-10')).toEqual([expect.objectContaining({ targetId: p2p, amount: 15_000, source: 'statement' })])
    expect(store.pendingMatches).toHaveLength(0)
    expect(month('2026-10')).toEqual({ sc_people: 2_000, sc_subscriptions: 15_000 })

    // И наоборот: раздел был раньше, «Да, отметить» его не стирает — прежний раздел остаётся остальным строкам;
    // «между своими» заменяет правило целиком (все переводы продавца — не платёж).
    const magnum = { merchant: normalizeMerchant('Magnum') }
    store.answer(magnum, { categoryId: 'sc_food' })
    store.answer(magnum, { payment: { kind: 'obligation', targetId: 'lunch', categoryId: 'sc_subscriptions' } })
    const rule = () => finance.merchantRules.find((r) => !r.deletedAt && r.match.merchant === magnum.merchant)!.to
    expect(rule()).toEqual({ payment: { kind: 'obligation', targetId: 'lunch', categoryId: 'sc_subscriptions', restCategoryId: 'sc_food' } })
    store.answer(magnum, { internal: true })
    expect(rule()).toEqual({ internal: true })
  })

  it('две строки одного продавца: «Да» на одну отмечает оба месяца — вторая по новому правилу, с датой операции', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    store.setDraft(draftOf(statement('2026-08-01', '2026-09-20', op('2026-08-14', -58_000, 'Оплата Kaspi Кредита'), op('2026-09-14', -58_000, 'Оплата Kaspi Кредита'))))
    await store.send(client)
    expect(store.pendingMatches.map((c) => c.period).sort()).toEqual(['2026-08', '2026-09'])

    await store.acceptMatch(store.pendingMatches.find((c) => c.period === '2026-09')!, client)
    const live = finance.payments.filter((p) => !p.deletedAt && p.kind === 'credit')
    expect(live.map((p) => [p.period, p.amount, p.source, p.at]).sort()).toEqual([
      ['2026-08', 58_000, 'statement', '2026-08-14T07:00:00.000Z'],
      ['2026-09', 58_000, 'statement', '2026-09-14T07:00:00.000Z'],
    ])
    expect(new Set(live.map((p) => p.opId)).size).toBe(2)
    expect(store.lastAutoMarked).toBe(1)
    expect(store.pendingMatches).toEqual([])
    // Остаток сверен 1 сентября (principalSetAt): августовский платёж он уже учёл — минус только сентябрь.
    expect(finance.credits.find((c) => c.id === 'loan')!.principal).toBe(969_500)
  })

  it('отметка из выписки — с моментом операции: строка до сверки остатка кредита его не двигает', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    // 19 сентября остаток сверен с банком: 900 000 — платёж 14-го в нём уже учтён.
    vi.setSystemTime(new Date('2026-09-19T07:00:00Z'))
    finance.updateCredit('loan', { principal: 900_000 })
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
    store.setDraft(draftOf(statement('2026-09-01', '2026-09-20', op('2026-09-14', -58_000, 'Оплата Kaspi Кредита'))))
    await store.send(client)
    await store.acceptMatch(store.pendingMatches[0], client)

    expect(finance.payments.find((p) => p.kind === 'credit')).toMatchObject({ period: '2026-09', at: '2026-09-14T07:00:00.000Z', source: 'statement' })
    expect(finance.credits.find((c) => c.id === 'loan')!.principal).toBe(900_000)
  })

  it('правило зарплаты не отмечает месяц мелким пополнением тем же продавцом — ждёт настоящую зарплату', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    store.setDraft(draftOf(statement('2026-09-01', '2026-09-20', op('2026-09-10', 700_000, 'С карты другого банка'))))
    await store.send(client)
    await store.acceptMatch(store.pendingMatches[0], client)
    expect(finance.payments.filter((p) => p.kind === 'salary').map((p) => p.period)).toEqual(['2026-09'])

    // Октябрь: сначала пополнение 5 000 — не зарплата; потом 700 000 — отмечается само.
    vi.setSystemTime(new Date('2026-10-05T07:00:00Z'))
    store.setDraft(draftOf(statement('2026-10-01', '2026-10-05', op('2026-10-05', 5_000, 'С карты другого банка'))))
    await store.send(client)
    expect(store.lastAutoMarked).toBe(0)
    expect(finance.payments.find((p) => p.kind === 'salary' && p.period === '2026-10')).toBeUndefined()
    vi.setSystemTime(new Date('2026-10-12T07:00:00Z'))
    store.setDraft(draftOf(statement('2026-10-06', '2026-10-12', op('2026-10-10', 700_000, 'С карты другого банка'))))
    await store.send(client)
    expect(store.lastAutoMarked).toBe(1)
    expect(finance.payments.find((p) => p.kind === 'salary' && p.period === '2026-10')).toMatchObject({ amount: 700_000, source: 'statement' })
  })

  it('возврат приёмки п. 1: выписка A не предлагает и не отмечает зарплату партнёра — ни вопросом, ни старым правилом', async () => {
    const finance = family()
    const { client } = fakeServer()
    const store = useOperationsStore()
    // 500 000 20-го — ровно оклад Аруны (b), у Ильяса (a) 700 000 10-го: на телефоне A вопроса нет.
    store.setDraft(draftOf(statement('2026-09-01', '2026-09-20', op('2026-09-20', 500_000, 'С карты другого банка'))))
    await store.send(client)
    expect(store.pendingMatches).toEqual([])

    // Правило «это зарплата Аруны», записанное в личный документ A до правки, месяц B не закрывает.
    finance.addMerchantRule({ match: { merchant: normalizeMerchant('С карты другого банка') }, to: { payment: { kind: 'salary', targetId: 'b' } } }, 'a')
    vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
    store.setDraft(draftOf(statement('2026-10-01', '2026-10-20', op('2026-10-20', 500_000, 'С карты другого банка'))))
    expect(store.draftAutoMatches).toEqual([])
    await store.send(client)
    expect(store.lastAutoMarked).toBe(0)
    expect(finance.payments.filter((p) => p.kind === 'salary')).toEqual([])
  })

  it('viewer предложений не получает', async () => {
    signIn('b', 'viewer')
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    const store = useOperationsStore()
    expect(store.pendingMatches).toEqual([])
  })
})
