import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { leadFor, seedOwnMonth } from '../src/test/reviewV4'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { Goal, ReviewPayloadV4, SyncDoc } from '../src/types/finance'
import type { ReviewFind } from '../src/lib/statements/types'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Блок 1 «Разбор» (RZ-05) — после v4 (бэклог «Фидбек», Р-23, Р-26, Р-27): разбор месяца на двух телефонах против
 * фейкового сервера документа и фейковой ручки `/api/ai/review` со счётчиком запросов. Свой месяц телефона 1 —
 * `seedOwnMonth` (карточка «Не разобрано»); утечка у аптеки — итоги находок двух участников в общем документе.
 * (а) первый вход в месяце → 1 запрос v4 без имён и дат → разбор в личном документе; (б) телефон 2 моего разбора не
 * видит, своих операций у него нет — запроса нет; (д) viewer — отчёта v4 и запроса нет; (е) `next` не из присланных
 * карточек — разбор не сохраняется, запрос один.
 * Отменено Р-23 (бэклог «Фидбек»): «Сделать» / «Открыть» советов v3 нового разбора — кнопки у карточек кода (FB-17, FB-23).
 */
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const leak = (by: 'a' | 'b', period: string, count: number, amount: number): ReviewFind => ({
  id: `${by}:${period}:leak:apteka plus`, by, period, kind: 'leak', name: 'APTEKA PLUS', categoryId: 'sc_health', count, amount, updatedAt: T0,
})
const familyDoc = (): SyncDoc =>
  planFamilyDoc({ goals: [...planFamilyDoc().goals, fund], reviewFinds: [leak('a', '2026-08', 8, 12_000), leak('b', '2026-09', 7, 10_000)] })

const K = '2026-10'

describe('e2e / Разбор Блок 1 — разбор месяца (v4, свой у каждого)', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let pv: FakePrivate
  let aiReview: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    vi.useFakeTimers({ toFake: ['Date'] })
    // 1 октября, 09:00 по Алматы — первый вход в месяце.
    at('2026-10-01T04:00:00Z')
    server = fakeServer(familyDoc())
    pv = fakePrivate()
    for (const slot of ['a', 'b']) pv.docs.set(`u-${slot}`, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })
    aiReview = vi.fn(async (body: unknown) => leadFor(body))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', own = false) {
    storage.clear()
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`)
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    if (own) await seedOwnMonth(K, slot)
    const ai = useAiStore()
    ai.sheetMounted = true
    const aiClient = { ...priv, aiReview } as unknown as ApiClient
    return { ...p, ai, aiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sync = (p: Phone) => p.store.syncHousehold(p.client)
  const sheetHtml = (p: Phone) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])

  it('(а)(б) первый вход → 1 запрос v4 без имён и дат → разбор в личном документе; телефон 2 его не видит и без своих операций не спрашивает', async () => {
    const one = await as('member', 'a', true)
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const body = aiReview.mock.calls[0][0] as Record<string, unknown> & ReviewPayloadV4
    expect(Object.keys(body).sort()).toEqual(['cards', 'facts', 'reason', 'v'])
    expect(body).toMatchObject({ v: 4, reason: 'month' })
    for (const c of body.cards) expect(Object.keys(c).sort()).toEqual(['about', 'id', 'kind'])
    const text = JSON.stringify(body)
    for (const name of ['Ильяс', 'Аруна', 'u-a', 'a@example.com', '2026-10-0', 'SHOP X']) expect(text, name).not.toContain(name)
    expect(text).not.toMatch(/за год|в год/)

    const r = one.store.aiReviewOf(K)!
    expect(r).toMatchObject({ v: 4, reason: 'month', reasonKey: `month:${K}`, next: 'unknown', lead: { title: 'Главное' } })
    expect(one.store.myAiReviews.map((x) => x.id)).toEqual([r.id])
    expect(one.store.householdDoc.aiReviews ?? []).toHaveLength(0)
    const html = await sheetHtml(one)
    expect(html).toContain('data-review-lead')
    expect(html).toContain('data-review-card="unknown"')
    await sync(one)

    const two = await as('member', 'b')
    expect(two.store.aiReviewOf(K)).toBeNull()
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(await sheetHtml(two)).not.toContain('data-review-lead')
  })

  it('(д) viewer: отчёта v4 и запроса нет; чужого личного разбора не видит', async () => {
    const one = await as('member', 'a', true)
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    const viewer = await as('viewer', 'b')
    await viewer.ai.autoReview(viewer.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(viewer.store.aiReviewOf(K)).toBeNull()
    const html = await sheetHtml(viewer)
    expect(html).not.toContain('data-review-card=')
    expect(html).not.toContain('data-review-lead')
  })

  it('(е) `next` не из присланных карточек — разбор не сохраняется (ai_failed), запрос один', async () => {
    aiReview = vi.fn(async () => ({ title: 'Совет', text: 'Текст.', figure: null, next: 'c9' }))
    const one = await as('member', 'a', true)
    expect(await one.ai.autoReview(one.aiClient)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(one.store.myAiReviews).toHaveLength(0)
  })
})
