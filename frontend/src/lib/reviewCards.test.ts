import { describe, expect, it } from 'vitest'
import {
  derivedCredits,
  dreamShift,
  habitImages,
  monthPlan,
  REVIEW_CARDS_MAX,
  reviewCards,
  reviewFindings,
  reviewWork,
  shiftLabel,
  termSnapOf,
  whereRows,
  whereSplit,
  type MonthPlanCtx,
  type ReviewCard,
  type UploadPeriod,
} from './finance'
import { spendTotals } from './statements/model'
import type { HabitTotal, Operation, ReviewFind, SpendTotal } from './statements/types'
import type { RecurringPrefill } from './statements/firstRun'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Obligation, PersonId, SpendPlan, SyncDoc } from '@/types/finance'

/**
 * Карточки разбора v4 (бэклог «Фидбек», Р-24, FB-15): по семье на каждый вид — карточка, число, кнопка, цель; порядок,
 * лимит, «нет кнопки — нет карточки» и `by` (итоги и находки партнёра мои карточки не трогают).
 *
 * Семья `planFamilyDoc`, октябрь 2026; выписки обоих — с 1 июля по 15 октября (месяц находок — октябрь). Своя база
 * Ильяса (`a`): «Магнум» по вторникам 25 000 с 7 июля по 13 октября — в октябре 50 000, план продуктов 200 000.
 */

const KEY = '2026-10'
const UPLOADS: UploadPeriod[] = [
  { slot: 'a', period_from: '2026-07-01', period_to: '2026-10-15' },
  { slot: 'b', period_from: '2026-07-01', period_to: '2026-10-15' },
]
let n = 0
const op = (merchant: string, amount: number, categoryId: string | null, date: string, extra: Partial<Operation> = {}): Operation => ({
  id: `c${++n}`, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const tuesdays = (() => {
  const out: string[] = []
  for (let t = Date.parse('2026-07-07T00:00:00Z'); t <= Date.parse('2026-10-13T00:00:00Z'); t += 7 * 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
})()
const BASE = tuesdays.map((d) => op('MAGNUM', -25_000, 'sc_food', d))
const plan = (by: PersonId, categoryId: string, amount: number): SpendPlan => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
const rf = (by: PersonId, period: string, kind: ReviewFind['kind'], key: string, rest: Partial<ReviewFind> = {}): ReviewFind => ({
  id: `${by}:${period}:${kind}:${key}`, by, period, kind, name: key.toUpperCase(), categoryId: null, count: 1, amount: 1_000, updatedAt: T0, ...rest,
})
const months = (ops: Operation[]) => [...new Set(ops.map((o) => o.date.slice(0, 7)))]
/** Итоги месяца участника — как пишет стор (`spendTotals` по своим операциям). */
const totalsOf = (by: PersonId, ops: Operation[]): SpendTotal[] => months(ops).flatMap((m) => spendTotals(ops, by, 'month', m, T0, { marked: new Set(), categories: [] }))

type Family = { doc: SyncDoc; ops: Operation[]; ctx: MonthPlanCtx }
function family({ ops = [] as Operation[], partner = [] as Operation[], doc = {} as Partial<SyncDoc>, plans = [plan('a', 'sc_food', 200_000)] } = {}): Family {
  const mine = [...BASE, ...ops]
  const totals = [...totalsOf('a', mine), ...totalsOf('b', partner)]
  const d = planFamilyDoc({ spendPlans: plans, spendTotals: totals, ...doc })
  return { doc: { ...d, credits: derivedCredits(d.credits ?? [], d.payments ?? []) }, ops: mine, ctx: { key: KEY, totals, spendCategories: d.spendCategories ?? [], uploads: UPLOADS } }
}
const PREFILL: RecurringPrefill = { name: 'NETFLIX', amount: 5_000, day: 9, kind: 'subscription' }
const cardsOf = (f: Family, by: PersonId = 'a', recurring: RecurringPrefill | null = PREFILL) =>
  reviewCards({ ...f.doc, book: null }, f.ctx, f.ops, by, { recurringFor: () => recurring })
const kind = (list: ReviewCard[], k: ReviewCard['kind']) => list.filter((c) => c.kind === k)

describe('reviewCards — виды таблицы Р-24', () => {
  it('не разобрано ≥ 10 % факта — первой, в %, «Разобрать» → лист «Не разобрано»; ниже — нет', () => {
    // Факт: 50 000 + 12 000 = 62 000; 12 000 / 62 000 = 19 %.
    const cards = cardsOf(family({ ops: [op('SHOP X', -12_000, null, '2026-10-03'), op('SHOP Y', -1, 'sc_food', '2026-10-03')] }))
    expect(cards[0]).toMatchObject({ kind: 'unknown', title: 'Не разобрано', figure: { value: 19, unit: 'pct' }, button: 'Разобрать', target: { kind: 'unknown' } })
    // 5 000 из 55 000 — 9 %.
    expect(kind(cardsOf(family({ ops: [op('SHOP X', -5_000, null, '2026-10-03')] })), 'unknown')).toEqual([])
  })

  it('переводы людям ≥ 20 % — ₸, имя в строке, «Разобрать» → лист раздела', () => {
    const t = op('Замира Ш.', -30_000, 'sc_people', '2026-10-04', { kind: 'transfer-out', counterparty: 'Замира Ш.' })
    const [c] = kind(cardsOf(family({ ops: [t] })), 'people')
    expect(c).toMatchObject({ title: 'Переводы людям', figure: { value: 30_000, unit: 'money' }, line: 'Больше всех — Замира Ш.', button: 'Разобрать', target: { kind: 'cat', categoryId: 'sc_people' } })
    // 10 000 из 60 000 — 16 %.
    expect(kind(cardsOf(family({ ops: [{ ...t, amount: -10_000 }] })), 'people')).toEqual([])
  })

  it('наличные ≥ 10 % без заметки — «На что?»; все с заметкой — нет кнопки, нет карточки', () => {
    const atm = op('ATM', -10_000, 'sc_cash', '2026-10-04', { kind: 'cash' })
    expect(kind(cardsOf(family({ ops: [atm] })), 'cash')[0]).toMatchObject({ figure: { value: 10_000, unit: 'money' }, button: 'На что?', target: { kind: 'cat', categoryId: 'sc_cash' } })
    expect(kind(cardsOf(family({ ops: [{ ...atm, memo: 'ремонт' }] })), 'cash')).toEqual([])
  })

  it('похоже на разовую — новый продавец, «Отметить разовой» → лист операции; отмеченная — нет', () => {
    const school = op('AVTOSHKOLA', -60_000, 'sc_edu', '2026-10-02')
    expect(kind(cardsOf(family({ ops: [school] })), 'oneoff')[0]).toMatchObject({
      id: `oneoff:${school.id}`, title: 'Похоже на разовую', figure: { value: 60_000, unit: 'money' }, button: 'Отметить разовой', target: { kind: 'op', opId: school.id },
    })
    expect(kind(cardsOf(family({ ops: [{ ...school, oneOff: true }] })), 'oneoff')).toEqual([])
  })

  it('дорогая неделя — % сверху, кнопка — на самую крупную трату недели; она же «разовая» — недели нет', () => {
    // Неделя 5–11 октября: 25 000 + 19 000 = 44 000 при обычных 25 000 → +76 %; самая крупная — «Магнум» (диван дешевле разовой).
    const sofa = op('SULPAK', -19_000, 'sc_home', '2026-10-07')
    const [week] = kind(cardsOf(family({ ops: [sofa] })), 'week')
    expect(week).toMatchObject({ title: 'Дорогая неделя', figure: { value: 76, unit: 'pct' }, target: { kind: 'op' } })
    // Самая крупная трата недели — уже «Похоже на разовую» (новый продавец, 60 000): недели нет, одна покупка — одна карточка.
    const tv = op('TECHNODOM', -60_000, 'sc_home', '2026-10-07')
    const both = cardsOf(family({ ops: [tv] }))
    expect(kind(both, 'oneoff').map((c) => c.target)).toEqual([{ kind: 'op', opId: tv.id }])
    expect(kind(both, 'week')).toEqual([])
  })

  it('не в платежах — регулярное v3 и «В платежи» у своей строки; `recurringFor` null — нет карточки', () => {
    const nf = op('NETFLIX', -5_000, 'sc_subscriptions', '2026-10-09')
    const f = family({ ops: [nf], doc: { reviewFinds: [rf('a', KEY, 'recurring', 'netflix', { name: 'NETFLIX', amount: 5_000, count: 3 })] } })
    expect(kind(cardsOf(f), 'recurring')[0]).toMatchObject({ title: 'Не в платежах', figure: { value: 5_000, unit: 'money' }, button: 'В платежи', target: { kind: 'pay', opId: nf.id } })
    expect(kind(cardsOf(f, 'a', null), 'recurring')).toEqual([])
  })

  it('подорожало — разница, «Обновить сумму» → платёж; дважды — лишнее, «Разобрать» → второе списание', () => {
    const kino: Obligation = { id: 'kino', name: 'Кинопоиск', note: '', day: 5, category: 'd4', versions: [{ from: '2026-01', amount: 2_490 }], updatedAt: T0 }
    const sport = [op('SPORT CLUB', -12_000, 'sc_fun', '2026-10-03'), op('SPORT CLUB', -12_000, 'sc_fun', '2026-10-05')]
    const f = family({
      ops: sport,
      doc: {
        obligations: [...planFamilyDoc().obligations, kino],
        reviewFinds: [
          rf('a', KEY, 'pricier', 'kino', { name: 'KINO', amount: 2_990, was: 2_490, targetId: 'kino' }),
          rf('a', KEY, 'double', 'sport club', { name: 'SPORT CLUB', categoryId: 'sc_fun', count: 2, amount: 12_000 }),
        ],
      },
    })
    const cards = cardsOf(f)
    expect(kind(cards, 'pricier')[0]).toMatchObject({ title: 'Подорожало', figure: { value: 500, unit: 'money' }, button: 'Обновить сумму', target: { kind: 'obligation', obligationId: 'kino' } })
    expect(kind(cards, 'double')[0]).toMatchObject({ title: 'Дважды', figure: { value: 12_000, unit: 'money' }, button: 'Разобрать', target: { kind: 'op', opId: sport[1].id } })
  })

  it('привычка с переносом — «Перенести в мечту»; привычка партнёра — не моя', () => {
    const ht = (by: PersonId, period: string): HabitTotal => ({ id: `${by}:${period}:delivery`, by, period, habit: 'delivery', count: 10, amount: 40_000, updatedAt: T0 })
    const totals = ['2026-07', '2026-08', '2026-09'].map((m) => ht('a', m))
    const [c] = kind(cardsOf(family({ doc: { habitTotals: totals } as Partial<SyncDoc> })), 'habit')
    expect(c).toMatchObject({ title: 'Доставка', figure: { value: 40_000, unit: 'money' }, button: 'Перенести в мечту', target: { kind: 'image' } })
    const partner = ['2026-07', '2026-08', '2026-09'].map((m) => ht('b', m))
    expect(kind(cardsOf(family({ doc: { habitTotals: partner } as Partial<SyncDoc> })), 'habit')).toEqual([])
  })

  it('мелочь ≥ 10 % — «Сделать» из своего плана; без кандидата `move` — нет карточки', () => {
    const coffee = Array.from({ length: 8 }, (_, i) => op('KOFE', -1_500, 'sc_cafe', `2026-10-0${i + 1}`))
    const plans = [plan('a', 'sc_food', 200_000), plan('a', 'sc_cafe', 20_000)]
    const [c] = kind(cardsOf(family({ ops: coffee, plans })), 'small')
    expect(c).toMatchObject({ title: 'Мелочь', figure: { value: 12_000, unit: 'money' }, button: 'Сделать', target: { kind: 'do' } })
    expect(c.target.kind === 'do' && c.target.candidate.kind).toBe('move')
    // План продуктов есть только у партнёра — урезать свой план нечего.
    expect(kind(cardsOf(family({ ops: coffee, plans: [plan('b', 'sc_food', 400_000), plan('a', 'sc_cafe', 20_000)] })), 'small')).toEqual([])
  })

  it('поставить план: выше плана второй месяц подряд — факт − план; плана нет и факт ≥ 10 % — факт; сумма — «обычно»', () => {
    const cafe = ['2026-08-12', '2026-09-12', '2026-10-02'].map((d) => op('KAFE', -20_000, 'sc_cafe', d))
    const twice = kind(cardsOf(family({ ops: cafe, plans: [plan('a', 'sc_food', 200_000), plan('a', 'sc_cafe', 10_000)] })), 'plan')
    expect(twice[0]).toMatchObject({ title: 'Кафе и рестораны', figure: { value: 10_000 }, line: 'Выше плана', button: 'Поставить план', target: { kind: 'plan', categoryId: 'sc_cafe' } })
    const none = kind(cardsOf(family({ ops: cafe })), 'plan')
    // «Обычно» кафе — среднее июля…сентября: (0 + 20 000 + 20 000) / 3 = 13 333.
    expect(none[0]).toMatchObject({ figure: { value: 20_000 }, line: 'Плана нет', target: { kind: 'plan', categoryId: 'sc_cafe', amount: 13_333 } })
    // Выше плана только в октябре — не второй месяц.
    const once = [op('KAFE', -20_000, 'sc_cafe', '2026-10-02')]
    expect(kind(cardsOf(family({ ops: once, plans: [plan('a', 'sc_food', 200_000), plan('a', 'sc_cafe', 10_000)] })), 'plan')).toEqual([])
  })

  it('поставить план: «обычно» не выше плана — сумма кнопки — факт, план не понижается (критик 4б)', () => {
    // План 15 000; кафе 20 000 в августе, сентябре, октябре — выше плана второй месяц; «обычно» 13 333 < плана.
    const cafe = ['2026-08-12', '2026-09-12', '2026-10-02'].map((d) => op('KAFE', -20_000, 'sc_cafe', d))
    const [c] = kind(cardsOf(family({ ops: cafe, plans: [plan('a', 'sc_food', 200_000), plan('a', 'sc_cafe', 15_000)] })), 'plan')
    expect(c).toMatchObject({ figure: { value: 5_000 }, target: { kind: 'plan', categoryId: 'sc_cafe', amount: 20_000 } })
  })
})

describe('reviewCards — месяц находок по своим выпискам (критик 4б)', () => {
  it('выписка партнёра покрывает октябрь, моя — по 30 сентября: мои карточки — за сентябрь, не пусто', () => {
    const f = family({ ops: [op('SHOP X', -30_000, null, '2026-09-03')] })
    const uploads: UploadPeriod[] = [
      { slot: 'a', period_from: '2026-07-01', period_to: '2026-09-30' },
      { slot: 'b', period_from: '2026-07-01', period_to: '2026-10-15' },
    ]
    const cards = reviewCards({ ...f.doc, book: null }, { ...f.ctx, uploads }, f.ops, 'a')
    expect(cards[0]).toMatchObject({ kind: 'unknown', line: '1 трата без раздела' })
    expect(whereSplit({ ...f.doc, book: null }, { ...f.ctx, uploads }, 'a')!.month).toBe('2026-09')
  })
})

describe('reviewCards — порядок, лимит, `by`', () => {
  const CROWD = [
    op('SHOP X', -40_000, null, '2026-10-03'),
    op('Замира Ш.', -90_000, 'sc_people', '2026-10-04', { kind: 'transfer-out', counterparty: 'Замира Ш.' }),
    op('ATM', -40_000, 'sc_cash', '2026-10-04', { kind: 'cash' }),
    op('AVTOSHKOLA', -60_000, 'sc_edu', '2026-10-02'),
    op('DIVAN', -50_000, 'sc_home', '2026-10-01'),
    op('SULPAK', -15_000, 'sc_tech', '2026-10-07'),
  ]

  it('«Не разобрано» — первой, остальные по ₸ в месяц; не больше 6; все числа целые', () => {
    const cards = cardsOf(family({ ops: CROWD }))
    expect(cards).toHaveLength(REVIEW_CARDS_MAX)
    expect(cards[0].kind).toBe('unknown')
    const rest = cards.slice(1).map((c) => c.monthly)
    expect(rest).toEqual([...rest].sort((a, b) => b - a))
    expect(cards.every((c) => Number.isInteger(c.figure.value) && Number.isInteger(c.monthly))).toBe(true)
  })

  it('итоги и находки партнёра в документе мои карточки не трогают; у партнёра — свои', () => {
    const partner = [op('BIG', -900_000, null, '2026-10-03'), op('Дана К.', -500_000, 'sc_people', '2026-10-04', { kind: 'transfer-out', counterparty: 'Дана К.' })]
    const alone = cardsOf(family({ ops: CROWD }))
    const f = family({ ops: CROWD, partner, doc: { reviewFinds: [rf('b', KEY, 'pricier', 'kino', { amount: 2_990, was: 2_490, targetId: 'kino' })] } })
    expect(cardsOf(f)).toEqual(alone)
    // У партнёра нет своих операций на телефоне — карточек по операциям нет; факт его — свой.
    expect(cardsOf(f, 'b').some((c) => c.kind === 'people')).toBe(false)
  })

  it('факта нет (выписок месяца нет) — карточек нет', () => {
    const f = family({ ops: CROWD })
    expect(reviewCards({ ...f.doc, book: null }, { ...f.ctx, uploads: [] }, f.ops, 'a')).toEqual([])
  })
})

describe('whereSplit — «Куда ушло» на всю сумму', () => {
  it('Σ четырёх частей = факт участника (с разовыми и «не разобрано»); у партнёра — его суммы', () => {
    const ops = [
      op('SHOP X', -12_000, null, '2026-10-03'),
      op('DIVAN', -50_000, 'sc_home', '2026-10-01', { oneOff: true }),
      op('Замира Ш.', -30_000, 'sc_people', '2026-10-04', { kind: 'transfer-out', counterparty: 'Замира Ш.' }),
      op('ATM', -10_000, 'sc_cash', '2026-10-04', { kind: 'cash' }),
      op('NETFLIX', -5_000, 'sc_subscriptions', '2026-10-09'),
    ]
    const partner = [op('MAGNUM', -70_000, 'sc_food', '2026-10-05'), op('ATM', -9_000, 'sc_cash', '2026-10-05', { kind: 'cash' })]
    const f = family({ ops, partner })
    const state = { ...f.doc, book: null }
    const split = whereSplit(state, f.ctx, 'a')!
    const fact = monthPlan(state, f.ctx).spend.find((s) => s.by === 'a')!.fact
    expect(split.parts.reduce((s, p) => s + p.amount, 0)).toBe(fact)
    expect(split.total).toBe(fact)
    expect(Object.fromEntries(split.parts.map((p) => [p.key, p.amount]))).toEqual({ sellers: 112_000, people: 30_000, cash: 10_000, payments: 5_000 })
    const b = whereSplit(state, f.ctx, 'b')!
    expect(b.parts.find((p) => p.key === 'cash')!.amount).toBe(9_000)
    expect(b.total).toBe(monthPlan(state, f.ctx).spend.find((s) => s.by === 'b')!.fact)
    expect(whereSplit(state, { ...f.ctx, uploads: [] }, 'a')).toBeNull()
  })
})

describe('`by` у разбора v3 — свои находки, без `by` — как было', () => {
  const finds = [
    rf('a', KEY, 'recurring', 'netflix', { name: 'NETFLIX', amount: 5_000, count: 3 }),
    rf('b', KEY, 'double', 'sport club', { name: 'SPORT CLUB', count: 2, amount: 12_000 }),
  ]
  const f = family({ partner: [op('MAGNUM', -70_000, 'sc_food', '2026-10-05')], doc: { reviewFinds: finds } })
  const state = { ...f.doc, book: null }

  it('reviewFindings / reviewWork: с `by` — только свои; без — семья', () => {
    expect(reviewFindings(state, f.ctx).map((x) => x.kind).sort()).toEqual(['double', 'recurring'])
    expect(reviewFindings(state, f.ctx, 'a').map((x) => x.kind)).toEqual(['recurring'])
    expect(reviewFindings(state, f.ctx, 'b').map((x) => x.kind)).toEqual(['double'])
    const all = reviewWork(state, f.ctx, reviewFindings(state, f.ctx))
    const mine = reviewWork(state, f.ctx, reviewFindings(state, f.ctx, 'a'), undefined, 'a')
    // Операции: у Ильяса — 15 вторников (с июля по октябрь), у Аруны — одна.
    expect(all.ops).toBe(mine.ops + 1)
    expect(mine).toEqual({ ops: 15, found: 1, monthly: 5_000 })
  })

  it('whereRows и habitImages: с `by` — разделы и привычки участника', () => {
    expect(whereRows(state, f.ctx).find((r) => r.categoryId === 'sc_food')!.amount).toBe(120_000)
    expect(whereRows(state, f.ctx, 5, 'a').find((r) => r.categoryId === 'sc_food')!.amount).toBe(50_000)
    const ht = (by: PersonId, period: string): HabitTotal => ({ id: `${by}:${period}:taxi`, by, period, habit: 'taxi', count: 10, amount: 30_000, updatedAt: T0 })
    const habits = { ...state, habitTotals: ['2026-07', '2026-08', '2026-09'].map((m) => ht('b', m)) }
    expect(habitImages(habits, KEY)).toHaveLength(1)
    expect(habitImages(habits, KEY, 'a')).toEqual([])
    expect(habitImages(habits, KEY, 'b')).toEqual(habitImages(habits, KEY))
  })
})

describe('Х-8 (Р-29) — «мечта сдвинулась» без чужого раздела', () => {
  // Как `dreamShift.test.ts`: кафе выше плана на 30 000 → машина +15 дней. Раздел выше плана — у того, чей план и факт.
  const PLANS = [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 300_000)]
  const total = (by: PersonId, categoryId: string, amount: number): SpendTotal => ({ id: `${by}:month:${KEY}:${categoryId}`, by, kind: 'month', period: KEY, categoryId, amount, ops: 1, updatedAt: T0 })
  const doc = planFamilyDoc({ spendPlans: PLANS })
  const empty: MonthPlanCtx = { key: KEY, totals: [], spendCategories: [], uploads: [] }
  const snap = { ...termSnapOf(monthPlan(doc, empty), '2026-10-01T03:00:00.000Z'), updatedAt: T0 }
  const ctx: MonthPlanCtx = { ...empty, totals: [total('a', 'sc_food', 400_000), total('a', 'sc_cafe', 77_000)], uploads: [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-15' }] }

  it('раздел выше плана у меня — имя; только у партнёра — «траты выше плана»; без `by` — как было', () => {
    expect(dreamShift(doc, ctx, snap, 'car', 'a')).toEqual({ days: 15, reason: 'spend', name: 'Кафе и рестораны' })
    const partner = dreamShift(doc, ctx, snap, 'car', 'b')!
    expect(partner).toEqual({ days: 15, reason: 'spend' })
    expect(shiftLabel(partner)).toBe('+2 недели · траты выше плана')
    expect(dreamShift(doc, ctx, snap, 'car')).toEqual({ days: 15, reason: 'spend', name: 'Кафе и рестораны' })
  })
})
