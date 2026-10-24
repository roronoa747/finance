import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, ApiError, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { leadFor, seedOwnMonth } from '../src/test/reviewV4'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { Goal, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, setOnline, type FakePrivate, type FakeServer, noStatements } from './support/family'

/**
 * Блок 3 «ИИ-польза» (AU-09…AU-14) — после v4 (бэклог «Фидбек», Р-26, Р-27): разбор приходит сам — на двух телефонах
 * против фейкового сервера документа и фейковой ручки `/api/ai/review` со счётчиком запросов (главный риск расхода —
 * фоновые запросы). Разбор свой у каждого (личный документ): телефон 1 в новом месяце → 1 запрос, повторный вход — 0;
 * телефон 2 моего разбора не видит и делает свой; оба разом — 2 запроса, после синка — больше ни одного; «Пришла» на
 * телефоне 2 → его разбор `salary`; лимит (429) — тишина; согласие v1 → лист один раз; viewer — без отчёта v4 и без
 * запроса; в теле — только повод, факты и карточки, без имён. Свой месяц у каждого участника — `seedOwnMonth`.
 * Отменено Р-23 (бэклог «Фидбек»): «Сделать» у совета нового разбора — кнопки у карточек кода (FB-17, FB-23).
 */
const K = '2026-10'

/** Семья с фондом-подушкой. */
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const familyDoc = (): SyncDoc => planFamilyDoc({ goals: [...planFamilyDoc().goals, fund] })

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

describe('e2e / ИИ-польза Блок 3 — разбор приходит сам (v4, свой у каждого)', () => {
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
    // Фоновый синк стора уходит в настоящий клиент — «нет сети»; телефоны синкаются явно своим клиентом.
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

  /** Телефон человека: документ семьи с сервера, вход и `/auth/me` с ИИ, свой личный документ и свой месяц (участник). */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', opts: { clear?: boolean } = {}) {
    if (opts.clear !== false) storage.clear()
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`)
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    if (role === 'member') await seedOwnMonth(K, slot)
    const ai = useAiStore()
    ai.sheetMounted = true
    // Клиент ИИ и личного документа; `client` телефона — синк общего документа.
    const aiClient = { ...priv, ...noStatements(), aiReview } as unknown as ApiClient
    return { ...p, ai, aiClient, priv }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sync = (p: Phone) => p.store.syncHousehold(p.client)
  const monthHtml = (p: Phone, mixin = {}) => screen(p.pinia, Month, '/month', undefined, [screenMixin(mixin)])

  it('телефон 1 в новом месяце → разбор сам (1 запрос), в личном документе; телефон 2 его не видит — свой запрос, точка «Месяц»', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('month')
    // Свой телефон: тот же вход ещё раз — без запроса.
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    await sync(one)
    expect(server.data.aiReviews ?? []).toHaveLength(0)
    expect(one.store.myAiReviews).toHaveLength(1)

    const two = await as('member', 'b')
    expect(two.store.aiReviewOf(K)).toBeNull()
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(2)
    expect(two.store.aiReviewOf(K)!.by).toBe('b')
    expect(two.ai.reviewUnseen).toBe(true)
    let html = await monthHtml(two)
    expect(html).toContain('data-plan-dot')
    expect(html).toContain('data-review-dot')
    html = await monthHtml(two, { reviewOpen: true })
    expect(visible(html)).toContain('Разберём траты без раздела.')
    two.ai.markReviewSeen(two.store.aiReviewOf(K)!.id)
    expect(await monthHtml(two)).not.toContain('data-plan-dot')
  })

  it('оба телефона входят разом (до синка) — 2 запроса (свой у каждого), после синка больше ни одного', async () => {
    const one = await as('member', 'a')
    const two = await as('member', 'b', { clear: false })
    // Телефоны в тесте делят одно хранилище; попытку повода телефон 1 пишет до запроса (возврат AU-33) — у телефона 2
    // своё хранилище, где её нет. Попытка пишется после своих операций и выписок (FB-HF1) и свежего личного документа
    // (критик 4б) — стираем после запроса.
    const first = one.ai.autoReview(one.aiClient)
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(1))
    storage.delete('ff_ai_auto')
    await Promise.all([first, two.ai.autoReview(two.aiClient)])
    expect(aiReview).toHaveBeenCalledTimes(2)
    await sync(one)
    await sync(two)
    await sync(one)
    // В общем документе разборов нет; у каждого — свой.
    expect(server.data.aiReviews ?? []).toHaveLength(0)
    expect(one.store.aiReviewOf(K)!.by).toBe('a')
    expect(two.store.aiReviewOf(K)!.by).toBe('b')
    await one.ai.autoReview(one.aiClient)
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(2)
  })

  it('«Пришла» на телефоне 2 → его разбор `salary`; отметка партнёра с того же телефона — без запроса', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    at('2026-10-20T06:00:00Z')
    const two = await as('member', 'b')
    // Свой первый разбор месяца — повод `month`; затем своя «Пришла» — `salary`.
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(2)
    at('2026-10-20T07:00:00Z')
    two.store.markSalary('b')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(3)
    expect((aiReview.mock.calls[2][0] as { reason: string }).reason).toBe('salary')
    expect(two.store.aiReviewOf(K)!.reasonKey).toBe(`salary:${K}`)
    two.store.markSalary('a')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(3)
  })

  it('лимит (429) — тишина: ни разбора, ни листа ошибки; в тот же день повод не повторяется', async () => {
    aiReview.mockRejectedValue(new ApiError('ai_limit', 429))
    const one = await as('member', 'a')
    expect(await one.ai.autoReview(one.aiClient)).toBeNull()
    expect(one.ai.reviewState).toBe('idle')
    expect(one.store.aiReviewOf(K)).toBeNull()
    const html = await monthHtml(one)
    expect(html).not.toContain('data-review-state')
    expect(html).not.toContain('ИИ вернётся')
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
  })

  it('без сети — ни запроса, ни листа', async () => {
    const one = await as('member', 'a')
    setOnline(false)
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('согласие v1 → лист согласия один раз; закрыл — до следующего повода не всплывает', async () => {
    pv.docs.set('u-a', { rev: 1, data: { aiConsent: { on: true, at: T0 } } })
    const one = await as('member', 'a')
    const run = one.ai.autoReview(one.aiClient)
    await vi.waitFor(() => expect(one.ai.sheetOpen).toBe(true))
    one.ai.answer(null)
    await run
    expect(aiReview).not.toHaveBeenCalled()
    at('2026-10-03T04:00:00Z')
    await one.ai.autoReview(one.aiClient)
    expect(one.ai.sheetOpen).toBe(false)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('viewer: сам не разбирает, отчёта v4 и чужого личного разбора не видит', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    const viewer = await as('viewer', 'b')
    await viewer.ai.autoReview(viewer.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const html = await monthHtml(viewer, { reviewOpen: true })
    expect(html).not.toContain('data-review-lead')
    expect(html).not.toContain('data-review-card=')
    expect(html).not.toContain('data-review-refresh')
  })

  it('тело запроса — только повод, факты и карточки (v4); имён участников нет', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    const body = aiReview.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['cards', 'facts', 'reason', 'v'])
    expect(body.v).toBe(4)
    const text = JSON.stringify(body)
    for (const name of ['Ильяс', 'Аруна', 'u-a', 'a@example.com']) expect(text, name).not.toContain(name)
    expect((body.facts as unknown[]).length).toBeGreaterThan(3)
  })
})
