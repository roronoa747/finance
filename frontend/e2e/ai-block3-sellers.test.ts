import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { assignIds, type UnknownGroup } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { Decision } from '../src/lib/finance'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Week from '../src/views/Week.vue'
import {
  at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor,
  type FakePrivate, type FakeServer, type FakeStatements,
} from './support/family'

/**
 * Блок 3 «ИИ» (AI-11…AI-13): предложения разделов незнакомым продавцам на двух телефонах против фейковых сервера
 * документа, личных документов и выписок. Телефон 1 загружает выписку с незнакомыми → открывает пачку «Без раздела»
 * (согласие → один запрос `/api/ai/sellers`) → ✓ у одного продавца: правило — в его личном документе, у партнёра
 * личный документ не тронут, а итоги разделов в общем документе пересчитаны и видны ему. Повторное открытие — запросов
 * 0. Тело запроса — по проводу (настоящий `ApiClient` в фейковый `fetch`): только названия продавцов и разделы.
 * Экраны — SSR (`screen`): `onMounted` в SSR не идёт, поэтому «открыть пачку» — тот же `suggestSellers(groups)`, что
 * зовёт `UnknownBatch` при открытии, на группах открытой пачки; ✓ — его `accept`. Браузер — стенд §6.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const ANSWER = {
  items: [
    { name: 'Respect Boutique', categoryId: 'sc_shopping' },
    { name: 'Tau Lider', categoryId: null },
  ],
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const op = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...extra,
})

describe('e2e / ИИ Блок 3 — незнакомые продавцы', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate
  let wire: string[]

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    // Ручка продавцов — по проводу: тело запроса сохраняется, ответ — заготовка; остальное — «нет сети», телефоны
    // синкаются явно своим клиентом.
    wire = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).endsWith('/api/ai/sellers')) throw new Error('офлайн')
        wire.push(String(init?.body))
        return new Response(JSON.stringify(ANSWER), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )
    vi.useFakeTimers({ toFake: ['Date'] })
    at('2026-09-24T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    pv = fakePrivate()
    pv.docs.set('u-b', { rev: 3, data: { merchantRules: [] } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Телефон участника: семья с ИИ, свой личный документ; ручка продавцов — настоящий клиент (провод — `fetch`). */
  async function phone(slot: 'a' | 'b'): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const user = `u-${slot}`
    const auth = useAuthStore()
    auth.setAuthData(authAs('member', slot))
    auth.ai = true
    const client = {
      ...backend(server),
      ...statementsFor(st, user, slot),
      ...privateFor(pv, user),
      aiSellers: (names: string[], categories: { id: string; name: string }[]) => apiClient.aiSellers(names, categories),
    } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await store.pullPrivateDoc(client)
    const ops = useOperationsStore()
    await ops.loadUploads(client)
    await ops.pull(client)
    // Лист согласия живёт в оболочке; здесь — стор «спрашивает», ответ даёт тест.
    useAiStore().sheetMounted = true
    return { pinia, client, store }
  }

  /** Выписка телефона 1: незнакомые — бутик, магазин, «ИП + фамилия» и перевод человеку; Magnum словарь знает. */
  async function uploadA(A: Phone) {
    const operations = [
      op('2026-09-21', -59_500, 'Respect Boutique'),
      op('2026-09-22', -8_000, 'Tau Lider'),
      op('2026-09-22', -5_000, 'ИП Абенова'),
      op('2026-09-23', -17_300, 'Дана К.', { counterparty: 'Дана К.' }),
      op('2026-09-23', -18_000, 'Magnum'),
    ]
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-09-01', to: '2026-09-24', skipped: 0, operations: assignIds(operations) }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'a.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)
    return ops
  }

  /** «Неделя» с открытым листом вопросов; `act` — нажатие в нём. */
  const week = (p: Phone, act?: (s: Record<string, unknown>) => void) =>
    screen(p.pinia, Week, '/week', undefined, [screenMixin({ questionsOpen: true }, act)]).then(text)

  /** Открыть пачку: группы, которые она получила, — и тот же вызов, что `UnknownBatch` делает при открытии. */
  async function openBatch(p: Phone, consent?: boolean) {
    let groups: UnknownGroup[] = []
    const html = await week(p, (s) => void (groups = (s.decision as Decision).groups ?? []))
    setActivePinia(p.pinia)
    const ai = useAiStore()
    const asked = ai.suggestSellers(groups, p.client)
    if (consent !== undefined) {
      await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
      ai.answer(consent)
    }
    await asked
    return html
  }

  /** Итог недели участника a по разделу — в общем документе. */
  const weekOf = (p: Phone, categoryId: string) =>
    (p.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W39' && t.categoryId === categoryId).reduce((a, t) => a + t.amount, 0)

  it('телефон 1: согласие → один запрос, ✓ у продавца → правило в его личном документе; партнёр правила не видит, итоги видит; повтор — 0 запросов', async () => {
    const A = await phone('a')
    const ops = await uploadA(A)
    const B = await phone('b')
    expect(weekOf(B, '_unknown')).toBe(59_500 + 8_000 + 5_000 + 17_300)

    expect(await openBatch(A, true)).toContain('Без раздела · 4')
    // По проводу — один запрос: только названия (без «ИП + фамилия» и перевода человеку) и разделы {id, name}.
    expect(wire).toHaveLength(1)
    const body = JSON.parse(wire[0]) as { names: string[]; categories: { id: string; name: string }[] }
    expect(Object.keys(body).sort()).toEqual(['categories', 'names'])
    expect(body.names).toEqual(['Respect Boutique', 'Tau Lider'])
    expect(body.categories.every((c) => Object.keys(c).sort().join() === 'id,name')).toBe(true)
    for (const bad of ['59500', '59 500', '8000', 'Абенова', 'Дана', '2026-09', 'u-a', 'h-family']) expect(wire[0], bad).not.toContain(bad)

    // Пачка: у бутика — чип и ✓, у Tau Lider (null) — нет; само ничего не применилось.
    let html = await week(A)
    expect(html).toContain('ИИ предлагает · 1')
    expect(html).toContain('Одежда и покупки')
    setActivePinia(A.pinia)
    expect(A.store.privateDoc.merchantRules ?? []).toHaveLength(0)

    // ✓ у бутика — `accept` пачки (поля пачки — первыми: `props` есть у многих компонентов).
    html = await week(A, (s) => {
      const accept = s.accept as (g: UnknownGroup, id: string) => void
      const hintOf = s.hintOf as (g: UnknownGroup) => { id: string } | null
      const g = (s.props as { groups: UnknownGroup[] }).groups.find((x) => x.label === 'Respect Boutique')!
      accept(g, hintOf(g)!.id)
    })
    await ops.flush(A.client)
    setActivePinia(A.pinia)
    await A.store.syncPrivate(A.client)
    await A.store.syncHousehold(A.client)
    html = await week(A)
    expect(html).toContain('Без раздела · 3')
    expect(html).not.toContain('Respect Boutique')

    // Правило — в личном документе телефона 1 на сервере; у партнёра личный документ не тронут.
    const rulesA = (pv.docs.get('u-a')?.data.merchantRules ?? []) as { match: unknown; to: unknown }[]
    expect(rulesA.map((r) => [r.match, r.to])).toEqual([[{ merchant: 'respect boutique' }, { categoryId: 'sc_shopping' }]])
    expect(pv.docs.get('u-b')).toEqual({ rev: 3, data: { merchantRules: [] } })

    // Итоги — в общем документе: партнёр после синка видит бутик в «Одежде и покупках».
    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    await B.store.pullPrivateDoc(B.client)
    expect(weekOf(B, 'sc_shopping')).toBe(59_500)
    expect(weekOf(B, '_unknown')).toBe(8_000 + 5_000 + 17_300)
    expect(B.store.privateDoc.merchantRules).toEqual([])

    // Повторное открытие пачки — уже спрошенные не спрашиваются (Tau Lider с null — тоже).
    await openBatch(A)
    expect(wire).toHaveLength(1)
  })

  // Приёмка Блока 3 (AI-19): «ИП + фамилия» с привычкой — подсказка «Продукты» правилом кодом, по проводу ИП не уходит.
  it('частый ИП с мелким чеком: «Продукты» с ✓ без ИИ по проводу → правило sc_food у телефона 1, партнёр видит итог', async () => {
    const A = await phone('a')
    const operations = [
      op('2026-09-21', -59_500, 'Respect Boutique'),
      op('2026-09-05', -2_500, 'ИП Жакупов'),
      op('2026-09-12', -2_500, 'ИП Жакупов'),
      op('2026-09-21', -3_000, 'ИП Жакупов'),
      op('2026-09-22', -3_000, 'ИП Жакупов'),
      op('2026-09-23', -3_000, 'ИП Жакупов'),
      op('2026-09-22', -5_000, 'ИП Абенова'),
    ]
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-09-01', to: '2026-09-24', skipped: 0, operations: assignIds(operations) }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'a.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)
    const B = await phone('b')

    await openBatch(A, true)
    // По проводу — только бренд: ни частый ИП, ни редкий.
    expect(wire).toHaveLength(1)
    expect(JSON.parse(wire[0]).names).toEqual(['Respect Boutique'])
    for (const bad of ['Жакупов', 'Абенова']) expect(wire[0], bad).not.toContain(bad)

    // `asked` — флаг «вопрос ИИ на этом открытии кончился» (ставит `onMounted`, в SSR его нет).
    const open = { questionsOpen: true, asked: true }
    // Поля пачки — первыми: `props` есть у многих компонентов.
    const hint = (label: string) => (s: Record<string, unknown>) => {
      const hintOf = s.hintOf as (g: UnknownGroup) => { id: string } | null
      return hintOf((s.props as { groups: UnknownGroup[] }).groups.find((x) => x.label === label)!)
    }
    let seen: Record<string, string | null> = {}
    let html = text(await screen(A.pinia, Week, '/week', undefined, [screenMixin(open, (s) => {
      seen = { ip: hint('ИП Жакупов')(s)?.id ?? null, rare: hint('ИП Абенова')(s)?.id ?? null, brand: hint('Respect Boutique')(s)?.id ?? null }
    })]))
    expect(seen).toEqual({ ip: 'sc_food', rare: null, brand: 'sc_shopping' })
    expect(html).toContain('ИИ предлагает · 2')

    // ✓ у частого ИП — то же правило «продавец → раздел», что ответ чипами.
    await screen(A.pinia, Week, '/week', undefined, [screenMixin(open, (s) => {
      const accept = s.accept as (g: UnknownGroup, id: string) => void
      const id = hint('ИП Жакупов')(s)!.id
      accept((s.props as { groups: UnknownGroup[] }).groups.find((x) => x.label === 'ИП Жакупов')!, id)
    })])
    await ops.flush(A.client)
    setActivePinia(A.pinia)
    await A.store.syncPrivate(A.client)
    await A.store.syncHousehold(A.client)
    html = await week(A)
    expect(html).not.toContain('ИП Жакупов')
    const rulesA = (pv.docs.get('u-a')?.data.merchantRules ?? []) as { match: Record<string, string>; to: unknown }[]
    expect(rulesA.map((r) => [Object.keys(r.match), r.to])).toEqual([[['merchant'], { categoryId: 'sc_food' }]])
    expect(pv.docs.get('u-b')).toEqual({ rev: 3, data: { merchantRules: [] } })

    // Партнёр: покупки ИП этой недели — в «Продуктах», правил у него нет.
    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    await B.store.pullPrivateDoc(B.client)
    expect(weekOf(B, 'sc_food')).toBe(9_000)
    expect(B.store.privateDoc.merchantRules).toEqual([])
  })

  it('«Не надо» — запросов нет, пачка как без ИИ', async () => {
    const A = await phone('a')
    await uploadA(A)
    await openBatch(A, false)
    await openBatch(A)
    expect(wire).toHaveLength(0)
    const html = await week(A)
    expect(html).toContain('Без раздела · 4')
    expect(html).not.toContain('ИИ предлагает')
  })
})
