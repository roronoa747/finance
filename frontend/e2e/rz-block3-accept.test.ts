import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { AiReview, Goal, PersonId, ReviewPayloadV3, SyncDoc } from '../src/types/finance'
import type { ReviewFind, SpendTotal } from '../src/lib/statements/types'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 3 «Разбор» — ✦ и отчёт поверх старых данных (урок хотфиксов RZ-HF1…HF3). В документе семьи на проде —
 * v1 (август), v2 (сентябрь, октябрь 1-го) и v3 октября, записанный сборкой Блока 1 (имя продавца — как печатает банк) или
 * Блока 2 (короткое имя); подписи крупной цифры (`figure.label`, RZ-15) у них нет. Новая сборка на том же телефоне:
 * (а) ✦ у предметов советов старого разбора — раздел продавца, подушка в «Цели и фонды» и на её экране; ✦ ведёт на
 * карточку совета, подпись крупной цифры — `about` как сохранено; партнёр и viewer — те же ✦; запросов к ручке нет;
 * (б) новее v3 — v2 или v1 октября — ✦ нет нигде, отчёт — одна карточка «Разбор»;
 * (в) «Обновить» новой сборкой поверх старого — ✦ переезжают к предметам нового разбора, подпись — кодом; партнёр видит то же.
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
const MONTHS = ['2026-07', '2026-08', '2026-09']
const familyDoc = (): SyncDoc =>
  planFamilyDoc({
    goals: [...planFamilyDoc().goals, fund],
    spendTotals: [
      ...MONTHS.flatMap((m) => [total('a', m, 'sc_cafe', 30_000), total('a', m, 'sc_food', 80_000, 10), total('b', m, 'sc_food', 40_000, 8), total('a', m, 'sc_health', 12_000, 8)]),
      total('a', K, 'sc_cafe', 90_000), total('a', K, 'sc_food', 60_000, 8), total('a', K, 'sc_health', 12_000, 8),
    ],
    reviewFinds: [
      find('a', '2026-08', 'leak', 'apteka plus', { name: 'APTEKA PLUS ALMATY KZ', categoryId: 'sc_health', count: 8, amount: 12_000 }),
      find('b', '2026-09', 'leak', 'apteka plus', { name: 'APTEKA PLUS ALMATY KZ', categoryId: 'sc_health', count: 7, amount: 10_000 }),
      find('a', K, 'top', 'sc_cafe', { categoryId: 'sc_cafe', count: 3, amount: 90_000, top: [{ name: 'Restoran', amount: 50_000 }] }),
    ],
    aiReviews: [v1, v2('2026-09', '2026-09-01T04:00:00.000Z'), v2(K, '2026-10-01T04:00:00.000Z')],
  })
const upload = (slot: 'a' | 'b', from: string, to: string) => ({
  id: `up-${slot}-${from}`, slot, bank: 'kaspi', period_from: from, period_to: to, ops_count: 30, created_at: T0, user: `u-${slot}`,
})
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/\s+/g, ' ').trim()
const cards = (html: string) => [...html.matchAll(/data-report-card="([^"]+)"/g)].map((m) => m[1])
const marks = (html: string) => [...html.matchAll(/data-advice-mark[^>]*data-advice-card="(\d)"/g)].map((m) => m[1])
/** ✦ строки: номер карточки у ✦ в куске разметки от якоря строки до следующей строки того же вида. */
function markIn(html: string, anchor: string, next: RegExp): string | null {
  const from = html.indexOf(anchor)
  if (from < 0) return null
  const rest = html.slice(from + anchor.length)
  const end = rest.search(next)
  return marks(end < 0 ? rest : rest.slice(0, end))[0] ?? null
}
/** Подписи крупных цифр отчёта по порядку карточек. */
const figureLabels = (html: string) => [...html.matchAll(/data-review-figure-about[^>]*>([^<]*)</g)].map((m) => m[1].trim())

const act = (body: ReviewPayloadV3, re: RegExp) => body.actions.find((a) => re.test(a.about))!.id
const fact = (body: ReviewPayloadV3, re: RegExp) => body.facts.find((f) => re.test(f.about))!.id
/** Ответ модели старой сборки: «в подушку» (do), аптека (open продавца, крупная цифра — сумма утечки). */
const answerOld = (body: ReviewPayloadV3) => ({
  where: 'Кафе выросло из-за одного вечера.',
  advices: [
    { title: 'Отложим в подушку', text: 'Остаток месяца — в подушку.', figure: null, action: act(body, /в подушку/) },
    { title: 'Аптека у дома', text: 'Мелкие покупки складываются.', figure: fact(body, /^частые траты у .* — в месяц$/), action: act(body, /^открыть покупки у/) },
  ],
})
/** Ответ «Обновить» новой сборкой: «Кафе» (open раздела), аптека (open продавца, крупная цифра — в месяц). */
const answerNew = (body: ReviewPayloadV3) => ({
  where: 'Кафе выросло из-за одного вечера.',
  advices: [
    { title: 'Вечер в кафе', text: 'Раздел раздул один ужин.', figure: null, action: act(body, /^открыть .*Кафе/) },
    { title: 'Аптека у дома', text: 'Мелкие покупки складываются.', figure: fact(body, /^частые траты у .* — в месяц$/), action: act(body, /^открыть покупки у/) },
  ],
})
/** Разбор v3 так, как его сохранила старая сборка: подписи крупной цифры нет; у Блока 1 — ещё и имя продавца как у банка. */
const oldBuild = (block: 1 | 2) => (r: AiReview): AiReview => {
  const copy: AiReview = JSON.parse(block === 1 ? JSON.stringify(r).replaceAll('APTEKA PLUS', 'APTEKA PLUS ALMATY KZ') : JSON.stringify(r))
  for (const a of copy.advices ?? []) if (a.figure) delete a.figure.label
  return copy
}

describe('e2e / Разбор Блок 3 — приёмка: ✦ поверх старых разборов', { timeout: 120_000 }, () => {
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
    aiReview = vi.fn(async (body: ReviewPayloadV3) => answerOld(body))
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

  /** ✦ телефона: «Месяц» (траты, «Цели и фонды»), экран подушки, «Мечты», «Долги». */
  async function everywhere(p: Phone) {
    const month = (opened: string) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened })])
    const spend = await month('spend')
    const queue = await month('queue')
    return {
      health: markIn(spend, 'data-spend-row="sc_health"', /data-spend-row=/),
      cafe: markIn(spend, 'data-spend-row="sc_cafe"', /data-spend-row=/),
      food: markIn(spend, 'data-spend-row="sc_food"', /data-spend-row=/),
      queue: markIn(queue, 'data-queue="fund"', /data-queue=/),
      goal: markIn(await screen(p.pinia, GoalDetail, '/goals/fund'), 'data-cushion-cover', /<\/h2>/),
      dreams: marks(await screen(p.pinia, Dreams, '/')),
      debts: marks(await screen(p.pinia, Money, '/money/debts')),
    }
  }

  /**
   * Прод до обновления: старый v2 октября → разбор сам v3 один раз (RZ-HF1), в документе — v3 старой сборки (`block`);
   * телефон a его открыл. Возвращает тот же телефон a уже новой сборкой (свежий стор, `localStorage` прежний).
   */
  async function updated(block: 1 | 2, extra?: (d: SyncDoc) => void) {
    const prod = await as('member', 'a')
    const fresh = (await prod.ai.autoReview(prod.aiClient))!
    expect(fresh).toMatchObject({ v: 3, month: K })
    const old = oldBuild(block)(fresh)
    prod.store.mutateHouseholdDoc((d) => {
      d.aiReviews = (d.aiReviews ?? []).map((r) => (r.id === fresh.id ? old : r))
      extra?.(d)
    })
    prod.ai.markReviewSeen(old.id)
    await sync(prod)
    aiReview.mockClear()
    return { phone: await as('member', 'a', true), old }
  }

  it.each([1, 2] as const)('(а) v3 сборки Блока %s: ✦ у раздела продавца и подушки, карточка совета, подпись — `about`; партнёр и viewer — те же', async (block) => {
    const { phone, old } = await updated(block)
    expect(await phone.ai.autoReview(phone.aiClient)).toBeNull()
    const want = { health: '2', cafe: null, food: null, queue: '1', goal: '1', dreams: [], debts: [] }
    expect(await everywhere(phone)).toEqual(want)
    // ✦ раздела аптеки ведёт на вторую карточку — совет про продавца; подпись крупной цифры — служебная строка как сохранена.
    const html = await screen(phone.pinia, Month, '/month?review=1&card=2')
    expect(cards(html)).toEqual(['work', 'where', 'advice', 'advice'])
    const active = html.slice(html.indexOf('data-active'))
    expect(visible(active.slice(0, active.indexOf('</section>')))).toContain('Аптека у дома')
    const about = old.advices![1].figure!.about
    expect(about).toMatch(block === 1 ? /APTEKA PLUS ALMATY KZ/ : /APTEKA PLUS(?! ALMATY)/)
    expect(figureLabels(html)).toEqual([about])
    expect(html).toContain('href="/money/history?cat=sc_health"')
    // Партнёр и viewer — те же ✦, без запроса.
    expect(await everywhere(await as('member', 'b'))).toEqual(want)
    expect(await everywhere(await as('viewer', 'b'))).toEqual(want)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it.each([
    ['v2', () => v2(K, '2026-10-12T04:00:30.000Z')],
    ['v1', () => ({ ...v1, id: 'r-v1-oct', month: K, at: '2026-10-12T04:00:30.000Z' })],
  ])('(б) новее v3 — %s октября: ✦ нет нигде, отчёт — одна карточка', async (_v, late) => {
    const { phone } = await updated(1, (d) => {
      d.aiReviews = [...(d.aiReviews ?? []), { ...late(), id: 'r-late' }]
    })
    expect(phone.ai.adviceMarks.size).toBe(0)
    expect(await everywhere(phone)).toEqual({ health: null, cafe: null, food: null, queue: null, goal: null, dreams: [], debts: [] })
    expect(cards(await screen(phone.pinia, Month, '/month?review=1'))).toEqual(['old'])
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('(в) «Обновить» новой сборкой поверх старого: ✦ переезжают к новому разбору, подпись — кодом; партнёр — то же', async () => {
    const { phone, old } = await updated(1)
    aiReview.mockImplementation(async (body: ReviewPayloadV3) => answerNew(body))
    // «Обновить» — не раньше суток после разбора (Р-12).
    at('2026-10-13T05:00:00Z')
    setActivePinia(phone.pinia)
    const fresh = (await phone.ai.runReview(K, 'refresh', phone.aiClient))!
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(fresh).toMatchObject({ v: 3, month: K, reason: 'refresh' })
    expect(fresh.id).not.toBe(old.id)
    const label = fresh.advices![1].figure!.label!
    expect(label).toMatch(/^в месяц · /)
    expect(label).not.toContain('ALMATY')
    const want = { health: '2', cafe: '1', food: null, queue: null, goal: null, dreams: [], debts: [] }
    expect(await everywhere(phone)).toEqual(want)
    const html = await screen(phone.pinia, Month, '/month?review=1&card=2')
    // Заголовок «Аптека у дома» не содержит имени из подписи — подпись целиком («в месяц · APTEKA PLUS»).
    expect(figureLabels(html)).toEqual([label])
    await sync(phone)
    const two = await as('member', 'b')
    expect(await everywhere(two)).toEqual(want)
    expect(figureLabels(await screen(two.pinia, Month, '/month?review=1&card=2'))).toEqual([label])
    expect(aiReview).toHaveBeenCalledTimes(1)
  })
})
