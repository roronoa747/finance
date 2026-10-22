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
  goalPace,
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
  reviewWorkMonthly,
  spendCompare,
  usualMonths,
  whereRows,
  type MonthPlanCtx,
  type ReviewFinding,
  type StepCandidate,
  type UploadPeriod,
} from './finance'
import { monthBy } from './dates'
import { buildReviewFacts } from './aiFacts'
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
  it('утечка из записей двух участников: среднее по месяцам с записью — за месяц (без × 12), образ — доля месячного взноса в главную мечту; 1 месяц из 3 — нет', () => {
    const doc = family()
    const [leak, ...others] = of(findingsOf(doc), 'leak')
    expect(others).toEqual([])
    const main = mainGoal(doc.goals ?? [], doc.goalOrder, doc.moneySettings)!
    const pace = goalPace(main, KEY)
    expect(pace).toBeGreaterThan(0)
    // (10 500 + 12 000 + 9 000) / 2 месяца = 15 750; (7 + 8 + 6) / 2 = 10,5 → 11. Годовой цены у находки нет («Фидбек», Р-19).
    expect(leak).toEqual({
      kind: 'leak', key: 'apteka', name: 'APTEKA', categoryId: 'sc_health', monthly: 15_750, count: 11, months: 2,
      image: { kind: 'dream', goalId: main.id, name: main.name, share: Math.round((15_750 * 100) / pace) },
    })
    expect(leak).not.toHaveProperty('yearly')
  })

  it('без мечты — мерка справочника по сумме в месяц', () => {
    const [leak] = of(findingsOf(family({ goals: [] })), 'leak')
    const m = measureFor(15_750)
    expect(leak.image).toEqual(m ? { kind: 'measure', name: m.name, price: m.price } : null)
  })

  it('мечта без темпа (ни плана взноса, ни взносов) — не доля мечты, а мерка по сумме в месяц', () => {
    const base = family()
    const main = mainGoal(base.goals ?? [], base.goalOrder, base.moneySettings)!
    const doc = family({ goals: (base.goals ?? []).map((g) => (g.id === main.id ? { ...g, monthly: 0, movements: [] } : g)) })
    expect(goalPace(mainGoal(doc.goals ?? [], doc.goalOrder, doc.moneySettings)!, KEY)).toBe(0)
    const [leak] = of(findingsOf(doc), 'leak')
    const m = measureFor(15_750)
    expect(leak.image).toEqual(m ? { kind: 'measure', name: m.name, price: m.price } : null)
  })

  it('«раздуло» покупкой (35 000 ≥ ½ прироста 60 000) и частотой (14 операций против 10); без причины — строки нет; ₸ в месяц — прирост', () => {
    const grew = of(findingsOf(family()), 'grew')
    expect(grew.map((g) => g.categoryId)).toEqual(['sc_food', 'sc_cafe'])
    expect(grew[1]).toMatchObject({ amount: 150_000, usual: 90_000, growth: 60_000, monthly: 60_000, why: { kind: 'purchases', items: [{ name: 'Restoran X', amount: 35_000 }] } })
    expect(grew[0]).toMatchObject({ amount: 450_000, usual: 380_000, growth: 70_000, monthly: 70_000, why: { kind: 'often', count: 14, usualCount: 10 } })
    // Развлечения выше обычного, но ни покупок, ни частоты — не находка (Р-1).
    expect(grew.some((g) => g.categoryId === 'sc_fun')).toBe(false)
  })

  it('регулярное с обязательством того же имени — мимо; новое — сумма в месяц; подорожание — разница (годового — «раз в год»); двойное — лишнее в месяц', () => {
    const list = findingsOf(family())
    expect(of(list, 'recurring')).toEqual([{ kind: 'recurring', key: 'fitness lab', name: 'FITNESS LAB', categoryId: 'sc_fun', amount: 15_000, count: 2, monthly: 15_000 }])
    const pricier = of(list, 'pricier')
    expect(pricier.find((p) => p.obligationId === 'ins')).toEqual({ kind: 'pricier', key: 'insur', name: 'Страховка', obligationId: 'ins', amount: 66_000, was: 60_000, monthly: 500, every: 'year' })
    expect(pricier.find((p) => p.obligationId === 'kino')).toEqual({ kind: 'pricier', key: 'kino', name: 'Кинопоиск', obligationId: 'kino', amount: 2_990, was: 2_490, monthly: 500 })
    // Платёж стал оценкой, а телефон записал подорожание раньше (несинхронный партнёр) — у семьи его нет.
    const estimated = family()
    estimated.obligations = estimated.obligations!.map((o) => (o.id === 'kino' ? { ...o, estimate: true } : o))
    expect(of(findingsOf(estimated), 'pricier').map((p) => p.obligationId)).toEqual(['ins'])
    expect(of(list, 'double')).toEqual([{ kind: 'double', key: 'sport club', name: 'SPORT CLUB', categoryId: 'sc_fun', amount: 12_000, count: 2, monthly: 12_000 }])
    // Три списания одной суммой — лишних два.
    const triple = family({ reviewFinds: [rf('b', KEY, 'double', 'sport club', { name: 'SPORT CLUB', count: 3, amount: 12_000 })] })
    expect(of(findingsOf(triple), 'double')[0].monthly).toBe(24_000)
  })

  it('порядок: «раздуло» по приросту, затем по цене в месяц; не больше 12; все числа целые', () => {
    const list = findingsOf(family())
    // Утечка 15 750, новое 15 000, двойное 12 000, подорожание 500 и 500 (годовая страховка +6 000 раз в год — 500 в месяц).
    expect(list.map((f) => f.kind)).toEqual(['grew', 'grew', 'leak', 'recurring', 'double', 'pricier', 'pricier'])
    expect(list.slice(2).map((f) => f.monthly)).toEqual([15_750, 15_000, 12_000, 500, 500])
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
    expect(reviewWork(stateOf(doc), ctx, [])).toEqual({ ops: 0, found: 0, monthly: 0 })
    expect(whereRows(stateOf(doc), ctx)).toEqual([])
    expect(reviewOutcome(stateOf(doc), ctx, null)).toBeNull()
  })
})

describe('демо-семья (находки демо — RZ-09)', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-16T06:00:00Z']) {
    it(`${day}: утечка, новое списание и «раздуло» (когда месяц находок текущий), без падений; числа целые`, async () => {
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
      expect(list.map((f) => f.kind).filter((k) => k !== 'grew').sort()).toEqual(['leak', 'recurring'])
      if (findMonth(ctx) === monthKey()) expect(list.some((f) => f.kind === 'grew')).toBe(true)
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
  it('операций за текущий и до 3 месяцев «обычно» всех участников; находок — все; ₸ в месяц — только у советов', () => {
    const doc = family()
    const list = findingsOf(doc)
    const months = [KEY, ...usualMonths(doc.people ?? [], TOTALS, UPLOADS, KEY, 3)]
    expect(months).toEqual([KEY, '2026-09', '2026-08', '2026-07'])
    const ops = TOTALS.filter((t) => months.includes(t.period)).reduce((s, t) => s + t.ops, 0)
    const used = [list[0], of(list, 'leak')[0], of(list, 'leak')[0]]
    // «Раздуло» «Продуктов» — прирост 70 000, утечка — 15 750 в месяц, каждая один раз.
    expect(list[0]).toMatchObject({ kind: 'grew', growth: 70_000 })
    expect(reviewWork(stateOf(doc), ctxOf(doc), list, used)).toEqual({ ops, found: list.length, monthly: 70_000 + 15_750 })
    // Подорожание годовой страховки на 6 000 ₸ раз в год — в счётчик «в месяц» идёт 500, не 6 000 (критик FB-13).
    const ins = of(list, 'pricier').find((p) => p.obligationId === 'ins')!
    expect(reviewWork(stateOf(doc), ctxOf(doc), list, [ins]).monthly).toBe(500)
  })

  it('сохранённый разбор: новый — ₸ в месяц как есть; до «Фидбек» Р-19 — ₸ в год делится на 12 (не переписывается)', () => {
    expect(reviewWorkMonthly({ monthly: 85_750 })).toBe(85_750)
    expect(reviewWorkMonthly({ monthly: 0, yearly: 120_000 })).toBe(0)
    expect(reviewWorkMonthly({ yearly: 259_000 })).toBe(21_583)
    expect(reviewWorkMonthly({})).toBe(0)
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
    // Риски «обычно» и плана — на той же шкале; выше обычного — тем же порогом, что точка «Месяца» (RZ-08).
    expect(rows[0].usualShare).toBeCloseTo(380_000 / 450_000)
    const compare = spendCompare(stateOf(doc), { ...ctxOf(doc), key: findMonth(ctxOf(doc)) }).rows
    for (const r of rows) {
      expect(r.over).toBe(compare.find((c) => c.categoryId === r.categoryId)!.over)
      if (r.plan) expect(r.planShare).toBeCloseTo(r.plan / 450_000)
      else expect(r.planShare).toBeNull()
    }
    expect(integers(rows.map(({ share: _s, usualShare: _u, planShare: _p, ...r }) => r))).toEqual([])
  })

  it('план раздела урезан «Сделать» до нуля — риски плана нет; план есть — риска на своей доле (критик Блока 2)', () => {
    const plan = (categoryId: string, amount: number) => ({ id: `a:${categoryId}`, by: 'a' as const, categoryId, amount, updatedAt: T0 })
    const cut = { id: 's1', period: KEY, by: 'a' as const, from: { spend: 'a' as const, categoryId: 'sc_fun' }, to: { goalId: 'trip' }, amount: 30_000, at: T0, updatedAt: T0 }
    const doc = family({ spendPlans: [plan('sc_fun', 30_000), plan('sc_cafe', 120_000)], planShifts: [cut] })
    const rows = whereRows(stateOf(doc), ctxOf(doc))
    const fun = rows.find((r) => r.categoryId === 'sc_fun')!
    expect(fun.plan).toBe(0)
    expect(fun.planShare).toBeNull()
    expect(rows.find((r) => r.categoryId === 'sc_cafe')!.planShare).toBeCloseTo(120_000 / 450_000)
  })

  it('раздел новый — «обычно» 0: риски «обычно» нет (у левого края читалась сбоем, `/ux` Блока 2)', () => {
    const doc = family({ spendTotals: [...TOTALS, total('a', KEY, 'sc_health', 30_000, 2)] })
    const rows = whereRows(stateOf(doc), ctxOf(doc))
    const fresh = rows.find((r) => r.categoryId === 'sc_health')!
    expect(fresh.usual).toBe(0)
    expect(fresh.usualShare).toBeNull()
    expect(rows.find((r) => r.categoryId === 'sc_food')!.usualShare).toBeCloseTo(380_000 / 450_000)
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
    expect(out.dream).toEqual({ name: 'Подушка', was: 'к маю 2034', now: now ? monthBy(now, KEY) : null, wasMonth: '2034-05', nowMonth: now ?? null })
  })

  // Ревью frontend Н-3: «было» и «стало» — от одного месяца; имя мечты сверяется так, как его отправили.
  it('разбор декабря → итог января: срок «было» — от января (тот же срок — та же строка), ключи месяцев', () => {
    const doc = family()
    const dec = prev({ month: '2026-12', sent: { facts: [{ id: 'f1', about: 'главная мечта «Подушка» — срок', value: 'к июню 2027', raw: '2027-06' }], candidates: [] } })
    const dream = reviewOutcome(stateOf(doc), ctxOf(doc, UPLOADS, '2027-01'), dec)!.dream!
    expect(dream).toMatchObject({ was: monthBy('2027-06', '2027-01'), wasMonth: '2027-06' })
    expect(dream.was).toBe('к июню')
  })

  it('мечта с именем участника и с «» в названии — срок находится по факту, как его отправил buildReviewFacts', () => {
    for (const name of ['Машина Ильяса', 'Отпуск «Море»']) {
      const base = family()
      const main = mainGoal(base.goals ?? [], base.goalOrder, base.moneySettings)!
      const doc = family({ goals: (base.goals ?? []).map((g) => (g.id === main.id ? { ...g, name } : g)) })
      const sent = buildReviewFacts(doc, { state: stateOf(doc), ctx: ctxOf(doc, UPLOADS, '2026-09') }, 'month').payload
      const fact = sent.facts.find((f) => f.about.startsWith('главная мечта'))!
      expect(fact.about, name).not.toContain(name)
      const dream = reviewOutcome(stateOf(doc), ctxOf(doc), prev({ sent }))!.dream
      expect(dream, name).toMatchObject({ name, wasMonth: fact.raw })
    }
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

describe('«Разовая» в разборе (FB-07, Р-16)', () => {
  // Кафе октября 150 000, из них разовая 60 000 (банкет): раздел — 90 000 = обычно, не «раздуло»; «куда ушло» — 90 000.
  const doc = family({
    spendTotals: TOTALS.map((t) => (t.by === 'a' && t.period === KEY && t.categoryId === 'sc_cafe' ? { ...t, oneOff: 60_000 } : t)),
  })
  it('разовая не «раздуло»', () => {
    expect(of(findingsOf(family()), 'grew').some((g) => g.categoryId === 'sc_cafe')).toBe(true)
    expect(of(findingsOf(doc), 'grew').some((g) => g.categoryId === 'sc_cafe')).toBe(false)
  })
  it('«куда ушло» — без разовой', () => {
    expect(whereRows(stateOf(doc), ctxOf(doc)).find((r) => r.categoryId === 'sc_cafe')).toMatchObject({ amount: 90_000, over: false })
  })
})
