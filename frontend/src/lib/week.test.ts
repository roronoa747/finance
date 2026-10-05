import { describe, expect, it } from 'vitest'
import { monthPlan, myWeek, prevWeekKey, sectionWeek, weekTrend, type MonthPlanState } from './finance'
import { periodsOf, spendTotals } from '@/lib/statements/model'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import type { UploadPeriod } from './finance'

/**
 * B2C-92: «Неделя» — мои траты против ручного расчёта (правило 6 — числа в комментариях).
 *
 * Октябрь 2026 (1-е — четверг): W40 = 28 сен – 4 окт, W41 = 5–11, W42 = 12–18, W43 = 19–25.
 * Ильяс (a) — план: продукты 150 000, транспорт 30 000, кафе 60 000 (трат нет). Аруна (b) — продукты 100 000.
 *
 * Операции Ильяса:
 *   W40: 29 сен продукты 10 000 · 2 окт продукты 8 000 · 3 окт транспорт 3 000                    → 21 000
 *   W41: продукты 12 000 + 6 000 · транспорт 4 000 · развлечения 9 000 (вне плана)                 → 31 000
 *        коммуналка 25 000 — раздел платежей, на «Неделе» её нет; перевод себе 50 000 и зарплата — не траты
 *   W42: продукты 5 000 + 7 000 + 2 000 + 4 000 + 3 000 + 1 500 + 2 500 = 25 000 · транспорт 4 000 ·
 *        не разобрано 12 400                                                                       → 41 400
 *   W43: 20 окт продукты 6 000                                                                     →  6 000
 * Факт октября: продукты 8 000 + 18 000 + 25 000 + 6 000 = 57 000; транспорт 3 000 + 4 000 + 4 000 = 11 000.
 * W42 к W41: +10 400, 10 400 / 31 000 = 33,5 % → 34 %.
 */

const T0 = '2026-09-01T00:00:00.000Z'
let n = 0
const op = (date: string, amount: number, categoryId: string | null, merchant: string, extra: Partial<Operation> = {}): Operation => ({
  id: `op${++n}`, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})

const OPS: Operation[] = [
  op('2026-09-29', 10_000, 'sc_food', 'Magnum'),
  op('2026-10-02', 8_000, 'sc_food', 'Magnum'),
  op('2026-10-03', 3_000, 'sc_transport', 'Yandex Go'),
  op('2026-10-05', 12_000, 'sc_food', 'Magnum'),
  op('2026-10-07', 6_000, 'sc_food', 'Small'),
  op('2026-10-08', 4_000, 'sc_transport', 'Yandex Go'),
  op('2026-10-09', 9_000, 'sc_fun', 'Цветы'),
  op('2026-10-10', 25_000, 'sc_utilities', 'Алсеко'),
  op('2026-10-06', 50_000, null, 'Перевод себе', { kind: 'transfer-out', internal: true }),
  op('2026-10-06', -777_000, null, 'Зарплата', { kind: 'income' }),
  op('2026-10-12', 5_000, 'sc_food', 'Magnum'),
  op('2026-10-13', 7_000, 'sc_food', 'Magnum'),
  op('2026-10-14', 2_000, 'sc_food', 'Small'),
  op('2026-10-15', 4_000, 'sc_food', 'Базар'),
  op('2026-10-16', 3_000, 'sc_food', 'Magnum'),
  op('2026-10-17', 1_500, 'sc_food', 'Small'),
  op('2026-10-18', 2_500, 'sc_food', 'Magnum'),
  op('2026-10-14', 4_000, 'sc_transport', 'Yandex Go'),
  op('2026-10-16', 12_400, null, 'ИП Ахметова'),
  op('2026-10-20', 6_000, 'sc_food', 'Magnum'),
]

// Итоги Ильяса — тем же `spendTotals`, что пишет стор; Аруны — её недельные и месячные продукты.
const TOTALS: SpendTotal[] = [
  ...periodsOf(OPS).flatMap(({ kind, period }) => spendTotals(OPS, 'a', kind, period, T0)),
  { id: 'b:week:2026-W42:sc_food', by: 'b', kind: 'week', period: '2026-W42', categoryId: 'sc_food', amount: 40_000, ops: 5, updatedAt: T0 },
  { id: 'b:month:2026-10:sc_food', by: 'b', kind: 'month', period: '2026-10', categoryId: 'sc_food', amount: 90_000, ops: 12, updatedAt: T0 },
]
const UPLOADS: UploadPeriod[] = [
  { slot: 'a', period_from: '2026-09-01', period_to: '2026-10-20' },
  { slot: 'b', period_from: '2026-10-01', period_to: '2026-10-18' },
]

const state = (extra: Partial<MonthPlanState> = {}): MonthPlanState => ({
  people: [
    { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
    { id: 'b', name: 'Аруна', salary: 450_000, payday: 25, updatedAt: T0 },
  ],
  spendPlans: [
    { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
    { id: 'a:sc_transport', by: 'a', categoryId: 'sc_transport', amount: 30_000, updatedAt: T0 },
    { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 60_000, updatedAt: T0 },
    { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 },
  ],
  ...extra,
})
const base = { totals: TOTALS, spendCategories: [], uploads: UPLOADS, ops: OPS }
const week = (w: string, today: string, by: 'a' | 'b' = 'a', s = state()) => myWeek(s, { ...base, by, week: w, today })
const row = (w: ReturnType<typeof myWeek>, id: string) => w.rows.find((r) => r.categoryId === id)!

describe('myWeek — мои разделы недели (Р-95, Р-98)', () => {
  it('сумма недели, сравнение с прошлой и разделы от большего к меньшему', () => {
    const w = week('2026-W42', '2026-10-21')
    expect(w.range).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(w.total).toBe(41_400)
    expect(w.prev).toBe(31_000)
    expect(w.delta).toBe(10_400)
    expect(w.pct).toBe(34)
    // Продукты 25 000 → не разобрано 12 400 → транспорт 4 000 → кафе (план без трат); развлечений на неделе нет.
    expect(w.rows.map((r) => [r.categoryId, r.amount])).toEqual([
      ['sc_food', 25_000],
      [UNKNOWN_CATEGORY, 12_400],
      ['sc_transport', 4_000],
      ['sc_cafe', 0],
    ])
  })

  it('стрелки: больше, столько же, новое; без трат — стрелки нет', () => {
    const w = week('2026-W42', '2026-10-21')
    expect(row(w, 'sc_food').arrow).toBe('up') // 25 000 против 18 000
    expect(row(w, 'sc_transport').arrow).toBe('same') // 4 000 и 4 000
    expect(row(w, UNKNOWN_CATEGORY).arrow).toBe('up')
    expect(row(w, 'sc_cafe').arrow).toBeNull()
    expect(row(week('2026-W43', '2026-10-21'), 'sc_food').arrow).toBe('down') // 6 000 против 25 000
  })

  it('партнёрские итоги не попадают: у Ильяса нет 40 000 Аруны, у Аруны — только её', () => {
    expect(row(week('2026-W42', '2026-10-21'), 'sc_food').amount).toBe(25_000)
    const b = week('2026-W42', '2026-10-21', 'b')
    expect(b.total).toBe(40_000)
    expect(b.rows.map((r) => r.categoryId)).toEqual(['sc_food'])
    // Остаток Аруны: 100 000 − 90 000; операций Ильяса из её остатка не вычитаем — их у неё нет (ops — свои).
    expect(myWeek(state(), { ...base, ops: [], by: 'b', week: '2026-W42', today: '2026-10-18' }).rows[0].rest).toBe(10_000)
  })

  it('платежи (коммуналка), переводы между своими и доходы — не траты недели', () => {
    const w = week('2026-W41', '2026-10-21')
    expect(w.total).toBe(31_000)
    expect(w.rows.some((r) => r.categoryId === 'sc_utilities')).toBe(false)
  })

  it('остаток текущей недели = остаток «Месяца» до тенге (одна дорога с monthPlan)', () => {
    const w = week('2026-W43', '2026-10-21')
    const mine = monthPlan(state(), { key: '2026-10', totals: TOTALS, spendCategories: [], uploads: UPLOADS }).spend.find((s) => s.by === 'a')!
    expect(w.month).toBe('2026-10')
    for (const r of mine.rows) expect(row(w, r.categoryId).rest).toBe(r.plan - (r.fact ?? 0))
    expect(row(w, 'sc_food').rest).toBe(93_000) // 150 000 − 57 000
    expect(row(w, 'sc_transport').rest).toBe(19_000) // 30 000 − 11 000
    expect(row(w, 'sc_cafe').rest).toBe(60_000)
    // Разделы плана без трат — по сумме плана: продукты 6 000 → кафе 60 000 → транспорт 30 000.
    expect(w.rows.map((r) => r.categoryId)).toEqual(['sc_food', 'sc_cafe', 'sc_transport'])
  })

  it('прошлая неделя — остаток на её конец: траты после неё не вычитаются', () => {
    const w = week('2026-W42', '2026-10-21')
    expect(row(w, 'sc_food').spent).toBe(51_000) // 57 000 − 6 000 (20 октября)
    expect(row(w, 'sc_food').rest).toBe(99_000)
    expect(row(w, 'sc_transport').rest).toBe(19_000)
  })

  it('неделя на стыке месяцев: месяц — по последнему дню недели, не позже сегодня', () => {
    // 21 октября: неделя 28 сен – 4 окт кончилась в октябре → план октября, факт на 4 октября — 8 000.
    const oct = week('2026-W40', '2026-10-21')
    expect(oct.month).toBe('2026-10')
    expect(row(oct, 'sc_food').amount).toBe(18_000) // 10 000 сентября + 8 000 октября — неделя целиком
    expect(row(oct, 'sc_food').rest).toBe(142_000)
    expect(row(oct, 'sc_transport').rest).toBe(27_000)
    // 30 сентября та же неделя ещё идёт в сентябре → план сентября: 150 000 − 10 000.
    const sep = week('2026-W40', '2026-09-30')
    expect(sep.month).toBe('2026-09')
    expect(row(sep, 'sc_food').rest).toBe(140_000)
  })

  it('раздел без плана — остатка нет; плана нет совсем — ни у одного', () => {
    const w = week('2026-W41', '2026-10-21')
    expect(row(w, 'sc_fun')).toMatchObject({ amount: 9_000, plan: null, spent: null, rest: null, low: false })
    const bare = week('2026-W42', '2026-10-21', 'a', state({ spendPlans: [] }))
    expect(bare.rows.map((r) => r.categoryId)).toEqual(['sc_food', UNKNOWN_CATEGORY, 'sc_transport'])
    expect(bare.rows.every((r) => r.plan === null && r.rest === null)).toBe(true)
  })

  it('мало: остаток меньше 15 % плана или сверх плана', () => {
    const plans = (amount: number) => state({ spendPlans: [{ id: 'a:sc_transport', by: 'a', categoryId: 'sc_transport', amount, updatedAt: T0 }] })
    expect(row(week('2026-W43', '2026-10-21', 'a', plans(30_000)), 'sc_transport').low).toBe(false) // 19 000 из 30 000
    expect(row(week('2026-W43', '2026-10-21', 'a', plans(12_000)), 'sc_transport')).toMatchObject({ rest: 1_000, low: true }) // 1 000 < 1 800
    expect(row(week('2026-W43', '2026-10-21', 'a', plans(10_000)), 'sc_transport')).toMatchObject({ rest: -1_000, low: true })
  })

  it('своей выписки за месяц нет — остаток равен плану', () => {
    const w = myWeek(state(), { totals: [], spendCategories: [], uploads: [], ops: [], by: 'a', week: '2026-W43', today: '2026-10-21' })
    expect(w.total).toBe(0)
    expect(w.pct).toBeNull()
    expect(w.rows.map((r) => [r.categoryId, r.rest])).toEqual([['sc_food', 150_000], ['sc_cafe', 60_000], ['sc_transport', 30_000]])
  })

  it('процент при нулевой прошлой неделе — null, не деление на ноль', () => {
    const w = week('2026-W39', '2026-10-21')
    expect(w).toMatchObject({ total: 0, prev: 0, delta: 0, pct: null })
    // W40: 21 000 против пустой W39.
    expect(week('2026-W40', '2026-10-21')).toMatchObject({ total: 21_000, prev: 0, delta: 21_000, pct: null })
    expect(prevWeekKey('2026-W01')).toBe('2025-W52')
  })
})

describe('sectionWeek — раздел за неделю (Р-101)', () => {
  it('топ продавцов по сумме, операции по дням, хвост «ещё N · сумма»', () => {
    const s = sectionWeek(OPS, { week: '2026-W42', categoryId: 'sc_food' })
    expect(s.total).toBe(25_000)
    expect(s.count).toBe(7)
    // Magnum 5 000 + 7 000 + 3 000 + 2 500 = 17 500 · Базар 4 000 · Small 2 000 + 1 500 = 3 500.
    expect(s.tops).toEqual([
      { name: 'Magnum', count: 4, amount: 17_500 },
      { name: 'Базар', count: 1, amount: 4_000 },
      { name: 'Small', count: 2, amount: 3_500 },
    ])
    expect(s.days.map((d) => [d.date, d.ops.map((o) => o.amount)])).toEqual([
      ['2026-10-18', [2_500]],
      ['2026-10-17', [1_500]],
      ['2026-10-16', [3_000]],
      ['2026-10-15', [4_000]],
      ['2026-10-14', [2_000]],
    ])
    expect(s.more).toEqual({ count: 2, amount: 12_000 }) // 13-е и 12-е: 7 000 + 5 000
    const all = sectionWeek(OPS, { week: '2026-W42', categoryId: 'sc_food', limit: Infinity })
    expect(all.more).toBeNull()
    expect(all.days).toHaveLength(7)
  })

  it('не разобранное — раздел `_unknown`; переводы между своими и доходы не входят', () => {
    expect(sectionWeek(OPS, { week: '2026-W42', categoryId: UNKNOWN_CATEGORY })).toMatchObject({ total: 12_400, count: 1, tops: [{ name: 'ИП Ахметова', count: 1, amount: 12_400 }] })
    expect(sectionWeek(OPS, { week: '2026-W41', categoryId: UNKNOWN_CATEGORY })).toMatchObject({ total: 0, count: 0, tops: [], days: [], more: null })
  })

  it('сумма недели из итогов и из операций сходится — одно правило отбора', () => {
    for (const w of ['2026-W40', '2026-W41', '2026-W42', '2026-W43']) {
      const mine = week(w, '2026-10-21')
      const fromOps = mine.rows.map((r) => sectionWeek(OPS, { week: w, categoryId: r.categoryId }).total)
      expect(fromOps).toEqual(mine.rows.map((r) => r.amount))
      expect(fromOps.reduce((s, x) => s + x, 0)).toBe(mine.total)
    }
  })
})

describe('weekTrend — 8 недель (Р-98)', () => {
  it('восемь значений по порядку, текущая — последняя, пустые недели = 0, только свои', () => {
    const t = weekTrend(TOTALS, [], 'a', '2026-W43')
    expect(t.map((x) => x.week)).toEqual(['2026-W36', '2026-W37', '2026-W38', '2026-W39', '2026-W40', '2026-W41', '2026-W42', '2026-W43'])
    expect(t.map((x) => x.amount)).toEqual([0, 0, 0, 0, 21_000, 31_000, 41_400, 6_000])
    expect(t.at(-1)!.from).toBe('2026-10-19')
    expect(weekTrend(TOTALS, [], 'b', '2026-W43').map((x) => x.amount)).toEqual([0, 0, 0, 0, 0, 0, 40_000, 0])
  })
})
