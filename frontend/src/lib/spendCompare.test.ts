import { describe, expect, it } from 'vitest'
import { OVER_MIN, earlierLabel, monthCovered, monthPlan, participantLines, spendCompare, spendFact, stepCandidates, usualMonths, usualSpend, type MonthPlanCtx, type UploadPeriod } from './finance'
import { RK_GROUP_BY_CATEGORY } from './statements/dictionary'
import type { SpendTotal } from './statements/types'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { PersonId, SpendPlan, SyncDoc } from '@/types/finance'

/**
 * AU-01: траты в сравнении против ручного расчёта (правило 6 — числа в комментариях).
 *
 * Семья `planFamilyDoc`: Ильяс (a) 700 000, Аруна (b) 500 000 → доход октября 1 200 000. Главная мечта — первая цель
 * очереди «Подушка»: нужно 3 000 000, есть 400 000 (остаток 2 600 000), взнос 30 000.
 * Выписки: июль–сентябрь у обоих целиком (у b — две загрузки встык), октябрь — у a с 1-го по 15-е, у b нет.
 *   Продукты: июль 80 000 + 40 000, август 100 000 + 50 000, сентябрь 90 000 + 60 000 → обычно (120 + 150 + 150) / 3 =
 *     140 000; октябрь 100 000; план 90 000 + 60 000 = 150 000 → точки нет, рекомендации нет (обычно ≤ плана).
 *   Кафе: июль 40 000, август 50 000, сентябрь — 0 → обычно 30 000; октябрь 60 000 → точка (выше на 30 000 и на 100 %);
 *     план 20 000 → «до плана: +10 000»; дни: (2 600 000 / 30 000 − 2 600 000 / 40 000) × 30,4 = (86,67 − 65) × 30,4 =
 *     658,7 → 659.
 *   Транспорт: только план b 25 000 — факт 0 (выписки месяца есть), обычно 0.
 *   Коммуналка 25 000 (раздел платежей) и «не разобрано» 5 000 — не в строках.
 * % дохода: продукты 100 000 / 1 200 000 = 8,3 → 8; кафе 60 000 → 5.
 */

const KEY = '2026-10'
const total = (by: PersonId, period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops: 1, updatedAt: T0,
})
const plan = (by: PersonId, categoryId: string, amount: number): SpendPlan => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })

const UPLOADS: UploadPeriod[] = [
  { slot: 'a', period_from: '2026-07-01', period_to: '2026-09-30' },
  { slot: 'b', period_from: '2026-07-01', period_to: '2026-08-15' },
  { slot: 'b', period_from: '2026-08-16', period_to: '2026-09-30' },
  { slot: 'a', period_from: '2026-10-01', period_to: '2026-10-15' },
]
const TOTALS: SpendTotal[] = [
  total('a', '2026-07', 'sc_food', 80_000), total('b', '2026-07', 'sc_food', 40_000), total('a', '2026-07', 'sc_cafe', 40_000),
  total('a', '2026-08', 'sc_food', 100_000), total('b', '2026-08', 'sc_food', 50_000), total('a', '2026-08', 'sc_cafe', 50_000),
  total('a', '2026-09', 'sc_food', 90_000), total('b', '2026-09', 'sc_food', 60_000),
  total('a', KEY, 'sc_food', 100_000), total('a', KEY, 'sc_cafe', 60_000), total('a', KEY, 'sc_utilities', 25_000),
  total('a', KEY, '_unknown', 5_000),
]
const PLANS = [plan('a', 'sc_food', 90_000), plan('b', 'sc_food', 60_000), plan('a', 'sc_cafe', 20_000), plan('b', 'sc_transport', 25_000), plan('a', 'sc_utilities', 30_000)]

const family = (extra: Partial<SyncDoc> = {}) => planFamilyDoc({ spendPlans: PLANS, ...extra })
const ctxOf = (extra: Partial<MonthPlanCtx> = {}): MonthPlanCtx => ({ key: KEY, totals: TOTALS, spendCategories: [], uploads: UPLOADS, ...extra })
const row = (r: ReturnType<typeof spendCompare>, id: string) => r.rows.find((x) => x.categoryId === id)

describe('monthCovered — выписки покрывают месяц целиком', () => {
  it('с 1-го по последний день — да', () => {
    expect(monthCovered('2026-09', [{ slot: 'a', period_from: '2026-09-01', period_to: '2026-09-30' }], 'a')).toBe(true)
  })
  it('две загрузки встык — да; внахлёст и шире месяца — да', () => {
    expect(monthCovered('2026-08', UPLOADS, 'b')).toBe(true)
    expect(monthCovered('2026-02', [
      { slot: 'a', period_from: '2026-01-20', period_to: '2026-02-10' },
      { slot: 'a', period_from: '2026-02-05', period_to: '2026-03-03' },
    ], 'a')).toBe(true)
  })
  it('дыра в один день — нет; конец месяца не покрыт — нет', () => {
    expect(monthCovered('2026-08', [
      { slot: 'a', period_from: '2026-08-01', period_to: '2026-08-14' },
      { slot: 'a', period_from: '2026-08-16', period_to: '2026-08-31' },
    ], 'a')).toBe(false)
    expect(monthCovered('2026-10', UPLOADS, 'a')).toBe(false)
  })
  it('у участника нет выписок — нет (чужие не считаются)', () => {
    expect(monthCovered('2026-08', UPLOADS, 'c')).toBe(false)
  })
})

describe('usualMonths — полные месяцы до текущего', () => {
  const people = planFamilyDoc().people
  it('ровно 3 последних, новые первыми', () => {
    expect(usualMonths(people, TOTALS, UPLOADS, KEY)).toEqual(['2026-09', '2026-08', '2026-07'])
  })
  it('пропускает месяц, где у участника с итогами выписка неполная', () => {
    const late = [{ slot: 'a', period_from: '2026-07-20', period_to: '2026-09-30' }, ...UPLOADS.filter((u) => u.slot === 'b')]
    expect(usualMonths(people, TOTALS, late, KEY)).toEqual(['2026-09', '2026-08'])
  })
  it('участник без итогов месяца не мешает; не дальше 6 месяцев назад', () => {
    const totals = ['2026-03', '2026-04', '2026-05'].map((m) => total('a', m, 'sc_food', 50_000))
    const uploads = [{ slot: 'a', period_from: '2026-03-01', period_to: '2026-05-31' }]
    expect(usualMonths(people, totals, uploads, KEY)).toEqual(['2026-05', '2026-04'])
  })
})

describe('usualSpend — «обычно у вас»', () => {
  const people = planFamilyDoc().people
  it('среднее за 3 месяца, месяц без трат раздела — 0', () => {
    const u = usualSpend(people, TOTALS, [], UPLOADS, KEY)!
    expect(u.months).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(u.amounts.get('sc_food')).toBe(140_000)
    expect(u.amounts.get('sc_cafe')).toBe(30_000)
  })
  it('один полный месяц — null; два — среднее двух', () => {
    const one = [{ slot: 'a', period_from: '2026-09-01', period_to: '2026-09-30' }, { slot: 'b', period_from: '2026-09-01', period_to: '2026-09-30' }]
    expect(usualSpend(people, TOTALS, [], one, KEY)).toBeNull()
    const two = one.map((u) => ({ ...u, period_from: '2026-08-01' }))
    // Продукты: (150 000 + 150 000) / 2; кафе: (0 + 50 000) / 2.
    const u = usualSpend(people, TOTALS, [], two, KEY)!
    expect(u.amounts.get('sc_food')).toBe(150_000)
    expect(u.amounts.get('sc_cafe')).toBe(25_000)
  })
  it('удалённый итог и удалённый участник не считаются (критик)', () => {
    // b удалена: месяцы держатся на a — продукты (80 + 100 + 90) / 3 = 90 000; удалённый итог кафе a в сентябре — мимо.
    const people = planFamilyDoc().people.map((p) => (p.id === 'b' ? { ...p, deletedAt: T0 } : p))
    const totals = [...TOTALS, { ...total('a', '2026-09', 'sc_cafe', 90_000), id: 'x', deletedAt: T0 }]
    const u = usualSpend(people, totals, [], UPLOADS.filter((x) => x.slot === 'a'), KEY)!
    expect(u.months).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(u.amounts.get('sc_food')).toBe(90_000)
    expect(u.amounts.get('sc_cafe')).toBe(30_000)
  })
})

describe('spendCompare — строки разделов семьи', () => {
  const r = spendCompare(family(), ctxOf())

  it('доход, месяцы «обычно», порядок; без платежей и «не разобрано»', () => {
    expect(r.income).toBe(1_200_000)
    expect(r.usualFrom).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(r.rows.map((x) => x.categoryId)).toEqual(['sc_food', 'sc_cafe', 'sc_transport'])
  })
  it('продукты: факт, план участников, обычно, % дохода, без точки и рекомендации', () => {
    expect(row(r, 'sc_food')).toEqual({
      categoryId: 'sc_food', name: 'Продукты', amount: 100_000, plan: 150_000, usual: 140_000, share: 8, over: false, advice: null, group: 'food',
    })
  })
  it('кафе: точка и «до плана» в главную мечту с днями ручного расчёта', () => {
    const cafe = row(r, 'sc_cafe')!
    expect(cafe).toMatchObject({ amount: 60_000, plan: 20_000, usual: 30_000, share: 5, over: true, group: 'services' })
    expect(cafe.advice).toEqual({ amount: 10_000, goalId: 'cushion', goalName: 'Подушка', days: 659 })
  })
  it('раздел только с планом: факт 0 при выписках месяца, null без выписок', () => {
    expect(row(r, 'sc_transport')).toMatchObject({ amount: 0, plan: 25_000, usual: 0, over: false, advice: null })
    const none = spendCompare(family(), ctxOf({ uploads: UPLOADS.filter((u) => u.period_from < KEY) }))
    expect(none.rows.map((x) => [x.categoryId, x.amount, x.share, x.over])).toEqual([
      ['sc_food', null, null, false], ['sc_transport', null, null, false], ['sc_cafe', null, null, false],
    ])
  })
  it('без плана — рекомендации нет; без мечты — «до плана» без дней', () => {
    const noPlan = spendCompare(family({ spendPlans: PLANS.filter((p) => p.categoryId !== 'sc_cafe') }), ctxOf())
    expect(row(noPlan, 'sc_cafe')).toMatchObject({ plan: null, over: true, advice: null })
    const noGoal = spendCompare(family({ goals: [] }), ctxOf())
    expect(row(noGoal, 'sc_cafe')!.advice).toEqual({ amount: 10_000, goalId: null, goalName: null, days: null })
  })
  it('свой раздел семьи — без группы РК', () => {
    const own = spendCompare(family({ spendPlans: [...PLANS, plan('a', 'my_dog', 15_000)] }), ctxOf())
    expect(row(own, 'my_dog')).toMatchObject({ name: 'Прочее', plan: 15_000, group: null })
  })
})

describe('spendCompare — порог точки и текущий месяц', () => {
  // Два полных месяца с одной суммой — обычно = эта сумма; октябрь — выписка с 1-го по 5-е (месяц только начался).
  const at = (usual: number, now: number) => {
    const totals = [total('a', '2026-08', 'sc_cafe', usual), total('a', '2026-09', 'sc_cafe', usual), total('a', KEY, 'sc_cafe', now)]
    const uploads = [{ slot: 'a', period_from: '2026-08-01', period_to: '2026-09-30' }, { slot: 'a', period_from: '2026-10-01', period_to: '2026-10-05' }]
    return row(spendCompare(family({ spendPlans: [] }), ctxOf({ totals, uploads })), 'sc_cafe')!.over
  }
  it('выше на 5 000: ровно порог — нет, на тенге больше — да', () => {
    expect(OVER_MIN).toBe(5_000)
    expect(at(30_000, 35_000)).toBe(false)
    expect(at(30_000, 35_001)).toBe(true)
  })
  it('выше на 10 %: ровно порог — нет, на тенге больше — да', () => {
    expect(at(100_000, 110_000)).toBe(false)
    expect(at(100_000, 110_001)).toBe(true)
  })
  it('текущий месяц — сумма за весь месяц, без пропорции дней', () => {
    // 20 000 за 5 дней: пропорция дала бы 124 000 за месяц (точку), но сравнивается сама сумма 20 000 < обычных 30 000.
    expect(at(30_000, 20_000)).toBe(false)
  })
  it('«обычно» 0 (новый раздел) — без точки (Х-3)', () => {
    expect(at(0, 50_000)).toBe(false)
  })
})

describe('spendCompare — «не разобрано» и переводы в конце (Х-1, Х-3)', () => {
  it('«не разобрано» и «Платежи без отметки» — отдельными полями: строки + они + разовые = потрачено месяца (Х-6)', () => {
    // Коммуналка 25 000: 18 000 отмечено платежом (уже в платежах месяца), 7 000 без отметки (`unmarked`) — трата.
    const totals = TOTALS.map((t) => (t.period === KEY && t.categoryId === 'sc_utilities' ? { ...t, unmarked: 7_000 } : t))
    const r = spendCompare(family(), ctxOf({ totals }))
    expect(r.unknown).toBe(5_000)
    expect(r.unmarkedPayments).toBe(7_000)
    // 100 000 + 60 000 + 0 (строки) + 5 000 (не разобрано) + 0 (разовые) + 7 000 (платежи без отметки) = 172 000 = потрачено.
    const rows = r.rows.reduce((s, x) => s + (x.amount ?? 0), 0)
    expect(rows + r.unknown + r.oneOff + r.unmarkedPayments).toBe(172_000)
    expect(spendFact(monthPlan(family(), ctxOf({ totals })).spend)).toBe(172_000)
    // Коммуналка отмечена целиком — в сумму не входит: строки сходятся с потрачено без неё.
    const paid = spendCompare(family(), ctxOf())
    expect(paid.unmarkedPayments).toBe(0)
    expect(paid.rows.reduce((s, x) => s + (x.amount ?? 0), 0) + paid.unknown + paid.oneOff).toBe(spendFact(monthPlan(family(), ctxOf()).spend))
    // Без разделов платежей — 0; выписок месяца нет — 0.
    expect(spendCompare(family(), ctxOf({ totals: TOTALS.filter((t) => t.categoryId !== 'sc_utilities') })).unmarkedPayments).toBe(0)
    const none = spendCompare(family(), ctxOf({ totals, uploads: UPLOADS.filter((u) => u.period_from < KEY) }))
    expect([none.unknown, none.unmarkedPayments]).toEqual([0, 0])
  })
  it('переводы людям и наличные — последними и без точки, даже крупнейшие и выше обычного', () => {
    // Переводы: обычно 10 000, октябрь 500 000 — по сумме первые и выше порога, но идут после трат и точки не дают.
    const totals = [
      ...TOTALS,
      total('a', '2026-08', 'sc_people', 10_000), total('a', '2026-09', 'sc_people', 10_000), total('a', KEY, 'sc_people', 500_000),
      total('a', KEY, 'sc_cash', 200_000),
    ]
    const r = spendCompare(family(), ctxOf({ totals }))
    expect(r.rows.map((x) => x.categoryId)).toEqual(['sc_food', 'sc_cafe', 'sc_transport', 'sc_people', 'sc_cash'])
    expect(row(r, 'sc_people')).toMatchObject({ amount: 500_000, over: false })
    expect(row(r, 'sc_cash')!.over).toBe(false)
  })
})

describe('группы разделов РК (строка «в Алматы» снята — FG-25)', () => {
  it('группы — 3 (поле `group` строки раздела)', () => {
    expect(new Set(Object.values(RK_GROUP_BY_CATEGORY))).toEqual(new Set(['food', 'goods', 'services']))
  })
})

describe('earlierLabel', () => {
  it('дни, недели, месяцы', () => {
    expect(earlierLabel(5)).toBe('5 дней')
    expect(earlierLabel(13)).toBe('13 дней')
    expect(earlierLabel(14)).toBe('2 недели')
    expect(earlierLabel(60)).toBe('9 недель')
    expect(earlierLabel(61)).toBe('2 месяца')
    expect(earlierLabel(659)).toBe('22 месяца')
  })
})

/**
 * FB-07 (Р-5, Р-16): «Разовая» — в факте месяца, но не в строке раздела, «обычно», точке, совете и доле РК.
 * Октябрь a: «Образование» 300 000 целиком разовая; «Продукты» 130 000, из них разовая 30 000 → строка 100 000, как без
 * разовых. Сентябрь a: «Продукты» 390 000, из них разовая 300 000 → обычно по-прежнему (120 + 150 + 150) / 3 = 140 000.
 * Факт a: было F, стало F + 300 000 + 30 000; «Разовые» = 330 000; строки + «не разобрано» + «Разовые» = факт.
 */
describe('spendCompare — разовые (FB-07)', () => {
  const oneOff = (t: SpendTotal, amount: number, part: number): SpendTotal => ({ ...t, amount, oneOff: part })
  const WITH: SpendTotal[] = TOTALS.map((t) =>
    t.by === 'a' && t.categoryId === 'sc_food' && t.period === KEY
      ? oneOff(t, 130_000, 30_000)
      : t.by === 'a' && t.categoryId === 'sc_food' && t.period === '2026-09'
        ? oneOff(t, 390_000, 300_000)
        : t,
  ).concat([{ ...total('a', KEY, 'sc_education', 300_000), oneOff: 300_000 }])

  it('строки разделов без разовых, «Разовые» отдельно', () => {
    const r = spendCompare(family(), ctxOf({ totals: WITH }))
    expect(row(r, 'sc_food')?.amount).toBe(100_000)
    expect(row(r, 'sc_education')).toBeUndefined()
    expect(r.oneOff).toBe(330_000)
    expect(spendCompare(family(), ctxOf()).oneOff).toBe(0)
  })
  it('«обычно», точка и совет — как без разовых', () => {
    const before = spendCompare(family(), ctxOf())
    const after = spendCompare(family(), ctxOf({ totals: WITH }))
    expect(row(after, 'sc_food')?.usual).toBe(140_000)
    expect(after.rows).toEqual(before.rows)
  })
  it('«обычно» следующего месяца без разовой', () => {
    const next = usualSpend(planFamilyDoc().people, WITH, [], [...UPLOADS, { slot: 'a', period_from: '2026-10-01', period_to: '2026-10-31' }], '2026-11')
    // Октябрь: продукты 100 000 (без 30 000), образования нет; сентябрь 150 000; август 150 000 → 400 000 / 3.
    expect(next?.amounts.get('sc_food')).toBe(133_333)
    expect(next?.amounts.has('sc_education')).toBe(false)
  })
  it('факт месяца — с разовыми; строки + «не разобрано» + «Разовые» = факт', () => {
    const before = monthPlan(family(), ctxOf()).spend.find((s) => s.by === 'a')!.fact!
    const plan = monthPlan(family(), ctxOf({ totals: WITH }))
    expect(plan.spend.find((s) => s.by === 'a')!.fact).toBe(before + 330_000)
    const r = spendCompare(family(), ctxOf({ totals: WITH }))
    expect(r.rows.reduce((s, x) => s + (x.amount ?? 0), 0) + r.unknown + r.oneOff).toBe(spendFact(plan.spend))
  })
  it('строка плана раздела — без разовых', () => {
    const rows = monthPlan(family(), ctxOf({ totals: WITH })).spend.find((s) => s.by === 'a')!.rows
    expect(rows.find((x) => x.categoryId === 'sc_food')?.fact).toBe(100_000)
  })
  it('план не сдвигается: совет и шаги — те же', () => {
    const steps = stepCandidates(family(), ctxOf())
    expect(steps.some((s) => s.kind === 'move')).toBe(true)
    expect(stepCandidates(family(), ctxOf({ totals: WITH }))).toEqual(steps)
  })
})

/**
 * FB-11 (Р-7, Р-18): расчёты «Трат» по одному участнику.
 * Октябрь, кроме TOTALS: у b выписка 1–10 октября — продукты 40 000, «не разобрано» 7 000, «Образование» 50 000 целиком
 * разовая. Июнь: у b полная выписка и продукты 70 000, у a в июне ничего нет.
 *   a: продукты 100 000 (план 90 000, обычно (80 + 100 + 90) / 3 = 90 000), кафе 60 000 (план 20 000, обычно
 *      (40 + 50 + 0) / 3 = 30 000); «не разобрано» 5 000, разовых 0; транспорта (план b) нет.
 *   b: продукты 40 000 (план 60 000, обычно (40 + 50 + 60) / 3 = 50 000), транспорт 0 (план 25 000); «не разобрано»
 *      7 000, «Разовые» 50 000; кафе a нет.
 *   Семья: продукты 140 000, «не разобрано» 12 000, «Разовые» 50 000.
 *   РК, продукты: a 100 / 185 = 54; b 40 / 40 = 100 (разовая долю не размывает); семья 140 / 225 = 62,2 → 62.
 */
describe('spendCompare по участнику (FB-11)', () => {
  const BOTH: SpendTotal[] = [
    ...TOTALS,
    total('b', KEY, 'sc_food', 40_000), total('b', KEY, '_unknown', 7_000),
    { ...total('b', KEY, 'sc_education', 50_000), oneOff: 50_000 },
    total('b', '2026-06', 'sc_food', 70_000),
  ]
  const UP: UploadPeriod[] = [...UPLOADS, { slot: 'b', period_from: '2026-10-01', period_to: '2026-10-10' }, { slot: 'b', period_from: '2026-06-01', period_to: '2026-06-30' }]
  const ctx = ctxOf({ totals: BOTH, uploads: UP })
  const people = planFamilyDoc().people

  it('usualMonths: месяц, полный только у партнёра, не в счёт', () => {
    expect(usualMonths(people, BOTH, UP, KEY, 4)).toEqual(['2026-09', '2026-08', '2026-07', '2026-06'])
    expect(usualMonths(people, BOTH, UP, KEY, 4, 'a')).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(usualMonths(people, BOTH, UP, KEY, 4, 'b')).toEqual(['2026-09', '2026-08', '2026-07', '2026-06'])
    // Выписка a с 20 июля: у семьи июль неполный, у b — полный.
    const late = [{ slot: 'a', period_from: '2026-07-20', period_to: '2026-09-30' }, ...UPLOADS.filter((u) => u.slot === 'b')]
    expect(usualMonths(people, TOTALS, late, KEY)).toEqual(['2026-09', '2026-08'])
    expect(usualMonths(people, TOTALS, late, KEY, 3, 'b')).toEqual(['2026-09', '2026-08', '2026-07'])
  })
  it('a: только свои разделы, свой план, своё «обычно», свои «не разобрано» и разовые', () => {
    const r = spendCompare(family(), ctx, 'a')
    expect(r.rows.map((x) => [x.categoryId, x.amount, x.plan, x.usual])).toEqual([
      ['sc_food', 100_000, 90_000, 90_000],
      ['sc_cafe', 60_000, 20_000, 30_000],
    ])
    expect([r.unknown, r.oneOff]).toEqual([5_000, 0])
    expect(r.income).toBe(1_200_000)
  })
  it('b: только свои разделы — кафе a нет', () => {
    const r = spendCompare(family(), ctx, 'b')
    expect(r.rows.map((x) => [x.categoryId, x.amount, x.plan, x.usual])).toEqual([
      ['sc_food', 40_000, 60_000, 50_000],
      ['sc_transport', 0, 25_000, 0],
    ])
    expect([r.unknown, r.oneOff]).toEqual([7_000, 50_000])
  })
  it('без `by` — семья, как было', () => {
    const r = spendCompare(family(), ctx)
    expect(row(r, 'sc_food')?.amount).toBe(140_000)
    expect(row(r, 'sc_food')?.plan).toBe(150_000)
    expect([r.unknown, r.oneOff]).toEqual([12_000, 50_000])
  })
  it('строки + «не разобрано» + «Разовые» участника = его факт', () => {
    const plan = monthPlan(family(), ctx)
    for (const by of ['a', 'b'] as const) {
      const r = spendCompare(family(), ctx, by)
      expect(r.rows.reduce((s, x) => s + (x.amount ?? 0), 0) + r.unknown + r.oneOff).toBe(plan.spend.find((s) => s.by === by)!.fact)
    }
    // Критик Блока 3: «потрачено» семьи в заголовке = Σ фактов строк участников.
    const lines = participantLines(plan, family().people!, 'a')
    expect(lines.map((l) => l.by)).toEqual(['a', 'b'])
    expect(lines.reduce((s, l) => s + (l.fact ?? 0), 0)).toBe(spendFact(plan.spend))
  })
  it('участник без выписки месяца — факта нет', () => {
    const r = spendCompare(family(), ctxOf(), 'b')
    expect(r.rows.map((x) => [x.categoryId, x.amount, x.plan])).toEqual([['sc_food', null, 60_000], ['sc_transport', null, 25_000]])
  })
})
