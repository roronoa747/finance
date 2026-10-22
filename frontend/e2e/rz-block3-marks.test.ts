import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { demoReview, startDemo } from '../src/lib/demo'
import { reviewCardOrder, reviewCards, stepCandidates, type StepCandidate } from '../src/lib/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { AiAdvice, AiReview, Goal, Obligation, SyncDoc } from '../src/types/finance'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 3 «Разбор» (RZ-12): ✦ у предметов советов разбора v3 на двух телефонах против фейкового сервера документа (ручка
 * разбора — `vi.fn`, не зовётся: разбор уже в документе). Семья 12 октября: подушка-фонд, подписка iCloud, кредиты.
 * Разбор октября: 1 — «Открыть» раздела «Кафе», 2 — «Открыть» подписки iCloud, 3 — «Сделать» в подушку; второй разбор
 * («Обновить») — досрочка в карточку долга. (а) ✦ у раздела и платежа на «Месяце», у подписки на «Деньгах», у подушки в
 * «Цели и фонды» и на её экране (на «Мечтах» фондов нет — решение исполнителя RZ-11), у кредита на «Долгах»; (б) ✦ →
 * `/month?review=1&card=<n>` — отчёт на карточке совета; (в) телефон 2 и viewer — те же ✦; (г) разбор только прошлого
 * месяца — ✦ нет; (д) демо — ✦ по заготовке, запросов 0.
 */
const K = '2026-10'
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const icloud: Obligation = { id: 'icloud', name: 'iCloud', note: '', day: 15, category: 'd4', versions: [{ from: '2000-01', amount: 1_500 }], updatedAt: T0 }
const netflix: Obligation = { id: 'netflix', name: 'Netflix', note: '', day: 5, category: 'd4', versions: [{ from: '2000-01', amount: 5_000 }], updatedAt: T0 }
const base = (): SyncDoc =>
  planFamilyDoc({
    goals: [...planFamilyDoc().goals, fund],
    obligations: [...planFamilyDoc().obligations, icloud, netflix],
    spendPlans: [{ id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 40_000, updatedAt: T0 }],
  })
/** Кандидат кода по id — из входа плана семьи на 12 октября. */
function candidate(id: string): StepCandidate {
  const pinia = createPinia()
  setActivePinia(pinia)
  const finance = useFinanceStore()
  finance.setHouseholdDoc(base(), 1)
  const { state, ctx } = finance.planInput(K)
  return stepCandidates(state, ctx).find((c) => c.id === id)!
}
const open = (title: string, target: Extract<AiAdvice['action'], { kind: 'open' }>['target']): AiAdvice => ({ title, text: `${title}.`, figure: null, action: { kind: 'open', target } })
const doIt = (title: string, c: StepCandidate): AiAdvice => ({ title, text: `${title}.`, figure: null, action: { kind: 'do', candidate: c } })
const review = (month: string, advices: AiAdvice[], extra: Partial<AiReview> = {}): AiReview => ({
  id: `r-${month}`, month, at: `${month}-01T04:00:00.000Z`, by: 'a', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
  v: 3, reason: 'month', reasonKey: `month:${month}`, where: 'Кафе выросло.', work: { ops: 120, found: 3, monthly: 0 }, advices, ...extra,
})

const marks = (html: string) => [...html.matchAll(/data-advice-mark[^>]*data-advice-card="(\d)"/g)].map((m) => m[1])
/** ✦ строки: номер карточки у ✦ в куске разметки от якоря строки до следующей строки того же вида. */
function markIn(html: string, anchor: string, next: RegExp): string | null {
  const from = html.indexOf(anchor)
  if (from < 0) return null
  const rest = html.slice(from + anchor.length)
  const end = rest.search(next)
  return marks(end < 0 ? rest : rest.slice(0, end))[0] ?? null
}

// Каждый телефон рисует 7 экранов SSR (первый — с холодной загрузкой модулей): под полной нагрузкой — дольше 30 с.
describe('e2e / Разбор Блок 3 — ✦ у предметов', { timeout: 120_000 }, () => {
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
    st = fakeStatements()
    pv = fakePrivate()
    for (const slot of ['a', 'b']) pv.docs.set(`u-${slot}`, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })
    aiReview = vi.fn(async () => {
      throw new Error('разбор уже в документе — ручка не зовётся')
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Разбор октября в документе сервера: раздел, подписка, подушка. */
  const withReview = (reviews?: AiReview[]) => {
    const cushion = candidate('cushion')
    expect(cushion, 'у семьи есть кандидат «в подушку»').toBeTruthy()
    server = fakeServer({
      ...base(),
      aiReviews: reviews ?? [review(K, [open('Кафе', { kind: 'cat', id: 'sc_cafe', name: 'Кафе' }), open('Подписка', { kind: 'obligation', id: 'icloud', name: 'iCloud' }), doIt('В подушку', cushion)])],
    })
  }

  /** Телефон: свой стор, документ скачан; флаг ИИ — с сервера. */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    storage.clear()
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
    return { pinia, store, ai, aiClient: { ...priv, aiReview } as unknown as ApiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>

  /** Все ✦ телефона: «Месяц» (разделы раскрыты по одному, подписки раскрыты), «Деньги», экран подушки, «Мечты», «Долги». */
  async function everywhere(p: Phone) {
    const month = (opened: string) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened, subsOpen: true })])
    const spend = await month('spend')
    const dues = await month('dues')
    const queue = await month('queue')
    const money = await screen(p.pinia, Money, '/money', undefined, [screenMixin({ subsOpen: true })])
    return {
      cat: markIn(spend, 'data-spend-row="sc_cafe"', /data-spend-row=/),
      food: markIn(spend, 'data-spend-row="sc_food"', /data-spend-row=/),
      due: markIn(dues, 'data-due-id="obligation:icloud"', /data-due-id=/),
      rent: markIn(dues, 'data-due-id="obligation:rent"', /data-due-id=/),
      subsCalls: (dues.match(/data-subs-mark/g) ?? []).length,
      queue: markIn(queue, 'data-queue="fund"', /data-queue=/),
      money: markIn(money, '>iCloud<', /data-payment/),
      goal: markIn(await screen(p.pinia, GoalDetail, '/goals/fund'), 'data-cushion-cover', /<\/h2>/),
      dreams: marks(await screen(p.pinia, Dreams, '/')),
      debts: marks(await screen(p.pinia, Money, '/money/debts')),
    }
  }

  it('(а) ✦ у раздела и платежа на «Месяце», у подписки на «Деньгах», у подушки в «Цели и фонды» и на её экране', async () => {
    withReview()
    const one = await as('member', 'a')
    expect(useAiStore().adviceMarks.size).toBeGreaterThan(0)
    const m = await everywhere(one)
    expect(m).toMatchObject({ cat: '1', food: null, due: '2', rent: null, queue: '3', money: '2', goal: '3', dreams: [], debts: [] })
    // Свёрнутая группа подписок зовёт ✦ без кнопки.
    expect(m.subsCalls).toBe(1)
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('(а) досрочка — ✦ у кредита карточки долга на «Долгах» и у карточки долга в «Цели и фонды»', async () => {
    const prepay = candidate('prepay')
    expect(prepay, 'у семьи есть кандидат досрочки').toBeTruthy()
    withReview([review(K, [doIt('Досрочно', prepay)])])
    const one = await as('member', 'a')
    const credit = one.store.monthPlanOf(K).queue.find((q) => q.kind === 'debt')!.creditId!
    const debts = await screen(one.pinia, Money, '/money/debts')
    expect(markIn(debts, `data-debt="${credit}"`, /data-debt=/)).toBe('1')
    expect(marks(debts)).toEqual(['1'])
    const queue = await screen(one.pinia, Month, '/month', undefined, [screenMixin({ opened: 'queue' })])
    expect(marks(queue)).toEqual(['1'])
  })

  it('(б) ✦ ведёт на `/month?review=1&card=<n>` — отчёт стартует с карточки этого совета', async () => {
    withReview()
    const one = await as('member', 'a')
    const html = await screen(one.pinia, Month, '/month?review=1&card=2')
    const active = html.slice(html.indexOf('data-active'))
    expect(active.slice(0, active.indexOf('</section>'))).toContain('Подписка')
    expect((html.match(/data-active/g) ?? []).length).toBe(1)
  })

  it('(в) телефон 2 (партнёр) и viewer — те же ✦, кроме разделов трат Ильяса (их у них на экране нет, FB-12)', async () => {
    withReview()
    const want = await everywhere(await as('member', 'a'))
    expect(await everywhere(await as('member', 'b'))).toEqual({ ...want, cat: null })
    expect(await everywhere(await as('viewer', 'b'))).toEqual({ ...want, cat: null })
    expect(aiReview).not.toHaveBeenCalled()
  })

  it('(г) разбор только прошлого месяца — ✦ нет нигде', async () => {
    withReview([review('2026-09', [open('Кафе', { kind: 'cat', id: 'sc_cafe', name: 'Кафе' }), open('Подписка', { kind: 'obligation', id: 'icloud', name: 'iCloud' })])])
    const one = await as('member', 'a')
    const m = await everywhere(one)
    expect(m).toMatchObject({ cat: null, due: null, queue: null, money: null, goal: null, dreams: [], debts: [], subsCalls: 0 })
  })

  // v4 (бэклог «Фидбек», Р-27): заготовка демо — мысль поверх карточек кода; ✦ — у разделов карточек, номер — место в отчёте.
  it('(д) демо — ✦ по заготовке v4 (раздел карточки кода — её номер), запросов к ручке и серверу нет', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    expect(startDemo()).toBe(true)
    await nextTick()
    const finance = useFinanceStore()
    const ops = useOperationsStore()
    const demo = demoReview(finance.householdDoc, finance.planInput(K), ops.all)
    const { state, ctx } = finance.planInput(K)
    const cards = reviewCardOrder(reviewCards({ ...finance.householdDoc, ...state }, ctx, ops.all, 'a'), demo.next)
    const firstOf = new Map<string, string>()
    cards.forEach((c, i) => {
      const t = c.target
      const cat = t.kind === 'cat' || t.kind === 'plan' ? t.categoryId : t.kind === 'image' ? t.image.categoryId : null
      if (cat && !firstOf.has(cat)) firstOf.set(cat, String(i + 1))
    })
    const sellers = [...firstOf]
    expect(sellers.length).toBeGreaterThan(0)
    const spend = await screen(pinia, Month, '/month', undefined, [screenMixin({ opened: 'spend' })])
    // Раздел подписок живёт в платежах (строки трат у него нет) — проверяем разделы со строкой на «Месяце».
    const rows = sellers.filter(([cat]) => spend.includes(`data-spend-row="${cat}"`))
    expect(rows.length).toBeGreaterThan(0)
    for (const [cat, n] of rows) expect(markIn(spend, `data-spend-row="${cat}"`, /data-spend-row=/), cat).toBe(n)
    expect(aiReview).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
