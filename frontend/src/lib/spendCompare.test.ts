import { describe, expect, it } from 'vitest'
import { OVER_MIN, earlierLabel, monthCovered, rkShare, spendCompare, usualMonths, usualSpend, type MonthPlanCtx, type UploadPeriod } from './finance'
import { RK_GROUP_BY_CATEGORY, RK_SPEND_GROUPS } from './statements/dictionary'
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
    // 20 000 за 5 дней «в темпе» — 124 000 за месяц, но это меньше обычного 30 000 → точки нет.
    expect(at(30_000, 20_000)).toBe(false)
  })
})

describe('справка РК', () => {
  it('доли — из константы источника; группы — 3', () => {
    expect([RK_SPEND_GROUPS.food.share, RK_SPEND_GROUPS.goods.share, RK_SPEND_GROUPS.services.share]).toEqual([54, 19, 24])
    expect(RK_SPEND_GROUPS.food.source).toBe('stat.gov.kz')
    expect(new Set(Object.values(RK_GROUP_BY_CATEGORY))).toEqual(new Set(['food', 'goods', 'services']))
  })
  it('доля группы — сумма её разделов (и разделов платежей целиком) от всех трат месяца', () => {
    // Октябрь a: продукты 100 000, кафе 60 000, коммуналка 25 000, не разобрано 5 000 → всего 190 000.
    // Продукты 100 / 190 = 52,6 → 53; услуги (кафе + коммуналка) 85 / 190 = 44,7 → 45; покупки 0.
    expect(rkShare(family(), ctxOf(), 'food')).toBe(53)
    expect(rkShare(family(), ctxOf(), 'services')).toBe(45)
    expect(rkShare(family(), ctxOf(), 'goods')).toBe(0)
  })
  it('выписок месяца нет — null', () => {
    expect(rkShare(family(), ctxOf({ uploads: [] }), 'food')).toBeNull()
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
