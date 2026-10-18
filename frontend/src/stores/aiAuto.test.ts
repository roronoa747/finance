import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, type ApiClient } from '@/api/client'
import { DEMO_TOKEN, useAuthStore } from './auth'
import { useAiStore } from './ai'
import { useFinanceStore } from './finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiReview, SyncDoc } from '@/types/finance'

/**
 * AU-13 (бэклог «ИИ-польза», Р-4, Р-20): разбор сам — повод `month` (первый вход в месяце) и `salary` (своя первая
 * «Пришла»), один на повод на семью по документу, молча при «Не надо», без сети, при 429; согласие v1 — лист один раз.
 * Ручка — фейковый клиент со счётчиком запросов.
 */
const NOW = '2026-09-12T07:00:00Z'
const KEY = '2026-09'
const ANSWER = { good: 'Хорошо.', risk: 'Риск.', step: { text: 'Шаг', candidate: null } }

function fakeClient(priv: Record<string, unknown> = {}) {
  const aiReview = vi.fn(async (_body: unknown) => ANSWER)
  const client = {
    aiReview,
    getPrivateDoc: vi.fn(async () => ({ rev: 1, data: priv })),
  } as unknown as ApiClient
  return { client, aiReview }
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
  v: 2, reason: 'month', reasonKey: `month:${KEY}`, step: { text: 'Шаг', candidate: null }, updatedAt: T0, ...extra,
})

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
    expect(r).toMatchObject({ v: 2, reason: 'month', reasonKey: `month:${KEY}`, by: 'a' })
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

  it('502 и сеть — так же молча; повтор того же повода — не раньше суток (каждый pull не платит заново)', async () => {
    const { ai } = family()
    const { client, aiReview } = fakeClient()
    aiReview.mockRejectedValueOnce(new ApiError('ai_failed', 502)).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await ai.autoReview(client)
    // Тот же день: focus, visibility, круг синка — без запроса.
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(2)
    // Сеть мигнула — тоже сутки.
    vi.setSystemTime(new Date('2026-09-13T15:00:00Z'))
    await ai.autoReview(client)
    expect(aiReview).toHaveBeenCalledTimes(2)
    expect(ai.reviewState).toBe('idle')
  })

  it('закрыли PWA посреди запроса (приёмка): перезапуск в тот же день — 0 новых запросов, через сутки — снова', async () => {
    const { client, aiReview } = fakeClient()
    aiReview.mockImplementationOnce(() => new Promise(() => {}))
    void family().ai.autoReview(client)
    await Promise.resolve()
    expect(aiReview).toHaveBeenCalledTimes(1)
    // Перезапуск: новый стор, тот же localStorage (family() его чистит — собираем «телефон» руками).
    const restart = () => {
      setActivePinia(createPinia())
      const auth = useAuthStore()
      auth.setAuthData(authAs('member', 'a'))
      auth.ai = true
      useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
      const ai = useAiStore()
      ai.sheetMounted = true
      ai.setConsent(true)
      return ai
    }
    vi.setSystemTime(new Date('2026-09-12T07:04:00Z'))
    expect(await restart().autoReview(client)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-09-13T08:00:00Z'))
    expect(await restart().autoReview(client)).not.toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(2)
  })

  it('разбор повода ушёл в надгробие обрезкой «живых ≤ 12» — повод всё равно был: 0', async () => {
    const { ai } = family({ doc: planFamilyDoc({ aiReviews: [review({ deletedAt: '2026-09-11T10:00:00.000Z' })] }) })
    const { client, aiReview } = fakeClient()
    expect(await ai.autoReview(client)).toBeNull()
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
