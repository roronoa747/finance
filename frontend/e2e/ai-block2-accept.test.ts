import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, ApiError, type ApiClient } from '../src/api/client'
import { startDemo } from '../src/lib/demo'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { leadFor, seedOwnMonth } from '../src/test/reviewV4'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { AiReview, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Приёмка Блока 2 «ИИ» (2026-10-16): сценарии стенда приёмки, которых не было в наборе. (д) партнёр с ИИ и своим
 * согласием открывает сохранённый разбор — без запроса (в `ai-block2-review` (а) партнёр без согласия — запроса не
 * было бы и при ошибке); (е) флаг сняли, пока экран открыт: `ai_off` → `/auth/me` → ✦ нет, в документе ничего;
 * (ж) флаг снят — ✦ нет и при сохранённом разборе (участник и viewer); (з) «Обновить» через сутки — новый разбор,
 * в документе оба, показан последний, партнёр видит новый; (и) демо — нажатие ✦ без запроса и записи; (к) имена в
 * падежах в названиях статей, долгов и целей не уходят, а `sent` в общем документе = ушедшая сводка.
 */
/** Ответ ручки — v3 (бэклог «Разбор», RZ-05): совет на первое действие семьи (`a1` — досрочно). */
const answer = (where: string) => ({ where, advices: [{ title: 'Долги', text: 'Кредитка под 40% — самый дорогой долг.', figure: null, action: 'a1' }] })
/** Разбор v1, сохранённый в документе до v2 (читается как раньше). */
const saved = (good: string, atIso: string): AiReview => ({
  id: 'r0', month: '2026-10', at: atIso, by: 'a', good, risk: 'Кредитка под 40% — самый дорогой долг.',
  steps: [{ text: 'Посмотрим долги.', screen: '/money/debts' }, { text: 'Обсудим план трат вдвоём.', screen: null }], sent: null, updatedAt: atIso,
})

/** Имена участников в падежах — в названиях статьи, кредита и цели (заметки — тоже с именами). */
function namedDoc(): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    obligations: [
      ...doc.obligations,
      { id: 'club', name: 'Кружок Аруны', note: 'водит Ильяс', day: 12, category: 'd1', versions: [{ from: '2026-01', amount: 35_000 }], updatedAt: T0 },
    ],
    credits: doc.credits.map((c) => (c.id === 'loan' ? { ...c, name: 'Кредит Ильяса', note: 'платит Аруна' } : c)),
    goals: doc.goals.map((g) => (g.id === 'car' ? { ...g, name: 'Машина для Аруны' } : g)),
  })
}

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const sheet = (html: string) => {
  const i = html.search(/data-review-(example|good|where|state|lead|card)/)
  if (i < 0) return ''
  const d = html.lastIndexOf('role="dialog"', i)
  return visible(html.slice(d < 0 ? i : d))
}
const K = '2026-10'
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v

describe('e2e / ИИ Блок 2 — приёмка', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let pv: FakePrivate

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
    at('2026-10-12T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Телефон человека: документ семьи с сервера, вход и `/auth/me` (флаг ИИ), свой личный документ. */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', ai = true) {
    storage.clear()
    const p = await phone(server)
    setActivePinia(p.pinia)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai })
    await auth.fetchMe()
    await useFinanceStore().pullPrivateDoc(privateFor(pv, `u-${slot}`) as unknown as ApiClient)
    return p
  }
  type Phone = Awaited<ReturnType<typeof as>>

  /** Нажатие ✦ у остатка (`MonthPlan.openReview`) или «Обновить» (`refreshReview`) и ожидание исхода. */
  async function tap(p: Phone, action: 'openReview' | 'refreshReview' = 'openReview') {
    await screen(p.pinia, Month, '/month', undefined, [screenMixin({}, (s) => void (s[action] as () => Promise<void>)())])
    setActivePinia(p.pinia)
    await vi.waitFor(() => expect(useAiStore().reviewState).not.toBe('thinking'))
  }
  const opened = (p: Phone) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])
  const consent = (slot: 'a' | 'b') => pv.docs.set(`u-${slot}`, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })

  it('(д) партнёр с ИИ и своим согласием: ✦ у сохранённого разбора открывает его без запроса', async () => {
    server.data.aiReviews = [saved('Платежи и траты покрыты.', '2026-10-12T06:00:00.000Z')]
    consent('b')
    const review = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer('другой'))
    const two = await as('member', 'b')
    expect(useAiStore().available).toBe(true)
    expect(useAiStore().consent).toBe('on')
    await tap(two)
    expect(review).not.toHaveBeenCalled()
    expect(sheet(await opened(two))).toContain('Платежи и траты покрыты.')
  })

  it('(е) флаг сняли, пока экран открыт: 503 ai_off → /auth/me → ✦ нет, в документе ничего', async () => {
    consent('a')
    vi.spyOn(apiClient, 'aiReview').mockRejectedValue(new ApiError('ai_off', 503, { error: 'ai_off' }))
    const one = await as('member', 'a')
    await seedOwnMonth(K, 'a')
    expect(await screen(one.pinia, Month, '/month')).toContain('data-review-sparkle')
    const me = vi.spyOn(apiClient, 'me').mockResolvedValue({ ...(authAs('member', 'a') as unknown as MeResponse), ai: false })
    await tap(one)
    await vi.waitFor(() => expect(me).toHaveBeenCalled())
    setActivePinia(one.pinia)
    await vi.waitFor(() => expect(useAuthStore().ai).toBe(false))
    expect(useAiStore().reviewState).toBe('failed')
    expect(one.store.householdDoc.aiReviews ?? []).toHaveLength(0)
    expect(one.store.myAiReviews).toHaveLength(0)
    // Без ИИ — «Разбор» без ✦ (карточки кода, бэклог «Фидбек», Р-27).
    const html = await screen(one.pinia, Month, '/month')
    expect(html).toContain('data-review-open')
    expect(html).not.toContain('data-review-sparkle')
  })

  it('(ж) флаг снят в админке: ✦ нет и при сохранённом разборе — у участника «Разбор» без ✦ (Р-27), у viewer пилюли нет', async () => {
    server.data.aiReviews = [saved('Платежи и траты покрыты.', '2026-10-12T06:00:00.000Z')]
    consent('a')
    const review = vi.spyOn(apiClient, 'aiReview')
    for (const [role, slot] of [['member', 'a'], ['viewer', 'b']] as const) {
      const p = await as(role, slot, false)
      const html = await screen(p.pinia, Month, '/month')
      expect(html, role).toContain('data-afford-open')
      expect(html, role).not.toContain('data-review-sparkle')
      if (role === 'member') expect(html, role).toContain('data-review-open')
      else expect(html, role).not.toContain('data-review-open')
    }
    expect(review).not.toHaveBeenCalled()
  })

  // v4 (бэклог «Фидбек», Р-27): новый разбор — свой в личном документе; «партнёр видит новый» отменено — видит старый общий.
  it('(з) «Обновить» через сутки поверх старого общего: новый разбор — в личном, показан он; общий старый остаётся, партнёр видит старый', async () => {
    server.data.aiReviews = [saved('Старый разбор.', '2026-10-11T06:00:00.000Z')]
    consent('a')
    const review = vi.spyOn(apiClient, 'aiReview').mockImplementation(async (body: unknown) => ({ ...leadFor(body), text: 'Новый разбор.' }) as never)
    const one = await as('member', 'a')
    await seedOwnMonth(K, 'a')
    expect(await opened(one)).toContain('data-review-refresh')
    await tap(one, 'refreshReview')
    expect(review).toHaveBeenCalledTimes(1)
    setActivePinia(one.pinia)
    expect((one.store.householdDoc.aiReviews ?? []).filter((r) => !r.deletedAt)).toHaveLength(1)
    expect(one.store.myAiReviews).toHaveLength(1)
    expect(one.store.aiReviewOf(K)?.lead?.text).toBe('Новый разбор.')
    const html = await opened(one)
    expect(sheet(html)).toContain('Новый разбор.')
    expect(html).not.toContain('data-review-refresh')
    await one.store.syncHousehold(one.client)

    review.mockClear()
    const two = await as('member', 'b')
    const partner = sheet(await opened(two))
    expect(partner).toContain('Старый разбор.')
    expect(partner).not.toContain('Новый разбор.')
    expect(review).not.toHaveBeenCalled()
  })

  it('(и) демо: ✦ видна, нажатие открывает «Пример» — без запроса и без записи в документ', async () => {
    const review = vi.spyOn(apiClient, 'aiReview')
    const pinia = createPinia()
    setActivePinia(pinia)
    expect(startDemo()).toBe(true)
    await nextTick()
    await nextTick()
    expect(await screen(pinia, Month, '/month')).toContain('data-review-open')
    const before = JSON.stringify(useFinanceStore().householdDoc)
    await screen(pinia, Month, '/month', undefined, [screenMixin({}, (s) => void (s.openReview as () => Promise<void>)())])
    setActivePinia(pinia)
    expect(review).not.toHaveBeenCalled()
    expect(useAiStore().reviewState).toBe('idle')
    expect(JSON.stringify(useFinanceStore().householdDoc)).toBe(before)
    const demoSheet = sheet(await screen(pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })]))
    expect(demoSheet).toContain('Пример')
    // У «Примера» дня разбора нет (Х-18 Блока 3 «ИИ-польза»).
    expect(demoSheet).not.toContain('data-review-day')
  })

  it('(к) имена в падежах в названиях статьи, кредита и цели не уходят; `sent` в личном документе = ушедшие факты и карточки', async () => {
    server = fakeServer(namedDoc())
    consent('a')
    const review = vi.spyOn(apiClient, 'aiReview').mockImplementation(async (body: unknown) => leadFor(body) as never)
    const one = await as('member', 'a')
    await seedOwnMonth(K, 'a')
    await tap(one)
    expect(review).toHaveBeenCalledTimes(1)
    const body = review.mock.calls[0][0]
    const text = JSON.stringify(body)
    for (const bad of ['Ильяс', 'Арун', 'водит', 'платит']) expect(text, bad).not.toContain(bad)
    // Факты (AU-11, RZ-03) называют главную мечту и первый долг — имена в них заменены.
    expect(text).toContain('участник')

    setActivePinia(one.pinia)
    await one.store.syncHousehold(one.client)
    await one.store.syncPrivate(privateFor(pv, 'u-a') as unknown as ApiClient)
    expect(server.data.aiReviews ?? []).toHaveLength(0)
    const stored = (pv.docs.get('u-a')!.data.aiReviews as AiReview[]).find((r) => !r.deletedAt)
    const { reason: _reason, ...payload } = body as unknown as Record<string, unknown>
    expect(canon(stored?.sent)).toEqual(canon(payload))
    expect(JSON.stringify(pv.docs.get('u-a')!.data.aiReviews)).not.toMatch(/Ильяс|Арун/)
  })
})
