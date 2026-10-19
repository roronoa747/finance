import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { MeResponse } from '../src/types/api'
import type { AiReview, Goal, PersonId, ReviewPayload, ReviewPayloadV3, SyncDoc } from '../src/types/finance'
import type { ReviewFind, SpendTotal } from '../src/lib/statements/types'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 2 «Разбор» — обновление поверх старых данных (урок хотфиксов RZ-HF1…HF3): у семьи на проде в документе
 * история разборов v1 (август), v2 (сентябрь, октябрь 1-го) и v3 октября, записанный сборкой Блока 1 (продавец в
 * словах — как печатает банк, с городом и страной: Х-2 тогда не было); телефон открыл его в листе старой сборки
 * (`ff_ai_review_seen`). Новая сборка на том же телефоне: (а) пилюля без точки, отчёт v3 — работа, куда ушло, советы
 * (длинное имя — как сохранено), «Итога прошлого месяца» нет (сентябрь — v2), запросов к ручке нет у обоих телефонов;
 * (б) v3 старой сборки за сентябрь → «Итог прошлого месяца»; (в) новее v3 — v2 или v1 (последний по `at`) — одна
 * карточка «Разбор», без запроса (замена старого — один раз на семью, RZ-HF1).
 */
const K = '2026-10'
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const total = (by: PersonId, period: string, categoryId: string, amount: number, ops = 3): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops, updatedAt: T0,
})
const find = (by: PersonId, period: string, kind: ReviewFind['kind'], key: string, rest: Partial<ReviewFind>): ReviewFind => ({
  id: `${by}:${period}:${kind}:${key}`, by, period, kind, name: '', categoryId: null, count: 1, amount: 0, updatedAt: T0, ...rest,
})
const v2 = (month: string, at: string): AiReview => ({
  id: `r-v2-${month}`, month, at, by: 'a', v: 2, reason: 'month', reasonKey: `month:${month}`,
  good: 'Продукты у обычного.', risk: 'Кафе обгоняет план.', steps: [],
  sent: { facts: [{ id: 'f1', about: 'остаток месяца', value: '50 000 ₸', raw: 50_000 }], candidates: [] },
  step: { text: 'Отложить остаток в подушку.', candidate: null }, updatedAt: T0,
})
const v1: AiReview = {
  id: 'r-v1-2026-08', month: '2026-08', at: '2026-08-01T04:00:00.000Z', by: 'a', good: 'Платежи вовремя.', risk: 'Подушка тонкая.',
  steps: [{ text: 'Отложить часть зарплаты.', screen: null }], sent: null, updatedAt: T0,
}
const familyDoc = (extra: Partial<SyncDoc> = {}): SyncDoc =>
  planFamilyDoc({
    goals: [...planFamilyDoc().goals, fund],
    spendTotals: [
      ...['2026-07', '2026-08', '2026-09'].flatMap((m) => [total('a', m, 'sc_cafe', 30_000), total('a', m, 'sc_food', 80_000, 10), total('b', m, 'sc_food', 40_000, 8)]),
      total('a', K, 'sc_cafe', 90_000), total('a', K, 'sc_food', 60_000, 8),
    ],
    reviewFinds: [
      find('a', '2026-08', 'leak', 'apteka plus', { name: 'APTEKA PLUS ALMATY KZ', categoryId: 'sc_health', count: 8, amount: 12_000 }),
      find('b', '2026-09', 'leak', 'apteka plus', { name: 'APTEKA PLUS ALMATY KZ', categoryId: 'sc_health', count: 7, amount: 10_000 }),
      find('a', K, 'top', 'sc_cafe', { categoryId: 'sc_cafe', count: 3, amount: 90_000, top: [{ name: 'Restoran', amount: 50_000 }] }),
    ],
    aiReviews: [v1, v2('2026-09', '2026-09-01T04:00:00.000Z'), v2(K, '2026-10-01T04:00:00.000Z')],
    ...extra,
  })
const upload = (slot: 'a' | 'b', from: string, to: string) => ({
  id: `up-${slot}-${from}`, slot, bank: 'kaspi', period_from: from, period_to: to, ops_count: 30, created_at: T0, user: `u-${slot}`,
})
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/\s+/g, ' ')
const cards = (html: string) => [...html.matchAll(/data-report-card="([^"]+)"/g)].map((m) => m[1])

/** Ответ модели для сборки Блока 1: «в подушку» (do), аптека (open продавца, крупная цифра — за год). */
function answerFor(body: ReviewPayloadV3) {
  const act = (re: RegExp) => body.actions.find((a) => re.test(a.about))!.id
  const fact = (re: RegExp) => body.facts.find((f) => re.test(f.about))!.id
  return {
    where: 'Кафе выросло из-за одного вечера.',
    advices: [
      { title: 'Отложим в подушку', text: 'Остаток месяца — в подушку.', figure: null, action: act(/в подушку/) },
      { title: 'Аптека у дома', text: 'Мелкие покупки складываются.', figure: fact(/^частые траты у .* — за год$/), action: act(/^открыть покупки у/) },
    ],
  }
}
/** Разбор v3 так, как его сохранила сборка Блока 1: имя продавца — как печатает банк (`shortMerchant` ещё не было). */
const oldBuild = (r: AiReview): AiReview => JSON.parse(JSON.stringify(r).replaceAll('APTEKA PLUS', 'APTEKA PLUS ALMATY KZ'))

describe('e2e / Разбор Блок 2 — приёмка: обновление поверх старых разборов', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
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
    at('2026-10-12T04:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
    st.uploads.push(upload('a', '2026-07-01', '2026-10-12'), upload('b', '2026-07-01', '2026-09-30'))
    pv = fakePrivate()
    for (const slot of ['a', 'b']) pv.docs.set(`u-${slot}`, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })
    aiReview = vi.fn(async (body: ReviewPayloadV3) => answerFor(body))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Телефон: свой стор поверх своего `localStorage` (`keep` — тот же телефон после обновления сборки). */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', keep = false) {
    if (!keep) storage.clear()
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const client = { ...backend(server), ...statementsFor(st, `u-${slot}`, slot) } as unknown as ApiClient
    const store = useFinanceStore()
    await store.pullHousehold(client)
    await useOperationsStore().loadUploads(client)
    const priv = privateFor(pv, `u-${slot}`)
    await store.pullPrivateDoc(priv as unknown as ApiClient)
    const ai = useAiStore()
    ai.sheetMounted = true
    return { pinia, store, client, ai, aiClient: { ...priv, aiReview } as unknown as ApiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sync = (p: Phone) => {
    setActivePinia(p.pinia)
    return p.store.syncHousehold(p.client)
  }

  /**
   * Прод до обновления: старый v2 октября → разбор сам v3 один раз (RZ-HF1), в документе — v3 «старой сборки»; телефон a
   * открыл его (`markReviewSeen`). Возвращает тот же телефон a уже новой сборкой (свежий стор, `localStorage` прежний).
   * У v2 в «что ушло» — факт «главная мечта … — срок», как у настоящих v2: итог прошлого месяца берёт срок оттуда, но
   * только у v3.
   */
  async function updated(extra?: (d: SyncDoc, old: AiReview) => void) {
    const prod = await as('member', 'a')
    const fresh = (await prod.ai.autoReview(prod.aiClient))!
    expect(fresh).toMatchObject({ v: 3, month: K })
    const dream = (fresh.sent as ReviewPayloadV3).facts.find((f) => f.about.startsWith('главная мечта'))
    expect(dream).toBeTruthy()
    const old = oldBuild(fresh)
    prod.store.mutateHouseholdDoc((d) => {
      d.aiReviews = (d.aiReviews ?? []).map((r) =>
        r.id === fresh.id ? old : r.v === 2 ? { ...r, sent: { facts: [...(r.sent as ReviewPayload).facts, dream!], candidates: [] } } : r,
      )
      extra?.(d, old)
    })
    prod.ai.markReviewSeen(old.id)
    await sync(prod)
    aiReview.mockClear()
    return { phone: await as('member', 'a', true), old }
  }

  it('(а) тот же телефон новой сборкой: пилюля без точки, отчёт v3 старой сборки, итога нет (сентябрь — v2), запросов нет', async () => {
    const { phone, old } = await updated()
    expect(await phone.ai.autoReview(phone.aiClient)).toBeNull()
    const month = await screen(phone.pinia, Month, '/month')
    expect(month).toContain('data-review-open')
    expect(month).not.toContain('data-review-dot')
    const html = await screen(phone.pinia, Month, '/month?review=1')
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice'])
    const shown = visible(html)
    // RZ-14: крупно «≈ X ₸», «в год уходит на найденное», строка «K находок из N операций».
    expect(shown).toMatch(/≈ [\d ]+ ₸ в год уходит на найденное \d+ наход\S* из [\d ]+ операц/)
    expect(shown).toContain('Кафе выросло из-за одного вечера.')
    // Имя продавца — как сохранила старая сборка (до следующего разбора), кнопка — туда же, что и раньше.
    expect(shown).toContain('APTEKA PLUS ALMATY KZ')
    expect(html).toContain('href="/money/history?cat=sc_health"')
    expect(html).toMatch(/data-review-do(?=[\s=>])/)
    expect(old.v).toBe(3)
    // Партнёр — тот же отчёт без запроса; у него разбор новый — точка есть.
    const two = await as('member', 'b')
    expect(await two.ai.autoReview(two.aiClient)).toBeNull()
    expect(await screen(two.pinia, Month, '/month')).toContain('data-review-dot')
    expect(cards(await screen(two.pinia, Month, '/month?review=1'))).toEqual(['work', 'where', 'advice', 'advice'])
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('(б) v3 старой сборки за сентябрь → «Итог прошлого месяца» новой сборкой', async () => {
    const { phone } = await updated((d, old) => {
      d.aiReviews = [...(d.aiReviews ?? []), { ...old, id: 'r-v3-sep', month: '2026-09', at: '2026-09-02T04:00:00.000Z', reasonKey: 'month:2026-09' }]
    })
    const html = await screen(phone.pinia, Month, '/month?review=1')
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice', 'outcome'])
    const outcome = visible(html.slice(html.indexOf('data-report-card="outcome"')))
    expect(outcome).toContain('Итог прошлого месяца')
    expect(outcome).toMatch(/Отложим в подушку ?не сделано/)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it.each([
    ['v2', () => v2(K, '2026-10-12T04:00:30.000Z'), 'Кафе обгоняет план.'],
    ['v1', () => ({ ...v1, id: 'r-v1-oct', month: K, at: '2026-10-12T04:00:30.000Z' }), 'Отложить часть зарплаты.'],
  ])('(в) новее v3 — %s: одна карточка «Разбор», без запроса', async (_v, late, text) => {
    const { phone } = await updated((d) => {
      d.aiReviews = [...(d.aiReviews ?? []), { ...late(), id: 'r-late' }]
    })
    expect(await phone.ai.autoReview(phone.aiClient)).toBeNull()
    // Разбор месяца другой (последний по `at`) — точка «новый» есть; открыли — гаснет.
    expect(await screen(phone.pinia, Month, '/month')).toContain('data-review-dot')
    const html = await screen(phone.pinia, Month, '/month?review=1')
    expect(cards(html)).toEqual(['old'])
    expect(visible(html)).toContain(text)
    expect(await screen(phone.pinia, Month, '/month')).not.toContain('data-review-dot')
    expect(aiReview).not.toHaveBeenCalled()
  })
})
