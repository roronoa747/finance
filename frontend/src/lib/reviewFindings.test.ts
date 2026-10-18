import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { startDemo } from './demo'
import { monthKey } from './dates'
import { useFinanceStore } from '@/stores/finance'
import {
  costliestCredits,
  derivedCredits,
  earlierDays,
  findMonth,
  goalTerm,
  mainGoal,
  measureFor,
  monthPlan,
  prepayOutcome,
  REVIEW_FINDINGS_MAX,
  reviewFindings,
  reviewOutcome,
  reviewScenario,
  reviewWork,
  usualMonths,
  whereRows,
  type MonthPlanCtx,
  type ReviewFinding,
  type StepCandidate,
  type UploadPeriod,
} from './finance'
import { monthBy } from './dates'
import type { ReviewFind, SpendTotal } from './statements/types'
import { defaultSyncDoc } from '@/stores/finance'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiReview, Obligation, PersonId, SyncDoc } from '@/types/finance'

/**
 * RZ-02: находки семьи, сценарий, счётчик, «куда ушло» и итог прошлого месяца — по итогам участников в документе.
 *
 * Семья `planFamilyDoc`, октябрь 2026; выписки обоих участников — с 1 июля по 15 октября (месяц находок — октябрь,
 * «обычно» — июль…сентябрь). Кафе: 90 000 в закрытых месяцах, 150 000 в октябре — раздуло покупкой 35 000. Продукты:
 * 380 000 по 10 операций, в октябре 450 000 и 14 операций — «чаще». Развлечения: 20 000 → 40 000 без причины.
 */

const KEY = '2026-10'
const CLOSED = ['2026-07', '2026-08', '2026-09']
const UPLOADS: UploadPeriod[] = [
  { slot: 'a', period_from: '2026-07-01', period_to: '2026-10-15' },
  { slot: 'b', period_from: '2026-07-01', period_to: '2026-10-15' },
]
const total = (by: PersonId, period: string, categoryId: string, amount: number, ops: number): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops, updatedAt: T0,
})
const rf = (by: PersonId, period: string, kind: ReviewFind['kind'], key: string, rest: Partial<ReviewFind> = {}): ReviewFind => ({
  id: `${by}:${period}:${kind}:${key}`, by, period, kind, name: key.toUpperCase(), categoryId: null, count: 1, amount: 1_000, updatedAt: T0, ...rest,
})
const obligation = (id: string, name: string, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day: 5, category: 'd4', versions: [{ from: '2026-01', amount }], updatedAt: T0, ...extra,
} as Obligation)

const TOTALS: SpendTotal[] = [
  ...CLOSED.flatMap((m) => [total('a', m, 'sc_cafe', 90_000, 6), total('a', m, 'sc_food', 380_000, 10), total('b', m, 'sc_fun', 20_000, 5)]),
  total('a', KEY, 'sc_cafe', 150_000, 8),
  total('a', KEY, 'sc_food', 450_000, 14),
  total('b', KEY, 'sc_fun', 40_000, 5),
  total('b', KEY, 'sc_people', 900_000, 3),
]
const FINDS: ReviewFind[] = [
  rf('a', '2026-07', 'leak', 'apteka', { name: 'APTEKA', categoryId: 'sc_health', count: 7, amount: 10_500 }),
  rf('a', '2026-08', 'leak', 'apteka', { name: 'APTEKA', categoryId: 'sc_health', count: 8, amount: 12_000 }),
  rf('b', '2026-08', 'leak', 'apteka', { name: 'APTEKA', categoryId: 'sc_health', count: 6, amount: 9_000 }),
  // Один месяц из трёх — не утечка семьи.
  rf('b', '2026-09', 'leak', 'kofe', { count: 9, amount: 20_000 }),
  rf('a', KEY, 'top', 'sc_cafe', { name: '', categoryId: 'sc_cafe', count: 8, amount: 150_000, top: [{ name: 'Restoran X', amount: 35_000 }, { name: 'Bar Y', amount: 5_000 }] }),
  rf('a', KEY, 'top', 'sc_food', { name: '', categoryId: 'sc_food', count: 14, amount: 450_000, top: [{ name: 'Magnum', amount: 8_000 }] }),
  rf('a', KEY, 'recurring', 'fitness lab', { name: 'FITNESS LAB', categoryId: 'sc_fun', count: 2, amount: 15_000 }),
  rf('b', KEY, 'recurring', 'yandex plus', { name: 'YANDEX PLUS', count: 2, amount: 1_990 }),
  rf('a', KEY, 'pricier', 'kino', { name: 'KINO', count: 1, amount: 2_990, was: 2_490, targetId: 'kino' }),
  rf('a', KEY, 'pricier', 'insur', { name: 'INSUR', count: 1, amount: 66_000, was: 60_000, targetId: 'ins' }),
  rf('b', KEY, 'double', 'sport club', { name: 'SPORT CLUB', categoryId: 'sc_fun', count: 2, amount: 12_000 }),
  // Обнулённый итог и надгробие — мимо.
  rf('a', KEY, 'double', 'gone', { count: 0, amount: 0 }),
  rf('a', KEY, 'recurring', 'dead', { amount: 9_000, deletedAt: T0 }),
]

function family(extra: Partial<SyncDoc> = {}): SyncDoc {
  const base = planFamilyDoc()
  return planFamilyDoc({
    spendTotals: TOTALS,
    reviewFinds: FINDS,
    obligations: [
      ...(base.obligations ?? []),
      obligation('yp', 'Yandex Plus', 1_990),
      obligation('kino', 'Кинопоиск', 2_490),
      obligation('ins', 'Страховка', 60_000, { every: 'year' }),
    ],
    ...extra,
  })
}
const stateOf = (doc: SyncDoc) => ({ ...doc, credits: derivedCredits(doc.credits ?? [], doc.payments ?? []), book: null })
const ctxOf = (doc: SyncDoc, uploads = UPLOADS, key = KEY): MonthPlanCtx => ({ key, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads })
const findingsOf = (doc: SyncDoc) => reviewFindings(stateOf(doc), ctxOf(doc))
const of = <K extends ReviewFinding['kind']>(list: ReviewFinding[], kind: K) => list.filter((f): f is Extract<ReviewFinding, { kind: K }> => f.kind === kind)

/** Все числа находки — целые (правило 6), кроме доли полосы. */
function integers(x: unknown, path = ''): string[] {
  if (typeof x === 'number') return Number.isInteger(x) ? [] : [path]
  if (Array.isArray(x)) return x.flatMap((v, i) => integers(v, `${path}[${i}]`))
  if (x && typeof x === 'object') return Object.entries(x).flatMap(([k, v]) => integers(v, `${path}.${k}`))
  return []
}

describe('findMonth — о каком месяце находки', () => {
  it('выписка дошла до 7-го числа — текущий; иначе (разбор 1-го) — прошлый', () => {
    expect(findMonth({ key: KEY, uploads: UPLOADS })).toBe(KEY)
    expect(findMonth({ key: KEY, uploads: [{ slot: 'a', period_from: '2026-07-01', period_to: '2026-10-01' }] })).toBe('2026-09')
    expect(findMonth({ key: KEY, uploads: [] })).toBe('2026-09')
  })
})

describe('reviewFindings — находки семьи', () => {
  it('утечка из записей двух участников: среднее по месяцам с записью, цена в год, образ — доля главной мечты; 1 месяц из 3 — нет', () => {
    const doc = family()
    const [leak, ...others] = of(findingsOf(doc), 'leak')
    expect(others).toEqual([])
    const main = mainGoal(doc.goals ?? [], doc.goalOrder, doc.moneySettings)!
    // (10 500 + 12 000 + 9 000) / 2 месяца = 15 750; (7 + 8 + 6) / 2 = 10,5 → 11.
    expect(leak).toEqual({
      kind: 'leak', key: 'apteka', name: 'APTEKA', categoryId: 'sc_health', monthly: 15_750, count: 11, months: 2, yearly: 189_000,
      image: { kind: 'dream', goalId: main.id, name: main.name, share: Math.round((189_000 * 100) / main.need) },
    })
  })

  it('без мечты — мерка справочника по цене в год', () => {
    const [leak] = of(findingsOf(family({ goals: [] })), 'leak')
    const m = measureFor(189_000)
    expect(leak.image).toEqual(m ? { kind: 'measure', name: m.name, price: m.price } : null)
  })

  it('«раздуло» покупкой (35 000 ≥ ½ прироста 60 000) и частотой (14 операций против 10); без причины — строки нет', () => {
    const grew = of(findingsOf(family()), 'grew')
    expect(grew.map((g) => g.categoryId)).toEqual(['sc_food', 'sc_cafe'])
    expect(grew[1]).toMatchObject({ amount: 150_000, usual: 90_000, growth: 60_000, yearly: 720_000, why: { kind: 'purchases', items: [{ name: 'Restoran X', amount: 35_000 }] } })
    expect(grew[0]).toMatchObject({ amount: 450_000, usual: 380_000, growth: 70_000, why: { kind: 'often', count: 14, usualCount: 10 } })
    // Развлечения выше обычного, но ни покупок, ни частоты — не находка (Р-1).
    expect(grew.some((g) => g.categoryId === 'sc_fun')).toBe(false)
  })

  it('регулярное с обязательством того же имени — мимо; подорожание годового — разница, месячного — × 12; двойное — лишнее × 12', () => {
    const list = findingsOf(family())
    expect(of(list, 'recurring')).toEqual([{ kind: 'recurring', key: 'fitness lab', name: 'FITNESS LAB', categoryId: 'sc_fun', amount: 15_000, count: 2, yearly: 180_000 }])
    const pricier = of(list, 'pricier')
    expect(pricier.find((p) => p.obligationId === 'ins')).toMatchObject({ name: 'Страховка', amount: 66_000, was: 60_000, yearly: 6_000 })
    expect(pricier.find((p) => p.obligationId === 'kino')).toMatchObject({ name: 'Кинопоиск', amount: 2_990, was: 2_490, yearly: 6_000 })
    // Платёж стал оценкой, а телефон записал подорожание раньше (несинхронный партнёр) — у семьи его нет.
    const estimated = family()
    estimated.obligations = estimated.obligations!.map((o) => (o.id === 'kino' ? { ...o, estimate: true } : o))
    expect(of(findingsOf(estimated), 'pricier').map((p) => p.obligationId)).toEqual(['ins'])
    expect(of(list, 'double')).toEqual([{ kind: 'double', key: 'sport club', name: 'SPORT CLUB', categoryId: 'sc_fun', amount: 12_000, count: 2, yearly: 144_000 }])
  })

  it('порядок: «раздуло» по приросту, затем по цене в год; не больше 12; все числа целые', () => {
    const list = findingsOf(family())
    expect(list.map((f) => f.kind)).toEqual(['grew', 'grew', 'leak', 'recurring', 'double', 'pricier', 'pricier'])
    expect(integers(list)).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => rf('a', KEY, 'double', `club ${'abcdefghijklmnopqrst'[i]}`, { count: 2, amount: 2_000 + i }))
    expect(findingsOf(family({ reviewFinds: [...FINDS, ...many] }))).toHaveLength(REVIEW_FINDINGS_MAX)
  })

  it('месяц находок — прошлый, когда текущий не начат: «раздуло» и списания — о сентябре', () => {
    const doc = family({ reviewFinds: [rf('a', '2026-09', 'double', 'sport club', { count: 2, amount: 12_000 })] })
    const ctx = ctxOf(doc, [{ slot: 'a', period_from: '2026-07-01', period_to: '2026-10-01' }, { slot: 'b', period_from: '2026-07-01', period_to: '2026-10-01' }])
    expect(reviewFindings(stateOf(doc), ctx).map((f) => f.kind)).toEqual(['double'])
  })

  it('пустая семья — пусто без падений', () => {
    const doc = defaultSyncDoc()
    const ctx = ctxOf(doc, [])
    expect(reviewFindings(stateOf(doc), ctx)).toEqual([])
    expect(reviewScenario(stateOf(doc), ctx, [])).toBeNull()
    expect(reviewWork(stateOf(doc), ctx, [])).toEqual({ ops: 0, found: 0, yearly: 0 })
    expect(whereRows(stateOf(doc), ctx)).toEqual([])
    expect(reviewOutcome(stateOf(doc), ctx, null)).toBeNull()
  })
})

describe('демо-семья (без находок демо — RZ-09)', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-16T06:00:00Z']) {
    it(`${day}: только «раздуло» или ничего, без падений; числа целые`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(day))
      const map = new Map<string, string>()
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, String(v)),
        removeItem: (k: string) => map.delete(k),
        clear: () => map.clear(),
      })
      setActivePinia(createPinia())
      expect(startDemo()).toBe(true)
      await nextTick()
      const finance = useFinanceStore()
      const { state, ctx } = finance.planInput(monthKey())
      const list = reviewFindings(state, ctx)
      expect(list.every((f) => f.kind === 'grew')).toBe(true)
      expect(integers(list)).toEqual([])
      expect(reviewWork(state, ctx, list).ops).toBeGreaterThan(0)
      expect(whereRows(state, ctx).length).toBeGreaterThan(0)
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })
  }
})

describe('reviewScenario — «если… — мечта раньше»', () => {
  it('утечка — самая дорогая из утечек, новых и двойных: мечта раньше на `earlierDays`', () => {
    const doc = family()
    const list = findingsOf(doc)
    const s = reviewScenario(stateOf(doc), ctxOf(doc), list)!
    const main = mainGoal(doc.goals ?? [], doc.goalOrder, doc.moneySettings)!
    expect(s).toEqual({ finding: of(list, 'leak')[0], monthly: 15_750, days: earlierDays(main, KEY, 15_750), goalId: main.id, goalName: main.name })
    expect((s as { days: number }).days).toBeGreaterThan(0)
  })

  it('платёж кредита, аренда, коммуналка — не сценарий (их «убрать» нельзя): берётся следующая находка', () => {
    const credit = rf('a', KEY, 'recurring', 'oplata kredita', { name: 'ОПЛАТА КРЕДИТА', categoryId: 'sc_credit', count: 2, amount: 100_000 })
    const doc = family({ reviewFinds: [...FINDS, credit] })
    const list = findingsOf(doc)
    expect(of(list, 'recurring').map((f) => f.categoryId)).toContain('sc_credit')
    expect(reviewScenario(stateOf(doc), ctxOf(doc), list)!.finding).toBe(of(list, 'leak')[0])
  })

  it('без мечты — досрочка в самый дорогой долг (`prepayOutcome`); без мечты и долгов — null', () => {
    const doc = family({ goals: [] })
    const list = findingsOf(doc)
    const credit = costliestCredits(stateOf(doc).credits)[0]
    const out = prepayOutcome(credit, 15_750, 'monthly')!
    expect(reviewScenario(stateOf(doc), ctxOf(doc), list)).toEqual({
      finding: of(list, 'leak')[0], monthly: 15_750, months: out.monthsSaved, saved: out.saved, creditId: credit.id, creditName: credit.name,
    })
    const bare = family({ goals: [], credits: [] })
    expect(reviewScenario(stateOf(bare), ctxOf(bare), findingsOf(bare))).toBeNull()
  })
})

describe('reviewWork — счётчик', () => {
  it('операций за текущий и до 3 месяцев «обычно» всех участников; находок — все; ₸ в год — только у советов', () => {
    const doc = family()
    const list = findingsOf(doc)
    const months = [KEY, ...usualMonths(doc.people ?? [], TOTALS, UPLOADS, KEY, 3)]
    expect(months).toEqual([KEY, '2026-09', '2026-08', '2026-07'])
    const ops = TOTALS.filter((t) => months.includes(t.period)).reduce((s, t) => s + t.ops, 0)
    const used = [list[0], of(list, 'leak')[0], of(list, 'leak')[0]]
    expect(reviewWork(stateOf(doc), ctxOf(doc), list, used)).toEqual({ ops, found: list.length, yearly: list[0].yearly + 189_000 })
  })
})

describe('whereRows — «куда ушло»', () => {
  it('до 5 разделов по факту, без переводов людям; доля полосы 0…1 от самой длинной', () => {
    const doc = family()
    const rows = whereRows(stateOf(doc), ctxOf(doc))
    expect(rows.map((r) => r.categoryId)).toEqual(['sc_food', 'sc_cafe', 'sc_fun'])
    expect(rows[0]).toMatchObject({ amount: 450_000, usual: 380_000, share: 1 })
    for (const r of rows) expect(r.share).toBeLessThanOrEqual(1)
    expect(rows[1].share).toBeCloseTo(150_000 / 450_000)
    expect(integers(rows.map(({ share: _s, ...r }) => r))).toEqual([])
  })
})

describe('reviewOutcome — итог прошлого месяца', () => {
  const cushion: StepCandidate = { id: 'cushion', kind: 'cushion', shift: { period: '2026-09', from: 'rest', to: { goalId: 'cushion' }, amount: 50_000 }, effect: { months: null } }
  const prev = (extra: Partial<AiReview> = {}): AiReview => ({
    id: 'r1', month: '2026-09', at: T0, by: 'a', good: '', risk: '', steps: [], v: 3, updatedAt: T0,
    where: 'w',
    advices: [
      { title: 'В подушку', text: 't', figure: null, action: { kind: 'do', candidate: cushion } },
      { title: 'Кафе', text: 't', figure: null, action: { kind: 'open', target: { kind: 'cat', id: 'sc_cafe', name: 'Кафе' } } },
    ],
    sent: { facts: [{ id: 'f1', about: 'главная мечта «Подушка» — срок', value: 'к маю 2034', raw: '2034-05' }], candidates: [] },
    ...extra,
  })

  it('«Сделать» сделан / нет, раздел совета — сентябрь к «обычно», срок мечты был / стал', () => {
    const doc = family()
    const shift = { id: 's1', period: '2026-09', by: 'a' as const, from: 'rest' as const, to: { goalId: 'cushion' }, amount: 50_000, at: T0, updatedAt: T0 }
    const state = stateOf(family({ planShifts: [shift] }))
    const out = reviewOutcome(state, ctxOf(doc), prev())!
    expect(out.done).toEqual([{ title: 'В подушку', done: true }])
    expect(reviewOutcome(stateOf(doc), ctxOf(doc), prev())!.done).toEqual([{ title: 'В подушку', done: false }])
    // «Обычно» на сегодня — июль…сентябрь: 90 000.
    expect(out.sections).toEqual([{ categoryId: 'sc_cafe', name: 'Кафе и рестораны', amount: 90_000, usual: 90_000 }])
    const main = mainGoal(doc.goals ?? [], doc.goalOrder, doc.moneySettings)!
    const item = monthPlan(state, ctxOf(doc)).queue.find((q) => q.goalId === main.id)
    const now = goalTerm(item, main, KEY).doneMonth
    expect(out.dream).toEqual({ name: 'Подушка', was: 'к маю 2034', now: now ? monthBy(now, KEY) : null })
  })

  it('не v3, не прошлый месяц или нет — null; мечта другая — срока нет', () => {
    const doc = family()
    expect(reviewOutcome(stateOf(doc), ctxOf(doc), null)).toBeNull()
    expect(reviewOutcome(stateOf(doc), ctxOf(doc), prev({ v: 2 }))).toBeNull()
    expect(reviewOutcome(stateOf(doc), ctxOf(doc), prev({ month: '2026-08' }))).toBeNull()
    const other = prev({ sent: { facts: [{ id: 'f1', about: 'главная мечта «Дом» — срок', value: 'к маю 2034', raw: '2034-05' }], candidates: [] } })
    expect(reviewOutcome(stateOf(doc), ctxOf(doc), other)!.dream).toBeNull()
  })
})
