import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, type ApiClient } from '@/api/client'
import { DEMO_TOKEN, useAuthStore } from './auth'
import { useAiStore } from './ai'
import { useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { leadFor, seedOwnMonth } from '@/test/reviewV4'
import type { AiReview, ReviewPayloadV4, SyncDoc } from '@/types/finance'

/**
 * Разбор сам (бэклог «ИИ-польза», Р-4, Р-20, AU-13) — v4 (бэклог «Фидбек», Р-23, Р-27, FB-16): повод `month` (первый вход
 * в месяце) и `salary` (своя первая «Пришла») — **свой у каждого** по своим разборам личного документа; разбор партнёра
 * и общий v1–v3 месяца повод не закрывают. Молча при «Не надо», без сети, при 429; согласие v1 — лист один раз. Ручка —
 * фейковый клиент со счётчиком запросов; свой месяц — `seedOwnMonth` (карточка «Не разобрано»).
 */
const NOW = '2026-09-12T07:00:00Z'
const KEY = '2026-09'
const ATTEMPT = `v4:month:${KEY}`

function fakeClient(priv: Record<string, unknown> = {}) {
  const aiReview = vi.fn(async (body: unknown) => leadFor(body))
  const client = {
    aiReview,
    getPrivateDoc: vi.fn(async () => ({ rev: 1, data: priv })),
  } as unknown as ApiClient
  return { client, aiReview }
}

type FamilyOpts = { role?: 'member' | 'viewer'; doc?: SyncDoc; consent?: 'v2' | 'v1' | 'off' | 'none'; mine?: AiReview[]; own?: boolean }

/** Телефон участника: стор, согласие, свои разборы v4 (`mine`) и свой месяц (`own`, по умолчанию — есть). */
async function phone(opts: FamilyOpts = {}) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.setAuthData(authAs(opts.role ?? 'member', 'a'))
  auth.ai = true
  const finance = useFinanceStore()
  finance.setHouseholdDoc(opts.doc ?? planFamilyDoc(), 1)
  const ai = useAiStore()
  ai.sheetMounted = true
  const c = opts.consent ?? 'v2'
  if (c === 'v2') ai.setConsent(true)
  if (c === 'off') ai.setConsent(false)
  if (c === 'v1') finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: true, at: T0 }))
  if (opts.mine) finance.mutatePrivateDoc((d) => void (d.aiReviews = opts.mine))
  if (opts.own !== false && (opts.role ?? 'member') === 'member') await seedOwnMonth(KEY)
  return { auth, finance, ai }
}

/** Новый «телефон»: своё хранилище (увиденный разбор, попытки) и свой стор. */
async function family(opts: FamilyOpts = {}) {
  localStorage.clear()
  return phone(opts)
}

/** Свой разбор v4 (личный документ). */
const mine = (extra: Partial<AiReview> = {}): AiReview => ({
  id: 'r-a', month: KEY, at: '2026-09-01T03:00:00.000Z', by: 'a', good: '', risk: '', steps: [], sent: null,
  v: 4, reason: 'month', reasonKey: `month:${KEY}`, lead: { title: 'Главное', text: 'Текст.', figure: null }, next: 'unknown', updatedAt: T0, ...extra,
})
/** Разбор v3 партнёра в общем документе (сборка до v4). */
const shared = (extra: Partial<AiReview> = {}): AiReview => ({
  id: 'r-b', month: KEY, at: '2026-09-01T03:00:00.000Z', by: 'b', good: '', risk: '', steps: [], sent: null,
  v: 3, reason: 'month', reasonKey: `month:${KEY}`, where: 'Где.', advices: [], updatedAt: T0, ...extra,
})
const attempt = () => JSON.parse(localStorage.getItem('ff_ai_auto')!)[ATTEMPT]

beforeEach(() => {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
  })
  // Синк общего и личного документа — «нет сети»: тест смотрит только на ручку разбора.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('autoReview — повод «месяц», свой у каждого', () => {
  it('месяц без своего разбора → один запрос v4 `month`; разбор — в личном документе с ключом повода; повторный вход — 0', async () => {
    const { finance, ai } = await family()
    const { client, aiReview } = fakeClient()
    const r = await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(aiReview.mock.calls[0][0]).toMatchObject({ v: 4, reason: 'month' })
    expect(r).toMatchObject({ v: 4, reason: 'month', reasonKey: `month:${KEY}`, by: 'a', next: 'unknown' })
    expect(finance.aiReviewOf(KEY)!.id).toBe(r!.id)
    expect(finance.myAiReviews.map((x) => x.id)).toEqual([r!.id])
    expect(finance.householdDoc.aiReviews ?? []).toEqual([])
    // Фоном — без «Думаю…» на экране.
    expect(ai.reviewState).toBe('idle')
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('разбор партнёра (общий v3 этого повода) повод не закрывает — свой первый v4 сам; свой v4 — закрывает', async () => {
    const { ai } = await family({ doc: planFamilyDoc({ aiReviews: [shared()] }) })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).not.toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
    const done = await family({ mine: [mine()] })
    await done.ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('два вызова сразу (focus и visibility) — один запрос', async () => {
    const { ai } = await family()
    const { client, aiReview } = fakeClient()
    await Promise.all([ai.autoReview(client), ai.autoReview(client)])
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('прошлый месяц не повод: свой разбор сентября есть, а 1 октября — новый запрос', async () => {
    const { ai, finance } = await family({ mine: [mine()] })
    const { client, aiReview } = fakeClient()
    vi.setSystemTime(new Date('2026-09-30T20:00:00Z')) // 1 октября 01:00 по Алматы
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(finance.aiReviewOf('2026-10')!.reasonKey).toBe('month:2026-10')
  })

  it('своих карточек нет (выписок нет) — запроса нет, ничего не сохранено, попытка не тратится: выписка того же дня — разбор сразу', async () => {
    const { ai, finance } = await family({ own: false })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
    expect(finance.myAiReviews).toEqual([])
    expect(localStorage.getItem('ff_ai_auto')).toBeNull()
    await seedOwnMonth(KEY)
    expect(await ai.autoReview(client)).not.toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('попытки v3 того же утра (прошлая сборка) не держат попытку v4', async () => {
    const { ai } = await family()
    localStorage.setItem('ff_ai_auto', JSON.stringify({ [`month:${KEY}`]: { at: '2026-09-12T06:00:00.000Z', done: true }, [`v3:month:${KEY}`]: { at: '2026-09-12T06:00:00.000Z', done: true } }))
    const { client, aiReview } = fakeClient()
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('демо и viewer → 0', async () => {
    const { client, aiReview } = fakeClient()
    const demo = await family()
    demo.auth.setAuthData({ ...authAs('member'), token: DEMO_TOKEN })
    demo.auth.ai = true
    await demo.ai.autoReview(client)
    await (await family({ role: 'viewer', doc: planFamilyDoc({ aiReviews: [shared()] }) })).ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })
})

describe('autoReview — повод «зарплата»', () => {
  it('своя первая «Пришла» месяца → 1 запрос `salary`; вторая отметка (аванс) → 0; отметка партнёра → 0', async () => {
    const { finance, ai } = await family({ mine: [mine()] })
    const { client, aiReview } = fakeClient()
    finance.markSalary('a')
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('salary')
    expect(finance.aiReviewOf(KEY)!.reasonKey).toBe(`salary:${KEY}`)
    // Вторая своя отметка того же месяца (аванс — `period` днём, как пишет ритм) — тот же повод, нет.
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
    const first = finance.householdDoc.payments!.find((p) => p.kind === 'salary' && p.targetId === 'a')!
    finance.mutateHouseholdDoc((d) => {
      d.payments!.push({ ...first, id: 'advance', period: '2026-09-25', updatedAt: new Date().toISOString() })
    })
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    finance.markSalary('b')
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('одна «Пришла» с двух телефонов офлайн — одна отметка (`salaryMarks` на `countedPayments`), повод один', async () => {
    const { finance, ai } = await family({ mine: [mine()] })
    const { client, aiReview } = fakeClient()
    finance.markSalary('a')
    const first = finance.householdDoc.payments!.find((p) => p.kind === 'salary' && p.targetId === 'a')!
    finance.mutateHouseholdDoc((d) => void d.payments!.push({ ...first, id: 'twin', at: '2026-09-12T08:00:00.000Z' }))
    expect(ai.salaryMarks(KEY)).toHaveLength(1)
    expect(ai.salaryMarks(KEY)[0].id).toBe(first.id)
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('отметка задним числом (`at` — день аванса раньше разбора месяца) — всё равно повод: важен момент записи', async () => {
    const { finance, ai } = await family({ mine: [mine({ at: '2026-09-10T03:00:00.000Z' })] })
    const { client, aiReview } = fakeClient()
    finance.markSalary('a', { at: '2026-09-05T03:00:00.000Z' })
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('salary')
  })

  it('свой разбор месяца позже моей отметки — зарплата уже учтена; общий разбор партнёра позже — не мой, повод есть', async () => {
    const { client, aiReview } = fakeClient()
    const later = await family({ mine: [mine({ at: '2026-09-12T09:00:00.000Z' })] })
    later.finance.markSalary('a')
    await later.ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
    const partner = await family({ mine: [mine()], doc: planFamilyDoc({ aiReviews: [shared({ at: '2026-09-12T09:00:00.000Z' })] }) })
    partner.finance.markSalary('a')
    await partner.ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })
})

describe('autoReview — молча', () => {
  it('«Не надо» → 0; не спрошено никогда → 0 и без листа', async () => {
    const { client, aiReview } = fakeClient()
    await (await family({ consent: 'off' })).ai.autoReview(client)
    const none = await family({ consent: 'none' })
    await none.ai.autoReview(client)
    expect(none.ai.sheetOpen).toBe(false)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('без сети → 0', async () => {
    const { ai } = await family()
    const { client, aiReview } = fakeClient()
    vi.stubGlobal('navigator', { onLine: false })
    await ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('429 → тишина: разбора нет, состояние листа не меняется; тот же повод в тот же день — 0, через сутки — снова', async () => {
    const { finance, ai } = await family()
    const { client, aiReview } = fakeClient()
    aiReview.mockRejectedValueOnce(new ApiError('ai_limit', 429))
    expect(await ai.autoReview(client)).toBeNull()
    expect(ai.reviewState).toBe('idle')
    expect(finance.aiReviewOf(KEY)).toBeNull()
    vi.setSystemTime(new Date('2026-09-12T20:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(2)
    expect(finance.aiReviewOf(KEY)).not.toBeNull()
  })

  it('502 — молча и сутки (каждый pull не платит заново); сеть — ответ мог потеряться: один повтор после окна, затем сутки', async () => {
    const { ai } = await family()
    const { client, aiReview } = fakeClient()
    aiReview
      .mockRejectedValueOnce(new ApiError('ai_failed', 502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await ai.autoReview(client)
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(2)
    // Сеть оборвалась (перезагрузка посреди запроса рвёт fetch так же, RZ-HF2): в окне ответа — ждём…
    vi.setSystemTime(new Date('2026-09-13T08:01:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(2)
    // …после окна — один повтор; оборвался и он — до суток тишина.
    vi.setSystemTime(new Date('2026-09-13T08:03:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(3)
    vi.setSystemTime(new Date('2026-09-13T15:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(3)
    expect(ai.reviewState).toBe('idle')
  })

  // Перезапуск: новый стор, тот же localStorage.
  const restart = async (opts: FamilyOpts = {}) => (await phone(opts)).ai

  it('закрыли PWA посреди запроса (RZ-HF2): в окне ответа — 0; после окна — повтор один раз; оборвался и он — сутки', async () => {
    const { client, aiReview } = fakeClient()
    aiReview.mockImplementation(() => new Promise(() => {}))
    void (await family()).ai.autoReview(client)
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date('2026-09-12T07:00:30Z'))
    expect(await (await restart()).autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-12T07:04:00Z'))
    void (await restart()).autoReview(client)
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(2))
    expect(attempt()).toMatchObject({ retry: true })
    vi.setSystemTime(new Date('2026-09-12T07:10:00Z'))
    expect(await (await restart()).autoReview(client)).toBeNull()
    vi.setSystemTime(new Date('2026-09-12T20:00:00Z'))
    expect(await (await restart()).autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(2)
    // Через сутки — заново (и без `retry` прошлой попытки).
    aiReview.mockImplementation(async (body: unknown) => leadFor(body))
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    expect(await (await restart()).autoReview(client)).not.toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(3)
    expect(attempt()).toMatchObject({ done: true })
    expect(attempt().retry).toBeUndefined()
  })

  it('исход дошёл до стора (502) → `done`: перезапуск через 4 минуты — 0, повтора оборванной нет', async () => {
    const { client, aiReview } = fakeClient()
    aiReview.mockRejectedValueOnce(new ApiError('ai_failed', 502))
    await (await family()).ai.autoReview(client)
    expect(attempt()).toMatchObject({ done: true })
    vi.setSystemTime(new Date('2026-09-12T07:04:00Z'))
    expect(await (await restart()).autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('исход сентябрьской попытки пришёл уже в октябре — попытку октября второй вкладки не стирает: ≤ 2 запроса на повод (критик RZ-HF2)', async () => {
    vi.setSystemTime(new Date('2026-09-30T18:59:30Z')) // 30 сентября 23:59:30 по Алматы
    const { client, aiReview } = fakeClient()
    let fail!: (e: unknown) => void
    aiReview.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const september = (await family()).ai.autoReview(client)
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date('2026-09-30T19:00:10Z'))
    aiReview.mockImplementation(() => new Promise(() => {}))
    void (await restart()).autoReview(client)
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(2))
    fail(new ApiError('ai_failed', 502))
    await september
    expect(JSON.parse(localStorage.getItem('ff_ai_auto')!)['v4:month:2026-10']).toMatchObject({ at: '2026-09-30T19:00:10.000Z' })
    vi.setSystemTime(new Date('2026-09-30T19:02:00Z'))
    void (await restart()).autoReview(client)
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(3))
    vi.setSystemTime(new Date('2026-09-30T19:04:00Z'))
    expect(await (await restart()).autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(3)
  })

  it('свой разбор повода ушёл в надгробие обрезкой «живых ≤ 12» — повод всё равно был: 0', async () => {
    const { ai } = await family({ mine: [mine({ deletedAt: '2026-09-11T10:00:00.000Z' })] })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
  })
})

describe('autoReview — согласие v1', () => {
  it('«да» v1 → лист согласия в этот момент; «Включить» → запрос', async () => {
    const { ai, finance } = await family({ consent: 'v1' })
    const { client, aiReview } = fakeClient({ aiConsent: { on: true, at: T0 } })
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    expect(aiReview).not.toHaveBeenCalled()
    ai.answer(true)
    await run
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(finance.privateDoc.aiConsent).toMatchObject({ on: true, v: 3 })
  })

  it('личный документ не подтянулся — лист не показан, повод не «спрошен»: на следующем круге лист всплывает', async () => {
    const { ai } = await family({ consent: 'v1' })
    const { client, aiReview } = fakeClient({ aiConsent: { on: true, at: T0 } })
    const failing = { ...client, getPrivateDoc: vi.fn(async () => Promise.reject(new ApiError('server', 500))) } as unknown as ApiClient
    expect(await ai.autoReview(failing)).toBeNull()
    expect(ai.sheetOpen).toBe(false)
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(true)
    await run
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('листа нет (экран без оболочки) — повод не тратится; оболочка смонтирована — лист', async () => {
    const { ai } = await family({ consent: 'v1' })
    const { client } = fakeClient({ aiConsent: { on: true, at: T0 } })
    ai.sheetMounted = false
    expect(await ai.autoReview(client)).toBeNull()
    ai.sheetMounted = true
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(null)
    await run
  })

  it('закрыл лист без ответа — запроса нет, и до следующего повода лист не всплывает', async () => {
    const { ai, finance } = await family({ consent: 'v1', mine: [mine()] })
    const { client, aiReview } = fakeClient({ aiConsent: { on: true, at: T0 } })
    finance.markSalary('a')
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(null)
    await run
    expect(aiReview).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-09-14T08:00:00Z'))
    await ai.autoReview(client)
    expect(ai.sheetOpen).toBe(false)
    expect(aiReview).not.toHaveBeenCalled()
  })
})

describe('reviewUnseen — точка «новый разбор»', () => {
  it('свой разбор месяца не открыт → точка; открыли — нет; viewer — общий v3 месяца (читает старые) — точка', async () => {
    const { ai } = await family({ mine: [mine()] })
    expect(ai.reviewUnseen).toBe(true)
    ai.markReviewSeen('r-a')
    expect(ai.reviewUnseen).toBe(false)
    expect((await family({ role: 'viewer', doc: planFamilyDoc({ aiReviews: [shared()] }) })).ai.reviewUnseen).toBe(true)
    expect((await family()).ai.reviewUnseen).toBe(false)
  })
})

// FB-16 (Р-26, Р-27): что сохраняет разбор v4 — мысль с фактом крупной цифры, следующая карточка, счётчик — в личном.
describe('requestReview v4 — сохранение', () => {
  it('figure → факт {about, value, label}; next → id карточки кода; work — свои операции и карточки; партнёр не видит', async () => {
    const { ai, finance } = await family()
    const { client, aiReview } = fakeClient()
    aiReview.mockImplementation(async (body: unknown) => {
      const b = body as ReviewPayloadV4
      const share = b.facts.find((f) => f.about === 'траты без раздела — доля своих трат месяца')!
      return { title: 'Без раздела', text: 'Разберём — и план станет честным.', figure: share.id, next: b.cards[0].id }
    })
    const r = await ai.runReview(KEY, 'month', client)
    expect(r).toMatchObject({
      v: 4,
      lead: { title: 'Без раздела', text: 'Разберём — и план станет честным.', figure: { about: 'траты без раздела — доля своих трат месяца', value: '30 %', label: 'своих трат без раздела' } },
      next: 'unknown',
      // Карточки: «Не разобрано» 30 000 и «Поставить план» продуктов (плана нет, 70 000).
      work: { ops: 2, found: 2, monthly: 100_000 },
    })
    // Партнёр: тот же общий документ, свой личный — моего разбора нет.
    const partner = await family({ doc: finance.householdDoc, own: false })
    expect(partner.finance.aiReviewOf(KEY)).toBeNull()
  })

  it('next не из присланных карточек — разбор не сохраняется, «Не вышло»', async () => {
    const { ai, finance } = await family()
    const { client, aiReview } = fakeClient()
    aiReview.mockResolvedValue({ title: 'Чужое', text: 'Текст.', figure: null, next: 'c9' })
    expect(await ai.runReview(KEY, 'month', client)).toBeNull()
    expect(ai.reviewState).toBe('failed')
    expect(finance.myAiReviews).toHaveLength(0)
  })

  it('карточки — по своим операциям телефона: «Не разобрано» своих 30 из 100 и продукты без плана', async () => {
    const { ai } = await family()
    expect(useOperationsStore().all.every((o) => o.id.startsWith('aa'))).toBe(true)
    const { client, aiReview } = fakeClient()
    await ai.runReview(KEY, 'month', client)
    expect((aiReview.mock.calls[0][0] as ReviewPayloadV4).cards.map((c) => c.kind)).toEqual(['unknown', 'plan'])
  })
})
