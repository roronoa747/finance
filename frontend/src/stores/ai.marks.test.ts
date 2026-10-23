import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEMO_TOKEN, useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { useAiStore } from './ai'
import { useOperationsStore } from './operations'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { demoReview, startDemo } from '@/lib/demo'
import { reviewCardOrder, reviewCards, type StepCandidate } from '@/lib/finance'
import { seedOwnMonth } from '@/test/reviewV4'
import type { AiAdvice, AiReview, OpenTarget } from '@/types/finance'

/**
 * RZ-10 (бэклог «Разбор», Р-9, Р-23): `adviceMarks` — предмет совета разбора v3 текущего месяца → номер совета; ✦ у
 * предметов берут его через `markFor`. «Открыть» — цель (продавец метит и свой раздел), «Сделать» — откуда и куда,
 * досрочка — кредит карточки долга очереди; первый совет на предмет побеждает; прошлый месяц, v2 и семья без ИИ — пусто.
 */
const NOW = '2026-09-12T07:00:00Z'
const KEY = '2026-09'

beforeEach(() => {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
  })
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const open = (target: OpenTarget): AiAdvice => ({ title: 'Совет', text: 'Текст.', figure: null, action: { kind: 'open', target } })
const doIt = (candidate: StepCandidate): AiAdvice => ({ title: 'Шаг', text: 'Текст.', figure: null, action: { kind: 'do', candidate } })
const move: StepCandidate = { id: 'move:sc_cafe', kind: 'move', shift: { period: KEY, from: { spend: 'a', categoryId: 'sc_cafe' }, to: { goalId: 'trip' }, amount: 20_000 }, effect: { days: 5 } }
const prepay: StepCandidate = { id: 'prepay', kind: 'prepay', shift: { period: KEY, from: 'rest', to: 'debt', amount: 50_000 }, effect: { months: 1, saved: 4_000 } }
const cushion: StepCandidate = { id: 'cushion', kind: 'cushion', shift: { period: KEY, from: 'rest', to: { goalId: 'cushion' }, amount: 30_000 }, effect: { months: 1 } }

const review = (advices: AiAdvice[], extra: Partial<AiReview> = {}): AiReview => ({
  id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
  v: 3, reason: 'month', where: '', advices, work: { ops: 10, found: 2, yearly: 0 }, ...extra,
})

function family(reviews: AiReview[], opts: { role?: 'member' | 'viewer'; ai?: boolean } = {}) {
  const auth = useAuthStore()
  auth.setAuthData(authAs(opts.role ?? 'member', opts.role === 'viewer' ? 'b' : 'a'))
  auth.ai = opts.ai ?? true
  useFinanceStore().setHouseholdDoc(planFamilyDoc({ aiReviews: reviews }), 1)
  return useAiStore()
}

describe('stores/ai — adviceMarks (RZ-10)', () => {
  it('«Открыть» всех видов — предмет цели; продавец метит и свой раздел', () => {
    const ai = family([
      review([
        open({ kind: 'cat', id: 'sc_food', name: 'Продукты' }),
        open({ kind: 'seller', id: 'kofeinya', name: 'Кофейня', categoryId: 'sc_cafe' }),
        open({ kind: 'obligation', id: 'rent', name: 'Аренда' }),
      ]),
    ])
    expect([...ai.adviceMarks]).toEqual([
      ['cat:sc_food', 1],
      ['seller:kofeinya', 2],
      ['cat:sc_cafe', 2],
      ['obligation:rent', 3],
    ])
    expect(ai.markFor('cat', 'sc_cafe')).toBe(2)
    expect(ai.markFor('obligation', 'rent')).toBe(3)
    expect(ai.markFor('goal', 'trip')).toBeNull()
    expect(ai.markFor('cat', undefined)).toBeNull()
  })

  it('мечта и долг из «Открыть»; «Сделать» — раздел и мечта переноса, подушка, кредит карточки долга очереди', () => {
    const debtCredit = () => useFinanceStore().monthPlanOf(KEY).queue.find((q) => q.kind === 'debt')?.creditId
    let ai = family([review([open({ kind: 'goal', id: 'car', name: 'Машина' }), open({ kind: 'credit', id: 'loan', name: 'Кредит' })])])
    expect(ai.markFor('goal', 'car')).toBe(1)
    expect(ai.markFor('credit', 'loan')).toBe(2)

    setActivePinia(createPinia())
    ai = family([review([doIt(move), doIt(prepay), doIt(cushion)])])
    expect(ai.markFor('cat', 'sc_cafe')).toBe(1)
    expect(ai.markFor('goal', 'trip')).toBe(1)
    const credit = debtCredit()
    expect(credit, 'у семьи есть карточка долга с кредитом').toBeTruthy()
    expect(ai.markFor('credit', credit)).toBe(2)
    expect(ai.markFor('goal', 'cushion')).toBe(3)
  })

  it('первый совет на предмет побеждает', () => {
    const ai = family([review([open({ kind: 'cat', id: 'sc_cafe', name: 'Кафе' }), doIt(move)])])
    expect(ai.markFor('cat', 'sc_cafe')).toBe(1)
    expect(ai.markFor('goal', 'trip')).toBe(2)
  })

  it('viewer и партнёр — те же метки (разбор общий)', () => {
    const ai = family([review([open({ kind: 'cat', id: 'sc_food', name: 'Продукты' })])], { role: 'viewer' })
    expect(ai.markFor('cat', 'sc_food')).toBe(1)
  })

  it('пусто: разбор прошлого месяца, разбор v2, семья без ИИ, разбора нет', () => {
    const cat = open({ kind: 'cat', id: 'sc_food', name: 'Продукты' })
    expect(family([review([cat], { month: '2026-08', id: 'old' })]).adviceMarks.size).toBe(0)
    setActivePinia(createPinia())
    expect(family([review([cat], { v: 2 })]).adviceMarks.size).toBe(0)
    setActivePinia(createPinia())
    expect(family([review([cat])], { ai: false }).adviceMarks.size).toBe(0)
    setActivePinia(createPinia())
    expect(family([]).adviceMarks.size).toBe(0)
  })

  it('демо — по заготовке v4 (`demoReview`): разделы карточек кода метятся местом карточки в отчёте', () => {
    expect(startDemo()).toBe(true)
    expect(useAuthStore().token).toBe(DEMO_TOKEN)
    const finance = useFinanceStore()
    // Разбор в документе демо не пишется — меток по документу нет, только заготовка.
    expect(finance.aiReviewOf(KEY)).toBeNull()
    const ops = useOperationsStore()
    const demo = demoReview(finance.householdDoc, finance.planInput(KEY), ops.all)
    const { state, ctx } = finance.planInput(KEY)
    const cards = reviewCardOrder(reviewCards({ ...finance.householdDoc, ...state }, ctx, ops.all, 'a'), demo.next)
    const ai = useAiStore()
    const seen = new Set<string>()
    cards.forEach((c, i) => {
      const t = c.target
      const cat = t.kind === 'cat' || t.kind === 'plan' ? t.categoryId : t.kind === 'image' ? t.image.categoryId : null
      if (!cat || seen.has(cat)) return
      seen.add(cat)
      expect(ai.markFor('cat', cat), c.id).toBe(i + 1)
    })
  })
})

// FB-16 (бэклог «Фидбек», Р-27): свой разбор v4 — ✦ у предметов карточек кода, номер — место в отчёте (`next` — первой).
describe('stores/ai — adviceMarks v4', () => {
  it('свой v4: «Не разобрано» первой (без предмета), продукты без плана — ✦ у раздела номером 2', async () => {
    const ai = family([])
    useFinanceStore().mutatePrivateDoc((d) => {
      d.aiReviews = [review([], { id: 'mine', by: 'a', v: 4, advices: undefined, lead: { title: 'Главное', text: 'Текст.', figure: null }, next: 'unknown' })]
    })
    await seedOwnMonth(KEY)
    expect(ai.markFor('cat', 'sc_food')).toBe(2)
  })
})
