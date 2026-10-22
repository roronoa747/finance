import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { startDemo } from '../src/lib/demo'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { MeResponse } from '../src/types/api'
import type { AiReview, Goal, PersonId, ReviewPayloadV3, SyncDoc } from '../src/types/finance'
import type { ReviewFind, SpendTotal } from '../src/lib/statements/types'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 2 «Разбор» (RZ-09): отчёт разбора v3 на двух телефонах против фейкового сервера документа, выписок и фейковой
 * ручки `/api/ai/review` со счётчиком. Семья 12 октября: выписка a до сегодня (месяц находок — октябрь), кафе в октябре
 * 90 000 при обычных 30 000 и покупка 50 000 («раздуло»), утечка у аптеки в августе и сентябре, подушка-фонд
 * (кандидат «в подушку»). (а) разбор сам → `?review=1` → карточки по порядку, счётчик, «Куда ушло» полосами, советы с
 * кнопкой; (б) «Сделать» → «✓ Сделано», сдвиг у обоих; (в) «Открыть» раздела → `/month?cat=` — лист раздела, отчёта
 * нет; (г) телефон 2 — отчёт без запроса, точка гаснет после открытия; (д) viewer — без «Сделать», «Открыть» есть;
 * (е) v3 прошлого месяца → «Итог прошлого месяца» со «Сделано»; (ж) демо — «Пример», карточки, «Сделать» →
 * «✓ Сделано», запросов 0; (з) `card=2` — старт со второго совета.
 */
const K = '2026-10'
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const total = (by: PersonId, period: string, categoryId: string, amount: number, ops = 3): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops, updatedAt: T0,
})
const find = (by: PersonId, period: string, kind: ReviewFind['kind'], key: string, rest: Partial<ReviewFind>): ReviewFind => ({
  id: `${by}:${period}:${kind}:${key}`, by, period, kind, name: '', categoryId: null, count: 1, amount: 0, updatedAt: T0, ...rest,
})
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
    ...extra,
  })
const upload = (slot: 'a' | 'b', from: string, to: string) => ({
  id: `up-${slot}-${from}`, slot, bank: 'kaspi', period_from: from, period_to: to, ops_count: 30, created_at: T0, user: `u-${slot}`,
})

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/\s+/g, ' ')
const cards = (html: string) => [...html.matchAll(/data-report-card="([^"]+)"/g)].map((m) => m[1])
// Атрибут целиком: `data-review-dot` и `data-review-done` — другие.
const doBtn = /data-review-do(?=[\s=>])/

/** Ответ модели: «в подушку» (do), «Кафе» (open раздела, крупная цифра — прирост), аптека (open продавца). */
function answerFor(body: ReviewPayloadV3) {
  const id = (about: string) => body.actions.find((a) => a.about === about)!.id
  const fact = (about: string) => body.facts.find((f) => f.about === about)!.id
  return {
    where: 'Кафе выросло из-за одного вечера.',
    advices: [
      { title: 'Отложим в подушку', text: 'Подушки почти нет — остаток месяца в неё.', figure: null, action: id('из остатка месяца в подушку') },
      { title: 'Кафе', text: 'Один вечер раздул раздел.', figure: fact('траты на «Кафе и рестораны» выше обычного на'), action: id('открыть траты «Кафе и рестораны»') },
      { title: 'Аптека у дома', text: 'Мелкие покупки складываются.', figure: fact('частые траты у «APTEKA PLUS» — в месяц'), action: id('открыть покупки у «APTEKA PLUS»') },
    ],
  }
}

describe('e2e / Разбор Блок 2 — отчёт', () => {
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

  /** Телефон: свой стор, документ и записи выписок скачаны; флаг ИИ — с сервера; лист согласия смонтирован. */
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
    return { pinia, store, client, ai, aiClient: { ...client, ...priv, aiReview } as unknown as ApiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sync = (p: Phone) => {
    setActivePinia(p.pinia)
    return p.store.syncHousehold(p.client)
  }
  const report = (p: Phone, query = '?review=1') => screen(p.pinia, Month, `/month${query}`)

  it('(а) разбор сам → отчёт по адресу: работа ИИ, куда ушло полосами, три совета — у каждого одна кнопка', async () => {
    const one = await as('member', 'a')
    const r = await one.ai.autoReview(one.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ v: 3, month: K })
    // Х-2: продавец в словах модели — коротко, без города и страны.
    expect(JSON.stringify(aiReview.mock.calls[0][0])).not.toContain('ALMATY')
    const html = await report(one)
    expect(html).toContain('data-report')
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice', 'advice'])
    const shown = visible(html)
    expect(shown).toContain('Работа ИИ')
    // RZ-14: крупно «≈ X ₸», «в месяц уходит на найденное» («Фидбек», Р-19), строка «K находок из N операций».
    expect(shown).toMatch(/≈ [\d ]+ ₸ в месяц уходит на найденное \d+ наход\S* из [\d ]+ операц/)
    expect(shown).not.toMatch(/за год|в год/)
    expect(shown).toContain('Куда ушло в октябре')
    // Полосы — разделы октября; кафе выше обычного — отмечено.
    expect([...html.matchAll(/data-where-row="([^"]+)"/g)].map((m) => m[1])).toEqual(['sc_cafe', 'sc_food'])
    expect(html).toMatch(/data-where-row="sc_cafe"[^>]*data-over/)
    expect(shown).toContain('Кафе выросло из-за одного вечера.')
    // У каждого совета одна кнопка: «Сделать» у подушки, «Открыть» у кафе и аптеки.
    const advices = html.split(/data-review-advice(?=[\s=>])/).slice(1).map((s) => s.slice(0, s.indexOf('</article>')))
    expect(advices).toHaveLength(3)
    expect(advices[0]).toMatch(doBtn)
    expect(advices[1]).toContain('href="/month?cat=sc_cafe"')
    expect(advices[2]).toContain('href="/money/history?cat=sc_health"')
    for (const a of advices) expect((a.match(/<(a|button)\b/g) ?? []).length).toBe(1)
    // Крупная цифра кафе — прирост к обычному (90 000 − 30 000).
    expect(visible(advices[1])).toContain('60 000 ₸')
  })

  it('(б) «Сделать» → «✓ Сделано», сдвиг месяца у обоих телефонов', async () => {
    const one = await as('member', 'a')
    const r = await one.ai.autoReview(one.aiClient)
    const a = r!.advices![0].action
    if (a.kind !== 'do') throw new Error('первый совет — «Сделать»')
    one.store.addPlanShift(a.candidate.shift)
    const html = await report(one)
    expect(html).toContain('data-review-done')
    expect(html).not.toMatch(doBtn)
    await sync(one)
    const two = await as('member', 'b')
    expect((two.store.householdDoc.planShifts ?? []).filter((s) => !s.deletedAt)).toHaveLength(1)
    expect(await report(two)).toContain('data-review-done')
  })

  it('(в) «Открыть» раздела → `/month?cat=sc_cafe`: лист раздела открыт, отчёта нет', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    const html = await screen(one.pinia, Month, '/month?cat=sc_cafe')
    expect(html).not.toContain('data-report')
    expect(html).toContain('data-cat-amount')
    expect(visible(html)).toContain('Кафе и рестораны')
  })

  it('(г) телефон 2 — тот же отчёт без запроса; точка «новый» гаснет после открытия', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    const two = await as('member', 'b')
    await two.ai.autoReview(two.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(await screen(two.pinia, Month, '/month')).toContain('data-review-dot')
    const html = await report(two)
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice', 'advice'])
    expect(await screen(two.pinia, Month, '/month')).not.toContain('data-review-dot')
  })

  it('(д) viewer: «Открыть» есть, «Сделать» и «Обновить» нет; сам не разбирает', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    await sync(one)
    const viewer = await as('viewer', 'b')
    await viewer.ai.autoReview(viewer.aiClient)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const html = await report(viewer)
    expect(html).toContain('data-review-link')
    expect(html).not.toMatch(doBtn)
    expect(html).not.toContain('data-review-refresh')
  })

  it('(е) v3-разбор прошлого месяца в документе → «Итог прошлого месяца»: «Сделать» сделан, раздел совета к «обычно»', async () => {
    const one = await as('member', 'a')
    const r = (await one.ai.autoReview(one.aiClient))!
    const a = r.advices![0].action
    if (a.kind !== 'do') throw new Error('первый совет — «Сделать»')
    const prev: AiReview = { ...r, id: 'r-sep', month: '2026-09', at: '2026-09-01T04:00:00.000Z', reasonKey: 'month:2026-09' }
    one.store.mutateHouseholdDoc((d) => {
      d.aiReviews = [...(d.aiReviews ?? []), prev]
      d.planShifts = [...(d.planShifts ?? []), { id: 's-sep', period: '2026-09', by: 'a', from: a.candidate.shift.from, to: a.candidate.shift.to, amount: 10_000, at: T0, updatedAt: T0 }]
    })
    const html = await report(one)
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice', 'advice', 'outcome'])
    const outcome = visible(html.slice(html.indexOf('data-report-card="outcome"')))
    expect(outcome).toContain('Итог прошлого месяца')
    expect(outcome).toMatch(/Отложим в подушку ?Сделано/)
    expect(outcome).toContain('Кафе и рестораны')
  })

  it('(ж) демо: «Пример» — карточки, три совета, «Сделать» → «✓ Сделано»; запросов к ручке нет', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    expect(startDemo()).toBe(true)
    await nextTick()
    await nextTick()
    let html = await screen(pinia, Month, '/month?review=1')
    expect(html).toContain('data-review-example')
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice', 'advice'])
    expect(visible(html)).toContain('Магазин у дома')
    expect(html).toMatch(doBtn)
    expect(html).not.toContain('data-review-day')
    expect(html).not.toContain('data-review-refresh')
    setActivePinia(pinia)
    const finance = useFinanceStore()
    const { state, ctx } = finance.planInput(K)
    const { stepCandidates } = await import('../src/lib/finance')
    finance.addPlanShift(stepCandidates(state, ctx).find((c) => c.id === 'cushion')!.shift)
    html = await screen(pinia, Month, '/month?review=1')
    expect(html).toContain('data-review-done')
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('(з) `card=2` — отчёт стартует со второго совета', async () => {
    const one = await as('member', 'a')
    await one.ai.autoReview(one.aiClient)
    const html = await report(one, '?review=1&card=2')
    const active = html.slice(html.indexOf('data-active'))
    expect(active.slice(0, active.indexOf('</section>'))).toContain('Один вечер раздул раздел.')
    expect((html.match(/data-active/g) ?? []).length).toBe(1)
  })
})
