import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { Goal, ReviewPayloadV3, SyncDoc } from '../src/types/finance'
import type { ReviewFind } from '../src/lib/statements/types'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Блок 1 «Разбор» (RZ-05): разбор v3 на двух телефонах против фейкового сервера документа и фейковой ручки
 * `/api/ai/review` со счётчиком запросов. Семья с подушкой-фондом (кандидат «в подушку») и утечкой у аптеки в августе
 * и сентябре (итоги находок двух участников). (а) первый вход в месяце → 1 запрос v3 без имён → разбор v3 с советами и
 * счётчиком; (б) телефон 2 после синка видит тот же разбор без запроса — «Куда ушло», два совета, «Сделать» и
 * «Открыть»; (в) «Сделать» → сдвиг месяца у обоих, «✓ Сделано»; (г) «Открыть» — ссылка на экран предмета; (д) viewer —
 * «Открыть» есть, «Сделать» нет; (е) совет на неприсланное действие — разбор не сохраняется, запрос один.
 */
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const leak = (by: 'a' | 'b', period: string, count: number, amount: number): ReviewFind => ({
  id: `${by}:${period}:leak:apteka plus`, by, period, kind: 'leak', name: 'APTEKA PLUS', categoryId: 'sc_health', count, amount, updatedAt: T0,
})
const familyDoc = (): SyncDoc =>
  planFamilyDoc({ goals: [...planFamilyDoc().goals, fund], reviewFinds: [leak('a', '2026-08', 8, 12_000), leak('b', '2026-09', 7, 10_000)] })

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

/** Ответ модели на присланное тело: совет «в подушку» (do) и «Открыть покупки у аптеки» (open). */
function answerFor(body: ReviewPayloadV3) {
  const cushion = body.actions.find((a) => a.kind === 'do' && a.about === 'из остатка месяца в подушку')!
  const apteka = body.actions.find((a) => a.kind === 'open' && a.about === 'открыть покупки у «APTEKA PLUS»')!
  const yearly = body.facts.find((f) => f.about === 'частые траты у «APTEKA PLUS» — за год')!
  return {
    where: 'Аптека у дома тянет больше, чем кажется.',
    advices: [
      { title: 'Отложим в подушку', text: 'Подушки почти нет — остаток месяца в неё.', figure: null, action: cushion.id },
      { title: 'Аптека у дома', text: `За год у «APTEKA PLUS» уходит ${yearly.value}.`, figure: yearly.id, action: apteka.id },
    ],
  }
}

describe('e2e / Разбор Блок 1 — разбор v3', () => {
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
    aiReview = vi.fn(async (body: ReviewPayloadV3) => answerFor(body))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    storage.clear()
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`)
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    const ai = useAiStore()
    ai.sheetMounted = true
    const aiClient = { ...priv, aiReview } as unknown as ApiClient
    return { ...p, ai, aiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sync = (p: Phone) => p.store.syncHousehold(p.client)
  const sheetHtml = (p: Phone) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])
  // Атрибут целиком: `data-review-dot` и `data-review-done` — другие.
  const doBtn = /data-review-do(?=[\s=>])/

  it('(а)(б) первый вход → 1 запрос v3 без имён и без raw у действий → разбор v3 в документе; телефон 2 — тот же разбор без запроса', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const body = aiReview.mock.calls[0][0] as Record<string, unknown> & ReviewPayloadV3
    expect(Object.keys(body).sort()).toEqual(['actions', 'facts', 'reason', 'v'])
    expect(body).toMatchObject({ v: 3, reason: 'month' })
    for (const a of body.actions) expect(Object.keys(a).sort()).toEqual(['about', 'effect', 'id', 'kind', 'value'])
    const text = JSON.stringify(body)
    for (const name of ['Ильяс', 'Аруна', 'u-a', 'a@example.com', '2026-09-']) expect(text, name).not.toContain(name)

    const r = one.store.aiReviewOf('2026-10')!
    expect(r).toMatchObject({ v: 3, reason: 'month', reasonKey: 'month:2026-10', where: 'Аптека у дома тянет больше, чем кажется.' })
    expect(r.advices!.map((a) => a.action.kind)).toEqual(['do', 'open'])
    // Подпись крупной цифры — коротко, кодом (RZ-15); в тело ручки не уходит.
    expect(JSON.stringify(aiReview.mock.calls[0][0])).not.toContain('label')
    expect(r.advices![1]).toMatchObject({ figure: { about: 'частые траты у «APTEKA PLUS» — за год', label: 'за год · APTEKA PLUS' }, action: { kind: 'open', target: { kind: 'seller', id: 'apteka plus', categoryId: 'sc_health' } } })
    // Счётчик: находок — сколько нашёл код; ₸ в год — утечка совета (11 000 в месяц × 12).
    expect(r.work).toMatchObject({ found: 1, yearly: 132_000 })
    await sync(one)

    const two = await as('member', 'b')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const html = await sheetHtml(two)
    expect(visible(html)).toContain('Куда ушло')
    expect(visible(html)).toContain('Аптека у дома тянет больше')
    expect(html.match(/data-review-advice(?=[\s=>])/g)).toHaveLength(2)
    expect(html).toMatch(doBtn)
    expect(html).toContain('data-review-link')
    // RZ-14: деньги находок в год — крупно, операции — строкой.
    expect(visible(html)).toContain('в год уходит на найденное')
    expect(visible(html)).toMatch(/1 находка из [\d ]+ операц/)
  })

  it('(в)(г) «Сделать» → сдвиг месяца у обоих, «✓ Сделано»; «Открыть» ведёт на историю с разделом продавца', async () => {
    const one = await as('member', 'a')
    const r = await one.ai.autoReview(one.aiClient)
    const a = r!.advices![0]!.action
    if (a.kind !== 'do') throw new Error('первый совет — «Сделать»')
    const html = await sheetHtml(one)
    expect(html).toMatch(doBtn)
    expect(html).toContain('href="/money/history?cat=sc_health"')
    one.store.addPlanShift(a.candidate.shift)
    expect(await sheetHtml(one)).toContain('data-review-done')
    await sync(one)

    const two = await as('member', 'b')
    expect((two.store.householdDoc.planShifts ?? []).filter((s) => !s.deletedAt)).toHaveLength(1)
    expect(await sheetHtml(two)).toContain('data-review-done')
  })

  it('(д) viewer: «Открыть» есть, «Сделать» нет; сам не разбирает', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    const viewer = await as('viewer', 'b')
    await viewer.ai.autoReview(viewer.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const html = await sheetHtml(viewer)
    expect(html).toContain('data-review-link')
    expect(html).not.toMatch(doBtn)
    expect(html).not.toContain('data-review-refresh')
  })

  it('(е) совет на неприсланное действие — разбор не сохраняется (ai_failed), запрос один', async () => {
    aiReview = vi.fn(async () => ({ where: 'Хорошо.', advices: [{ title: 'Совет', text: 'Текст.', figure: null, action: 'a9' }] }))
    const one = await as('member', 'a')
    expect(await one.ai.autoReview(one.aiClient)).toBeNull()
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(one.store.householdDoc.aiReviews ?? []).toHaveLength(0)
  })
})
