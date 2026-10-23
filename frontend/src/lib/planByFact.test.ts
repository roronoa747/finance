import { describe, expect, it } from 'vitest'
import { PLAN_FACT_DAYS, coveredDays, planByFact, usualWeekly, type UploadPeriod } from './finance'
import { periodsOf, spendTotals } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'

/**
 * FB-21 (бэклог «Фидбек», Р-36): «обычно по неделям» и «Поставить план» по факту — против ручного расчёта (правило 6).
 *
 * Сегодня — пятница 23 октября 2026 (W43 = 19–25 идёт). Выписка Ильяса (a): 1–22 октября (22 дня) → полные недели
 * внутри: W41 = 5–11 и W42 = 12–18 (W40 = 28 сен – 4 окт начинается до выписки, W43 не кончилась).
 * Продукты: W41 20 000, W42 30 000 → среднее 25 000 × 52 / 12 = 108 333,33 → вверх до тысячи 109 000.
 * Транспорт: W41 3 000, W42 0 → 1 500 × 52 / 12 = 6 500 → 7 000.
 * Мимо: «Не разобрано» 5 000, перевод человеку 10 000 (`SPEND_LAST`), коммуналка 25 000 (раздел платежей), разовая
 * покупка 50 000 в продуктах (не в «обычно»). Итого план: 109 000 + 7 000 = 116 000.
 */
const T0 = '2026-10-01T00:00:00.000Z'
const TODAY = '2026-10-23'
let n = 0
const op = (date: string, amount: number, categoryId: string | null, merchant: string, extra: Partial<Operation> = {}): Operation => ({
  id: `op${++n}`, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const OPS: Operation[] = [
  op('2026-10-06', 12_000, 'sc_food', 'Magnum'),
  op('2026-10-09', 8_000, 'sc_food', 'Small'),
  op('2026-10-07', 3_000, 'sc_transport', 'Yandex Go'),
  op('2026-10-13', 18_000, 'sc_food', 'Magnum'),
  op('2026-10-16', 12_000, 'sc_food', 'Базар'),
  op('2026-10-14', 50_000, 'sc_food', 'Диван и стол', { oneOff: true }),
  op('2026-10-15', 5_000, null, 'ИП Ахметова'),
  op('2026-10-15', 10_000, 'sc_people', 'Замира Ш.', { kind: 'transfer-out', counterparty: 'Замира Ш.' }),
  op('2026-10-10', 25_000, 'sc_utilities', 'Алсеко'),
  // Текущая неделя — в счёт не идёт.
  op('2026-10-20', 40_000, 'sc_food', 'Magnum'),
]
const totals = (ops: Operation[], by: 'a' | 'b' = 'a') => periodsOf(ops).flatMap(({ kind, period }) => spendTotals(ops, by, kind, period, T0))
const TOTALS = totals(OPS)
const UPLOADS: UploadPeriod[] = [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-22' }]
const ctx = { totals: TOTALS, spendCategories: [], uploads: UPLOADS }
const noPlans = { spendPlans: [] }

describe('coveredDays — сколько дней покрывают мои выписки', () => {
  it('объединение периодов, не позже сегодня, чужие — мимо', () => {
    expect(coveredDays(UPLOADS, 'a', TODAY)).toBe(22)
    expect(coveredDays(UPLOADS, 'b', TODAY)).toBe(0)
    // Встык и внахлёст — один отрезок; будущее обрезается сегодняшним днём.
    const two: UploadPeriod[] = [
      { slot: 'a', period_from: '2026-10-01', period_to: '2026-10-10' },
      { slot: 'a', period_from: '2026-10-08', period_to: '2026-10-30' },
    ]
    expect(coveredDays(two, 'a', TODAY)).toBe(23)
  })
})

describe('usualWeekly — «обычно по неделям» (Р-36)', () => {
  it('две полные недели: продукты 25 000 в неделю → 109 000 в месяц; транспорт 7 000; разовая, «Не разобрано», люди и коммуналка — по своим правилам', () => {
    const u = usualWeekly(TOTALS, [], UPLOADS, 'a', TODAY)!
    expect(u.weeks).toEqual(['2026-W42', '2026-W41'])
    expect(u.amounts.get('sc_food')).toBe(109_000)
    expect(u.amounts.get('sc_transport')).toBe(7_000)
    // Разовая не вошла в продукты (иначе было бы (20 000 + 80 000) / 2 × 52 / 12 → 217 000); коммуналка без отметки — `unmarked`.
    expect(u.amounts.get('_unknown')).toBe(11_000) // 5 000 / 2 × 52 / 12 = 10 833 → 11 000
    expect(u.amounts.get('sc_people')).toBe(22_000) // 10 000 / 2 × 52 / 12 = 21 667 → 22 000
    // Раздел платежей: в «обычно» таких разделов нет (`spentOf` — только `unmarked`, у итога его нет) — в сумме нет.
    expect(u.amounts.get('sc_utilities')).toBeUndefined()
  })

  it('неполная неделя не в счёт: выписка со среды 7 октября — W41 выпадает, одна полная неделя → null; текущая неделя не в счёт', () => {
    const fromWed: UploadPeriod[] = [{ slot: 'a', period_from: '2026-10-07', period_to: '2026-10-22' }]
    expect(usualWeekly(TOTALS, [], fromWed, 'a', TODAY)).toBeNull()
    // Выписка до конца текущей недели — W43 всё равно не кончилась: те же две недели.
    const toSunday: UploadPeriod[] = [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-25' }]
    expect(usualWeekly(TOTALS, [], toSunday, 'a', TODAY)!.weeks).toEqual(['2026-W42', '2026-W41'])
  })

  it('не больше 8 последних недель; у партнёра — свои итоги и свои выписки', () => {
    const long: UploadPeriod[] = [{ slot: 'a', period_from: '2026-07-01', period_to: '2026-10-22' }]
    expect(usualWeekly(TOTALS, [], long, 'a', TODAY)!.weeks).toHaveLength(8)
    const hers = totals([op('2026-10-13', 7_000, 'sc_cafe', 'Кофейня')], 'b')
    const b = usualWeekly([...TOTALS, ...hers], [], [...UPLOADS, { slot: 'b', period_from: '2026-10-01', period_to: '2026-10-22' }], 'b', TODAY)!
    expect([...b.amounts]).toEqual([['sc_cafe', 16_000]]) // 7 000 / 2 × 52 / 12 = 15 167 → 16 000
  })
})

describe('planByFact — «Поставить план» (Р-36)', () => {
  it('строки — продукты 109 000 и транспорт 7 000 по убыванию, итог 116 000; «Не разобрано», платежи, люди и разовые — мимо', () => {
    const p = planByFact(noPlans, ctx, 'a', TODAY)!
    expect(p.rows).toEqual([
      { categoryId: 'sc_food', name: 'Продукты', amount: 109_000 },
      { categoryId: 'sc_transport', name: 'Транспорт', amount: 7_000 },
    ])
    expect(p.total).toBe(116_000)
  })

  it(`null при покрытии меньше ${PLAN_FACT_DAYS} дней, при своей живой строке плана, при одной полной неделе; надгробие плана не мешает`, () => {
    expect(planByFact(noPlans, { ...ctx, uploads: [{ slot: 'a', period_from: '2026-10-10', period_to: '2026-10-22' }] }, 'a', TODAY)).toBeNull()
    expect(planByFact({ spendPlans: [{ id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 }] }, ctx, 'a', TODAY)).toBeNull()
    expect(planByFact({ spendPlans: [{ id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 100_000, updatedAt: T0, deletedAt: T0 }] }, ctx, 'a', TODAY)).not.toBeNull()
    // План партнёра — не мой: мне предложение остаётся.
    expect(planByFact({ spendPlans: [{ id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 }] }, ctx, 'a', TODAY)).not.toBeNull()
    expect(planByFact(noPlans, { ...ctx, uploads: [{ slot: 'a', period_from: '2026-10-07', period_to: '2026-10-22' }] }, 'a', TODAY)).toBeNull()
  })

  it('у партнёра — свой результат; без своих выписок — null', () => {
    expect(planByFact(noPlans, ctx, 'b', TODAY)).toBeNull()
    const hers = totals([op('2026-10-13', 7_000, 'sc_cafe', 'Кофейня')], 'b')
    const p = planByFact(noPlans, { ...ctx, totals: [...TOTALS, ...hers], uploads: [...UPLOADS, { slot: 'b', period_from: '2026-10-01', period_to: '2026-10-22' }] }, 'b', TODAY)!
    expect(p.rows).toEqual([{ categoryId: 'sc_cafe', name: 'Кафе и рестораны', amount: 16_000 }])
  })
})
