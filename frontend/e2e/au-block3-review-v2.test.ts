import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, ApiError, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { Goal, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, setOnline, type FakePrivate, type FakeServer } from './support/family'

/**
 * Блок 3 «ИИ-польза» (AU-09…AU-14): разбор v2 приходит сам — на двух телефонах против фейкового сервера документа и
 * фейковой ручки `/api/ai/review` со счётчиком запросов (главный риск расхода — фоновые запросы). Телефон 1 входит в
 * новом месяце → разбор сам (1 запрос) → телефон 2 после синка видит его без запроса, точка на «Месяце»; оба входят
 * разом — не больше 2 запросов; «Пришла» на телефоне 2 → разбор `salary`; лимит (429) — тишина; согласие v1 → лист один
 * раз; «Сделать» → сдвиг месяца у обоих; viewer — без кнопок; в теле — только повод, факты и кандидаты, без имён.
 */
const ANSWER = { good: 'Копим на «Машину».', risk: 'Подушки мало.', step: { text: 'Отложим в подушку', candidate: 'c1' as string | null } }

/** Семья с фондом-подушкой: у неё есть кандидаты «Сделать» (досрочка, подушка). */
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const familyDoc = (): SyncDoc => planFamilyDoc({ goals: [...planFamilyDoc().goals, fund] })

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

describe('e2e / ИИ-польза Блок 3 — разбор v2 приходит сам', () => {
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
    for (const slot of ['a', 'b']) pv.docs.set(`u-${slot}`, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 2 } } })
    aiReview = vi.fn(async (_body: unknown) => ANSWER)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Телефон человека: документ семьи с сервера, вход и `/auth/me` с ИИ, свой личный документ, ручка ИИ — общий счётчик. */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', opts: { clear?: boolean } = {}) {
    if (opts.clear !== false) storage.clear()
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`)
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    const ai = useAiStore()
    ai.sheetMounted = true
    // Клиент ИИ и личного документа; `client` телефона — синк общего документа.
    const aiClient = { ...priv, aiReview } as unknown as ApiClient
    return { ...p, ai, aiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sync = (p: Phone) => p.store.syncHousehold(p.client)
  const monthHtml = (p: Phone, mixin = {}) => screen(p.pinia, Month, '/month', undefined, [screenMixin(mixin)])

  it('телефон 1 в новом месяце → разбор сам (1 запрос); телефон 2 после синка — тот же разбор без запроса, точка «Месяц»', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect((aiReview.mock.calls[0][0] as { reason: string }).reason).toBe('month')
    // Свой телефон: тот же вход ещё раз — без запроса.
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    await sync(one)
    expect(server.data.aiReviews?.filter((r) => !r.deletedAt)).toHaveLength(1)

    const two = await as('member', 'b')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(two.ai.reviewUnseen).toBe(true)
    let html = await monthHtml(two)
    expect(html).toContain('data-plan-dot')
    expect(html).toContain('data-review-dot')
    html = await monthHtml(two, { reviewOpen: true })
    expect(visible(html)).toContain(ANSWER.good)
    two.ai.markReviewSeen(two.store.aiReviewOf('2026-10')!.id)
    expect(await monthHtml(two)).not.toContain('data-plan-dot')
  })

  it('оба телефона входят разом (до синка) — не больше 2 запросов, оба разбора сходятся в документе', async () => {
    const one = await as('member', 'a')
    const two = await as('member', 'b', { clear: false })
    await Promise.all([one.ai.autoReview(one.aiClient), two.ai.autoReview(two.aiClient)])
    expect(aiReview.mock.calls.length).toBeLessThanOrEqual(2)
    await sync(one)
    await sync(two)
    expect((server.data.aiReviews ?? []).filter((r) => !r.deletedAt).length).toBeLessThanOrEqual(2)
    // После синка ни один телефон больше не спрашивает.
    await one.ai.autoReview(one.aiClient)
    await two.ai.autoReview(two.aiClient)
    expect(aiReview.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('«Пришла» на телефоне 2 → разбор `salary`; вторая отметка месяца — без запроса', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    at('2026-10-20T06:00:00Z')
    const two = await as('member', 'b')
    two.store.markSalary('b')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(2)
    expect((aiReview.mock.calls[1][0] as { reason: string }).reason).toBe('salary')
    expect(two.store.aiReviewOf('2026-10')!.reasonKey).toBe('salary:b:2026-10')
    two.store.markSalary('a')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(2)
  })

  it('лимит (429) — тишина: ни разбора, ни листа ошибки; в тот же день повод не повторяется', async () => {
    aiReview.mockRejectedValue(new ApiError('ai_limit', 429))
    const one = await as('member', 'a')
    expect(await one.ai.autoReview(one.aiClient)).toBeNull()
    expect(one.ai.reviewState).toBe('idle')
    expect(one.store.aiReviewOf('2026-10')).toBeNull()
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

  it('согласие v1 → лист согласия v2 один раз; закрыл — до следующего повода не всплывает', async () => {
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

  it('«Сделать» → сдвиг месяца у обоих телефонов; viewer видит разбор без кнопок', async () => {
    const one = await as('member', 'a')
    const r = await one.ai.autoReview(one.aiClient)
    const c = r!.step!.candidate!
    expect(c).not.toBeNull()
    // Лист разбора: «Сделать» у шага.
    // Атрибут целиком: `data-review-dot` и `data-review-done` — другие.
    const doBtn = /data-review-do(?=[\s=>])/
    expect(await monthHtml(one, { reviewOpen: true })).toMatch(doBtn)
    await sync(one)

    // Viewer — до «Сделать»: разбор с шагом, но без кнопки и без «Обновить»; сам не разбирает.
    const viewer = await as('viewer', 'b')
    const html = await monthHtml(viewer, { reviewOpen: true })
    expect(visible(html)).toContain(ANSWER.step.text)
    expect(html).not.toMatch(doBtn)
    expect(html).not.toContain('data-review-refresh')
    await viewer.ai.autoReview(viewer.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)

    // Подтверждение листа «Сделать» (`DoSheet.confirm` → `addPlanShift`) на телефоне 1.
    const again = await as('member', 'a')
    again.store.addPlanShift(c.shift)
    expect(await monthHtml(again, { reviewOpen: true })).toContain('data-review-done')
    await sync(again)

    const two = await as('member', 'b')
    expect((two.store.householdDoc.planShifts ?? []).filter((s) => !s.deletedAt)).toHaveLength(1)
    expect(await monthHtml(two, { reviewOpen: true })).toContain('data-review-done')
  })

  it('тело запроса — только повод, факты и кандидаты; имён участников нет', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    const body = aiReview.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['candidates', 'facts', 'reason'])
    const text = JSON.stringify(body)
    for (const name of ['Ильяс', 'Аруна', 'u-a', 'a@example.com']) expect(text, name).not.toContain(name)
    expect((body.facts as unknown[]).length).toBeGreaterThan(3)
  })
})
