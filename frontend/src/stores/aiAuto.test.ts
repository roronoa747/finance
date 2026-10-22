import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, type ApiClient } from '@/api/client'
import { DEMO_TOKEN, useAuthStore } from './auth'
import { useAiStore } from './ai'
import { useFinanceStore } from './finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiReview, ReviewPayloadV3, SyncDoc } from '@/types/finance'
import type { ReviewFind } from '@/lib/statements/types'
import { money } from '@/lib/money'
import type { UploadPeriod } from '@/lib/finance'

/**
 * AU-13 (бэклог «ИИ-польза», Р-4, Р-20): разбор сам — повод `month` (первый вход в месяце) и `salary` (своя первая
 * «Пришла»), один на повод на семью по документу, молча при «Не надо», без сети, при 429; согласие v1 — лист один раз.
 * Ручка — фейковый клиент со счётчиком запросов.
 */
const NOW = '2026-09-12T07:00:00Z'
const KEY = '2026-09'
/** Ответ ручки v3 (RZ-05): совет на первое действие семьи — «досрочно» (`stepCandidates` `planFamilyDoc`). */
/** Запрос разбора идёт после загрузки операций и выписок (FB-HF1) — несколько ожиданий, не одна микрозадача. */
const tick = () => new Promise((r) => setTimeout(r, 0))
const ANSWER = { where: 'Хорошо.', advices: [{ title: 'Шаг', text: 'Риск.', figure: null, action: 'a1' }] }

function fakeClient(priv: Record<string, unknown> = {}) {
  const aiReview = vi.fn(async (_body: unknown) => ANSWER)
  // Свои операции и выписки с сервера — пусто, но пришли (FB-HF1: разбор ждёт их).
  const listOperations = vi.fn(async () => ({ operations: [], next: null }))
  const listStatementUploads = vi.fn(async () => ({ uploads: [] as UploadPeriod[] }))
  const client = {
    aiReview,
    getPrivateDoc: vi.fn(async () => ({ rev: 1, data: priv })),
    listOperations,
    listStatementUploads,
  } as unknown as ApiClient
  return { client, aiReview, listOperations, listStatementUploads }
}

function family(opts: { role?: 'member' | 'viewer'; doc?: SyncDoc; consent?: 'v2' | 'v1' | 'off' | 'none' } = {}) {
  // Новый «телефон»: своё хранилище (увиденный разбор, попытки) и свой стор.
  localStorage.clear()
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
  return { auth, finance, ai }
}

const review = (extra: Partial<AiReview>): AiReview => ({
  id: 'r-b', month: KEY, at: '2026-09-01T03:00:00.000Z', by: 'b', good: 'Партнёр.', risk: 'Риск.', steps: [], sent: null,
  v: 3, reason: 'month', reasonKey: `month:${KEY}`, updatedAt: T0, ...extra,
})
/** Разбор прошлой версии (v2 — «Хорошо · Риск · Шаг», до деплоя «Разбора»). */
const reviewV2 = (extra: Partial<AiReview> = {}): AiReview => review({ v: 2, step: { text: 'Шаг', candidate: null }, ...extra })

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

describe('autoReview — повод «месяц»', () => {
  it('месяц без разбора → один запрос `month`, разбор в документе с ключом повода; повторный вход — 0', async () => {
    const { finance, ai } = family()
    const { client, aiReview } = fakeClient()
    const r = await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('month')
    expect(r).toMatchObject({ v: 3, reason: 'month', reasonKey: `month:${KEY}`, by: 'a' })
    expect(finance.aiReviewOf(KEY)!.id).toBe(r!.id)
    // Фоном — без «Думаю…» на экране.
    expect(ai.reviewState).toBe('idle')
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('разбор партнёра этого повода в документе → 0', async () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [review({})] }) })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('два вызова сразу (focus и visibility) — один запрос', async () => {
    const { ai } = family()
    const { client, aiReview } = fakeClient()
    await Promise.all([ai.autoReview(client), ai.autoReview(client)])
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('прошлый месяц не повод: разбор сентября есть, а 1 октября — новый запрос', async () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [review({})] }) })
    const { client, aiReview } = fakeClient()
    vi.setSystemTime(new Date('2026-09-30T20:00:00Z')) // 1 октября 01:00 по Алматы
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(useFinanceStore().aiReviewOf('2026-10')!.reasonKey).toBe('month:2026-10')
  })
})

// RZ-HF1 (хотфикс после деплоя Блока 1, владелец 2026-10-18 «старый → новый сам»): разбор месяца v2/v1 — повод открыт.
describe('autoReview — старый разбор месяца → v3 сам', () => {
  it('утром был разбор v2 (и попытка v2 этого повода час назад) → один запрос v3; повторный вход — 0', async () => {
    const { finance, ai } = family({ doc: planFamilyDoc({ aiReviews: [reviewV2({ at: '2026-09-12T06:00:00.000Z' })] }) })
    localStorage.setItem('ff_ai_auto', JSON.stringify({ [`month:${KEY}`]: { at: '2026-09-12T06:00:00.000Z' } }))
    const { client, aiReview } = fakeClient()
    const r = await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('month')
    expect(r).toMatchObject({ v: 3, reasonKey: `month:${KEY}` })
    expect(finance.aiReviewOf(KEY)!.id).toBe(r!.id)
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('разбор v1 (без версии) — тоже старый → запрос', async () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [review({ v: undefined, reason: undefined, reasonKey: undefined })] }) })
    const { client, aiReview } = fakeClient()
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('партнёр уже заменил старый разбор v3 (тот же документ) → 0: один разбор на семью', async () => {
    const doc = planFamilyDoc({ aiReviews: [reviewV2({ id: 'old' }), review({ id: 'new', at: '2026-09-12T06:30:00.000Z' })] })
    const { ai } = family({ doc })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('часы телефона отстали: v3 вышел по `at` раньше v2 — замена уже была, 0 (не платим каждый день)', async () => {
    const doc = planFamilyDoc({ aiReviews: [reviewV2({ id: 'old', at: '2026-09-12T06:00:00.000Z' }), review({ id: 'new', at: '2026-09-12T05:00:00.000Z' })] })
    const { finance, ai } = family({ doc })
    expect(finance.aiReviewOf(KEY)!.id).toBe('old')
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('последний — v2 по зарплате: один запрос v3 `month`, и зарплата не повод снова', async () => {
    vi.setSystemTime(new Date('2026-09-10T05:00:00Z'))
    const { finance, ai } = family({
      doc: planFamilyDoc({ aiReviews: [reviewV2({ id: 'm' }), reviewV2({ id: 's', by: 'a', reason: 'salary', reasonKey: `salary:a:${KEY}`, at: '2026-09-10T06:00:00.000Z' })] }),
    })
    finance.markSalary('a')
    vi.setSystemTime(new Date(NOW))
    const { client, aiReview } = fakeClient()
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('month')
    vi.setSystemTime(new Date('2026-09-14T08:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('«да» v2 + старый разбор → лист согласия v3 один раз (утренний `asked` повода v2 не мешает); закрыл — не всплывает', async () => {
    const old = { on: true, at: T0, v: 2 }
    const { ai, finance } = family({ consent: 'none', doc: planFamilyDoc({ aiReviews: [reviewV2()] }) })
    finance.mutatePrivateDoc((d) => void (d.aiConsent = old))
    localStorage.setItem('ff_ai_auto', JSON.stringify({ [`month:${KEY}`]: { at: '2026-09-12T03:00:00.000Z', asked: true } }))
    const { client, aiReview } = fakeClient({ aiConsent: old })
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(null)
    await run
    vi.setSystemTime(new Date('2026-09-14T08:00:00Z'))
    await ai.autoReview(client)
    expect(ai.sheetOpen).toBe(false)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('неудача замены → сутки молча (своя попытка `v3:month`)', async () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [reviewV2()] }) })
    const { client, aiReview } = fakeClient()
    aiReview.mockRejectedValueOnce(new ApiError('ai_failed', 502))
    await ai.autoReview(client)
    vi.setSystemTime(new Date('2026-09-12T15:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(2)
  })

  it('демо и viewer со старым разбором → 0', async () => {
    const { client, aiReview } = fakeClient()
    const doc = () => planFamilyDoc({ aiReviews: [reviewV2()] })
    const demo = family({ doc: doc() })
    demo.auth.setAuthData({ ...authAs('member'), token: DEMO_TOKEN })
    demo.auth.ai = true
    await demo.ai.autoReview(client)
    await family({ role: 'viewer', doc: doc() }).ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })
})

describe('autoReview — повод «зарплата»', () => {
  it('своя первая «Пришла» месяца → 1 запрос `salary`; вторая отметка (аванс) → 0', async () => {
    const { finance, ai } = family({ doc: planFamilyDoc({ aiReviews: [review({})] }) })
    const { client, aiReview } = fakeClient()
    finance.markSalary('a')
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('salary')
    expect(finance.aiReviewOf(KEY)!.reasonKey).toBe(`salary:a:${KEY}`)
    // Вторая своя отметка того же месяца (аванс — `period` днём, как пишет ритм) — тот же повод, нет.
    vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
    const first = finance.householdDoc.payments!.find((p) => p.kind === 'salary' && p.targetId === 'a')!
    finance.mutateHouseholdDoc((d) => {
      d.payments!.push({ ...first, id: 'advance', period: '2026-09-25', updatedAt: new Date().toISOString() })
    })
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    // Отметка партнёра — не мой повод.
    finance.markSalary('b')
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('одна «Пришла» с двух телефонов офлайн — одна отметка (`salaryMarks` на `countedPayments`), повод один', async () => {
    const { finance, ai } = family({ doc: planFamilyDoc({ aiReviews: [review({})] }) })
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
    const { finance, ai } = family({ doc: planFamilyDoc({ aiReviews: [review({ at: '2026-09-10T03:00:00.000Z' })] }) })
    const { client, aiReview } = fakeClient()
    finance.markSalary('a', { at: '2026-09-05T03:00:00.000Z' })
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('salary')
  })

  it('зарплата партнёра — не мой повод; разбор месяца позже моей отметки — зарплата уже учтена', async () => {
    const { finance, ai } = family({ doc: planFamilyDoc({ aiReviews: [review({})] }) })
    const { client, aiReview } = fakeClient()
    finance.markSalary('b')
    await ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()

    const later = family({ doc: planFamilyDoc({ aiReviews: [review({ at: '2026-09-12T09:00:00.000Z' })] }) })
    later.finance.markSalary('a')
    await later.ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })
})

describe('autoReview — молча', () => {
  it('«Не надо» → 0; не спрошено никогда → 0 и без листа', async () => {
    const { client, aiReview } = fakeClient()
    await family({ consent: 'off' }).ai.autoReview(client)
    const none = family({ consent: 'none' })
    await none.ai.autoReview(client)
    expect(none.ai.sheetOpen).toBe(false)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('без сети → 0', async () => {
    const { ai } = family()
    const { client, aiReview } = fakeClient()
    vi.stubGlobal('navigator', { onLine: false })
    await ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('демо и viewer → 0', async () => {
    const { client, aiReview } = fakeClient()
    const demo = family()
    demo.auth.setAuthData({ ...authAs('member'), token: DEMO_TOKEN })
    demo.auth.ai = true
    await demo.ai.autoReview(client)
    await family({ role: 'viewer' }).ai.autoReview(client)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('429 → тишина: разбора нет, состояние листа не меняется; тот же повод в тот же день — 0, через сутки — снова', async () => {
    const { finance, ai } = family()
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
    const { ai } = family()
    const { client, aiReview } = fakeClient()
    aiReview
      .mockRejectedValueOnce(new ApiError('ai_failed', 502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await ai.autoReview(client)
    // Тот же день: focus, visibility, круг синка — без запроса.
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

  // Перезапуск: новый стор, тот же localStorage (family() его чистит — собираем «телефон» руками).
  const restart = (doc = planFamilyDoc()) => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.setAuthData(authAs('member', 'a'))
    auth.ai = true
    useFinanceStore().setHouseholdDoc(doc, 1)
    const ai = useAiStore()
    ai.sheetMounted = true
    ai.setConsent(true)
    return ai
  }

  it('закрыли PWA посреди запроса (RZ-HF2): в окне ответа — 0; после окна — повтор один раз; оборвался и он — сутки', async () => {
    const { client, aiReview } = fakeClient()
    aiReview.mockImplementation(() => new Promise(() => {}))
    void family().ai.autoReview(client)
    await tick()
    expect(aiReview).toHaveBeenCalledTimes(1)
    // Через 30 с: запрос, возможно, ещё идёт (вторая вкладка) — не дублируем.
    vi.setSystemTime(new Date('2026-09-12T07:00:30Z'))
    expect(await restart().autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
    // Через 4 минуты: ответ на мёртвую страницу потерян — повод повторяется сам (владелец 2026-10-18 ждал бы сутки).
    vi.setSystemTime(new Date('2026-09-12T07:04:00Z'))
    void restart().autoReview(client)
    await tick()
    expect(aiReview).toHaveBeenCalledTimes(2)
    expect(JSON.parse(localStorage.getItem('ff_ai_auto')!)[`month:${KEY}`]).toMatchObject({ retry: true })
    // Повтор тоже оборвался — больше не платим до суток.
    vi.setSystemTime(new Date('2026-09-12T07:10:00Z'))
    expect(await restart().autoReview(client)).toBeNull()
    vi.setSystemTime(new Date('2026-09-12T20:00:00Z'))
    expect(await restart().autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(2)
    // Через сутки — заново (и без `retry` прошлой попытки).
    aiReview.mockImplementation(async () => ANSWER)
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    expect(await restart().autoReview(client)).not.toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(3)
    expect(JSON.parse(localStorage.getItem('ff_ai_auto')!)[`month:${KEY}`]).toMatchObject({ done: true })
    expect(JSON.parse(localStorage.getItem('ff_ai_auto')!)[`month:${KEY}`].retry).toBeUndefined()
  })

  it('исход дошёл до стора (502) → `done`: перезапуск через 4 минуты — 0, повтора оборванной нет', async () => {
    const { client, aiReview } = fakeClient()
    aiReview.mockRejectedValueOnce(new ApiError('ai_failed', 502))
    await family().ai.autoReview(client)
    expect(JSON.parse(localStorage.getItem('ff_ai_auto')!)[`month:${KEY}`]).toMatchObject({ done: true })
    vi.setSystemTime(new Date('2026-09-12T07:04:00Z'))
    expect(await restart().autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('телефон владельца 2026-10-18: запись `v3:month` без исхода (до RZ-HF2) и v2 месяца → один запрос v3 сразу после деплоя', async () => {
    const doc = planFamilyDoc({ aiReviews: [reviewV2({ at: '2026-09-12T03:00:00.000Z' })] })
    const { finance, ai } = family({ doc })
    // Так писал код до хотфикса: попытка 2 часа назад, ответ пришёл на мёртвую страницу.
    localStorage.setItem('ff_ai_auto', JSON.stringify({ [`v3:month:${KEY}`]: { at: '2026-09-12T05:00:00.000Z' } }))
    const { client, aiReview } = fakeClient()
    const r = await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ v: 3, reasonKey: `month:${KEY}` })
    expect(finance.aiReviewOf(KEY)!.v).toBe(3)
    await restart(finance.householdDoc).autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('исход сентябрьской попытки пришёл уже в октябре — попытку октября второй вкладки не стирает: ≤ 2 запроса на повод (критик RZ-HF2)', async () => {
    vi.setSystemTime(new Date('2026-09-30T18:59:30Z')) // 30 сентября 23:59:30 по Алматы
    const { client, aiReview } = fakeClient()
    let fail!: (e: unknown) => void
    aiReview.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
    const september = family().ai.autoReview(client)
    await tick()
    // Полночь: вторая вкладка — повод октября; её запрос оборвали (страницу закрыли).
    vi.setSystemTime(new Date('2026-09-30T19:00:10Z'))
    aiReview.mockImplementation(() => new Promise(() => {}))
    void restart().autoReview(client)
    await tick()
    expect(aiReview).toHaveBeenCalledTimes(2)
    // Сентябрьский ответ (502) дошёл после полуночи — пишет свой исход, октябрьскую попытку не трогает.
    fail(new ApiError('ai_failed', 502))
    await september
    expect(JSON.parse(localStorage.getItem('ff_ai_auto')!)['month:2026-10']).toMatchObject({ at: '2026-09-30T19:00:10.000Z' })
    // Октябрь: один повтор оборванной после окна, дальше — сутки.
    vi.setSystemTime(new Date('2026-09-30T19:02:00Z'))
    void restart().autoReview(client)
    await tick()
    vi.setSystemTime(new Date('2026-09-30T19:04:00Z'))
    expect(await restart().autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(3)
  })

  it('разбор повода ушёл в надгробие обрезкой «живых ≤ 12» — повод всё равно был: 0', async () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [review({ deletedAt: '2026-09-11T10:00:00.000Z' })] }) })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
    // Надгробие старой версии — не «старый разбор» (показывать нечего, RZ-HF1): тоже 0.
    const old = family({ doc: planFamilyDoc({ aiReviews: [reviewV2({ deletedAt: '2026-09-11T10:00:00.000Z' })] }) })
    expect(await old.ai.autoReview(client)).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
  })
})

describe('autoReview — согласие v1', () => {
  it('«да» v1 → лист согласия v2 в этот момент; «Включить» → запрос', async () => {
    const { ai, finance } = family({ consent: 'v1' })
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
    const { ai } = family({ consent: 'v1' })
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
    const { ai } = family({ consent: 'v1' })
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
    const { ai, finance } = family({ consent: 'v1', doc: planFamilyDoc({ aiReviews: [review({})] }) })
    const { client, aiReview } = fakeClient({ aiConsent: { on: true, at: T0 } })
    // Повод «зарплата»: своя «Пришла».
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
  it('разбор месяца есть и не открыт → точка; открыли — нет; viewer — тоже точка', () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [review({})] }) })
    expect(ai.reviewUnseen).toBe(true)
    ai.markReviewSeen('r-b')
    expect(ai.reviewUnseen).toBe(false)
    expect(family({ role: 'viewer', doc: planFamilyDoc({ aiReviews: [review({})] }) }).ai.reviewUnseen).toBe(true)
    expect(family().ai.reviewUnseen).toBe(false)
  })
})

// RZ-05 (бэклог «Разбор», Р-15, Р-19): что сохраняет разбор v3 — факт крупной цифры, кнопка по id, счётчик.
describe('requestReview v3 — сохранение', () => {
  const leak = (by: 'a' | 'b', period: string): ReviewFind => ({
    id: `${by}:${period}:leak:apteka`, by, period, kind: 'leak', name: 'APTEKA', categoryId: 'sc_health', count: 8, amount: 12_000, updatedAt: T0,
  })
  // Двойное списание августа (месяц находок — прошлый: выписок сентября нет) — находка без совета: в K, но не в X.
  const double: ReviewFind = { id: 'a:2026-08:double:sport club', by: 'a', period: '2026-08', kind: 'double', name: 'SPORT CLUB', categoryId: 'sc_fun', count: 2, amount: 5_000, updatedAt: T0 }
  const doc = () => planFamilyDoc({ reviewFinds: [leak('a', '2026-07'), leak('b', '2026-08'), double] })

  it('figure → факт {about, value}; «Сделать» → кандидат, «Открыть» → экран; совет на чужое действие отброшен; work — по советам', async () => {
    const { ai } = family({ doc: doc() })
    const { client, aiReview } = fakeClient()
    aiReview.mockImplementation(async (body: unknown) => {
      const b = body as ReviewPayloadV3
      const open = b.actions.find((a) => a.kind === 'open' && a.about.includes('APTEKA'))!
      const monthly = b.facts.find((f) => f.about === 'частые траты у «APTEKA» — в месяц')!
      return {
        where: 'Где.',
        advices: [
          { title: 'Досрочно', text: 'Текст.', figure: null, action: 'a1' },
          { title: 'Чужое', text: 'Текст.', figure: null, action: 'a9' },
          { title: 'Аптека', text: 'Текст.', figure: monthly.id, action: open.id },
        ],
      } as never
    })
    const r = await ai.runReview(KEY, 'month', client)
    expect(r!.advices!.map((a) => a.title)).toEqual(['Досрочно', 'Аптека'])
    expect(r!.advices![0].action).toMatchObject({ kind: 'do', candidate: { kind: 'prepay' } })
    expect(r!.advices![1]).toMatchObject({
      figure: { about: 'частые траты у «APTEKA» — в месяц', value: money(12_000), label: 'в месяц · APTEKA' },
      action: { kind: 'open', target: { kind: 'seller', id: 'apteka' } },
    })
    // Утечка: 12 000 в месяц — только она в советах; «Сделать» находки не несёт; двойное (5 000 лишнего в месяц) нашли,
    // но совета о нём нет — в X не входит (Р-19, критик Блока 1: без `used` X был бы 17 000). Годовой суммы нет.
    expect(r!.work).toEqual({ ops: expect.any(Number), found: 2, monthly: 12_000 })
    expect(r!.where).toBe('Где.')
  })

  // Ревью frontend Н-2: X — по находке крупной цифры совета, без цифры — по кнопке.
  it('цифра утечки + «Сделать» — X = цена утечки в месяц; цифра двойного + «Открыть» аптеки — X = двойное', async () => {
    const answerWith = (figureAbout: string, action: (b: ReviewPayloadV3) => string) => async (body: unknown) => {
      const b = body as ReviewPayloadV3
      return { where: 'Где.', advices: [{ title: 'Совет', text: 'Текст.', figure: b.facts.find((f) => f.about === figureAbout)!.id, action: action(b) }] } as never
    }
    let { ai } = family({ doc: doc() })
    let { client, aiReview } = fakeClient()
    aiReview.mockImplementation(answerWith('частые траты у «APTEKA» — в месяц', () => 'a1'))
    let r = await ai.runReview(KEY, 'month', client)
    expect(r!.advices![0].action).toMatchObject({ kind: 'do' })
    expect(r!.work).toMatchObject({ found: 2, monthly: 12_000 })
    ;({ ai } = family({ doc: doc() }))
    ;({ client, aiReview } = fakeClient())
    aiReview.mockImplementation(answerWith('списание «SPORT CLUB» прошло дважды одной суммой — лишнее в месяц', (b) => b.actions.find((a) => a.kind === 'open' && a.about.includes('APTEKA'))!.id))
    r = await ai.runReview(KEY, 'month', client)
    expect(r!.advices![0].action).toMatchObject({ kind: 'open', target: { id: 'apteka' } })
    // Двойное: 5 000 лишнего в месяц; утечка кнопки (12 000) в X не идёт — на карточке число двойного.
    expect(r!.work).toMatchObject({ found: 2, monthly: 5_000 })
  })

  it('все советы на чужие действия — разбор не сохраняется, «Не вышло»', async () => {
    const { ai, finance } = family({ doc: doc() })
    const { client, aiReview } = fakeClient()
    aiReview.mockResolvedValue({ where: 'Где.', advices: [{ title: 'Чужое', text: 'Текст.', figure: null, action: 'a9' }] } as never)
    expect(await ai.runReview(KEY, 'month', client)).toBeNull()
    expect(ai.reviewState).toBe('failed')
    expect(finance.householdDoc.aiReviews ?? []).toHaveLength(0)
  })
})

// FB-HF1 (приёмка FB-13, хвост Х-1): разбор сам уходил сразу после документа, а выписки (`GET /api/statements`) шли
// параллельно — запрос успевал раньше: «7 находок из 0 операций», «обычных» месяцев нет, неполный разбор оплачен.
describe('разбор ждёт свои операции и выписки (FB-HF1)', () => {
  const usual = ['2026-06', '2026-07', '2026-08']
  const totals = usual.flatMap((period) =>
    (['a', 'b'] as const).map((by) => ({ id: `${by}:month:${period}:sc_food`, by, kind: 'month' as const, period, categoryId: 'sc_food', amount: 100_000, ops: 50, updatedAt: T0 })),
  )
  const uploads = ['a', 'b'].map((slot) => ({ slot, period_from: '2026-06-01', period_to: '2026-08-31' }))

  it('выписки пришли позже документа — запрос только после них; счётчик — операции трёх «обычных» месяцев', async () => {
    const { ai } = family({ doc: planFamilyDoc({ spendTotals: totals }) })
    const { client, aiReview, listStatementUploads } = fakeClient()
    let arrive!: () => void
    listStatementUploads.mockImplementation(() => new Promise((r) => (arrive = () => r({ uploads }))))
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(listStatementUploads).toHaveBeenCalled())
    await tick()
    expect(aiReview).not.toHaveBeenCalled()
    arrive()
    const r = await run
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(r!.work!.ops).toBe(300)
  })

  it('свои операции ещё идут (первый pull) — ждёт и их', async () => {
    const { ai } = family({ doc: planFamilyDoc({ spendTotals: totals }) })
    const { client, aiReview, listOperations, listStatementUploads } = fakeClient()
    listStatementUploads.mockResolvedValue({ uploads })
    let arrive!: () => void
    listOperations.mockImplementation(() => new Promise((r) => (arrive = () => r({ operations: [], next: null }))))
    const run = ai.autoReview(client)
    await vi.waitFor(() => expect(listOperations).toHaveBeenCalled())
    await tick()
    expect(aiReview).not.toHaveBeenCalled()
    arrive()
    await run
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('выписки не пришли (сеть) — запроса нет и попытка не записана; следующий круг — запрос', async () => {
    const { ai } = family({ doc: planFamilyDoc({ spendTotals: totals }) })
    const { client, aiReview, listStatementUploads } = fakeClient()
    listStatementUploads.mockRejectedValueOnce(new Error('сеть')).mockResolvedValue({ uploads })
    expect(await ai.autoReview(client)).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
    expect(localStorage.getItem('ff_ai_auto')).toBeNull()
    const r = await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(r!.work!.ops).toBe(300)
  })

  it('«Разобрать» во время загрузки — «Думаю…» ждёт выписки, потом один запрос; не пришли — «не вышло» без запроса', async () => {
    const { ai } = family({ doc: planFamilyDoc({ spendTotals: totals }) })
    const { client, aiReview, listStatementUploads } = fakeClient()
    let arrive!: () => void
    listStatementUploads.mockImplementationOnce(() => Promise.reject(new Error('сеть')))
    expect(await ai.runReview(KEY, 'month', client)).toBeNull()
    expect(ai.reviewState).toBe('failed')
    expect(aiReview).not.toHaveBeenCalled()
    listStatementUploads.mockImplementation(() => new Promise((r) => (arrive = () => r({ uploads }))))
    const run = ai.runReview(KEY, 'month', client)
    expect(ai.reviewState).toBe('thinking')
    await vi.waitFor(() => expect(listStatementUploads).toHaveBeenCalledTimes(2))
    await tick()
    expect(aiReview).not.toHaveBeenCalled()
    arrive()
    const r = await run
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(r!.work!.ops).toBe(300)
  })
})
