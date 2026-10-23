import { describe, expect, it } from 'vitest'
import { firstWeek, monthPlan, myWeek, prevWeekKey, sectionMonth, sectionWeek, startWeek, weekFeed, weekTrend, type MonthPlanState } from './finance'
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

  it('к прошлой у раздела — delta = amount − prev (лист раздела не считает сам; ревью frontend Б15, Н-4)', () => {
    const w = week('2026-W42', '2026-10-21')
    expect(row(w, 'sc_food')).toMatchObject({ amount: 25_000, prev: 18_000, delta: 7_000 })
    expect(row(w, 'sc_transport').delta).toBe(0)
    expect(row(week('2026-W43', '2026-10-21'), 'sc_food').delta).toBe(-19_000)
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

  it('FB-19 (Р-31): план недели = план месяца × 7 / дней; остаток — план минус вся неделя; без строк плана — null', () => {
    // Октябрь, 31 день: 775 000 × 7 / 31 = 174 999,99… → 175 000; W42 Ильяса — 41 400 (с «Не разобрано») → осталось 133 600.
    const big = state({ spendPlans: [{ id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 775_000, updatedAt: T0 }] })
    expect(week('2026-W42', '2026-10-21', 'a', big)).toMatchObject({ total: 41_400, plan: 175_000, rest: 133_600 })
    // Свой план Ильяса 240 000 → 240 000 × 7 / 31 = 54 193,5 → 54 194; остаток 12 794.
    expect(week('2026-W42', '2026-10-21')).toMatchObject({ plan: 54_194, rest: 12_794 })
    // Перерасход: план 30 000 → 6 774 в неделю, потрачено 41 400 → −34 626.
    const small = state({ spendPlans: [{ id: 'a:sc_transport', by: 'a', categoryId: 'sc_transport', amount: 30_000, updatedAt: T0 }] })
    expect(week('2026-W42', '2026-10-21', 'a', small)).toMatchObject({ plan: 6_774, rest: -34_626 })
    // Строк плана нет — ни плана, ни остатка.
    expect(week('2026-W42', '2026-10-21', 'a', state({ spendPlans: [] }))).toMatchObject({ plan: null, rest: null })
    // План Аруны — только её строки: 100 000 × 7 / 31 = 22 581; её W42 — 40 000 → −17 419.
    expect(week('2026-W42', '2026-10-21', 'b')).toMatchObject({ plan: 22_581, rest: -17_419 })
    // Неделя на стыке месяцев: 21 октября — W40 по октябрю (31 день) → 54 194; 30 сентября — по сентябрю (30 дней) → 56 000.
    expect(week('2026-W40', '2026-10-21').plan).toBe(54_194)
    expect(week('2026-W40', '2026-09-30').plan).toBe(56_000)
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
    // Имя — продавец коротко, как в ленте и в заголовке листа операции (/ux Фидбек 1).
    expect(sectionWeek(OPS, { week: '2026-W42', categoryId: UNKNOWN_CATEGORY })).toMatchObject({ total: 12_400, count: 1, tops: [{ name: 'Ахметова', count: 1, amount: 12_400 }] })
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

describe('weekFeed — лента трат недели (бэклог «Лента недели», Р-1)', () => {
  it('W42: все траты по дням, свежие сверху; доходы и переводы между своими не входят; сумма = сумма недели', () => {
    const f = weekFeed(OPS, { week: '2026-W42' })
    // Продукты 25 000 (7 строк) + транспорт 4 000 + не разобрано 12 400 = 41 400, 9 трат.
    expect(f).toMatchObject({ count: 9, total: 41_400 })
    expect(f.days.map((d) => [d.date, d.ops.map((o) => o.amount)])).toEqual([
      ['2026-10-18', [2_500]],
      ['2026-10-17', [1_500]],
      ['2026-10-16', [12_400, 3_000]],
      ['2026-10-15', [4_000]],
      ['2026-10-14', [4_000, 2_000]],
      ['2026-10-13', [7_000]],
      ['2026-10-12', [5_000]],
    ])
    // Продавец коротко (`shortMerchant`): правовая форма снята, как в «Разборе».
    expect(f.days[2].ops[0]).toMatchObject({ name: 'Ахметова', categoryId: UNKNOWN_CATEGORY, phone: false })
  })

  it('сумма ленты = сумма недели (`myWeek`) каждой недели: коммуналка — раздел платежей — без отметок не входит', () => {
    for (const w of ['2026-W40', '2026-W41', '2026-W42', '2026-W43']) {
      expect(weekFeed(OPS, { week: w }).total).toBe(week(w, '2026-10-21').total)
    }
    // W41: 12 000 + 6 000 + 4 000 + 9 000 = 31 000 — без Алсеко 25 000.
    expect(weekFeed(OPS, { week: '2026-W41' })).toMatchObject({ count: 4, total: 31_000 })
  })

  it('раздел платежей: строка без отметки — трата (в ленте и в сумме недели), отмеченная — платёж, её нет', () => {
    const utility = OPS.find((o) => o.merchant === 'Алсеко')!
    const sumOf = (marked: Set<string>) => {
      const totals = periodsOf(OPS).flatMap(({ kind, period }) => spendTotals(OPS, 'a', kind, period, T0, { marked, categories: [] }))
      return myWeek(state(), { ...base, totals, by: 'a', week: '2026-W41', today: '2026-10-21' }).total
    }
    // Не отмечена: 31 000 + 25 000 = 56 000.
    const open = weekFeed(OPS, { week: '2026-W41', marked: new Set(), categories: [] })
    expect(open).toMatchObject({ count: 5, total: 56_000 })
    expect(open.total).toBe(sumOf(new Set()))
    // Отмечена платежом коммуналки: снова 31 000.
    const paid = weekFeed(OPS, { week: '2026-W41', marked: new Set([utility.id]), categories: [] })
    expect(paid).toMatchObject({ count: 4, total: 31_000 })
    expect(paid.total).toBe(sumOf(new Set([utility.id])))
  })

  it('с телефона — значок и сверху дня (свежие первыми), продавец коротко, перевод — имя получателя', () => {
    const list = [
      op('2026-10-14', 900, 'sc_food', 'MAGAZIN SMALL MARKET ASTANA Q. KZ'),
      op('2026-10-14', 3_500, 'sc_cafe', 'COFFEE BOOM ALMATY KZ', { source: 'tap', at: '2026-10-14T05:00:00Z' }),
      op('2026-10-14', 2_000, null, 'Перевод', { source: 'push', at: '2026-10-14T09:00:00Z', kind: 'transfer-out', counterparty: 'Дана К.' }),
      op('2026-10-14', 1_200, 'sc_transport', 'YANDEX.GO ALMATY KZ'),
      op('2026-10-15', 700, 'sc_food', 'Magnum', { source: 'tap', at: '2026-10-15T03:00:00Z' }),
    ]
    const f = weekFeed(list, { week: '2026-W42' })
    expect(f).toMatchObject({ count: 5, total: 8_300 })
    expect(f.days.map((d) => d.ops.map((o) => [o.name, o.amount, o.phone]))).toEqual([
      [['Magnum', 700, true]],
      [
        ['Дана К.', 2_000, true],
        ['COFFEE BOOM', 3_500, true],
        ['YANDEX.GO', 1_200, false],
        ['MAGAZIN SMALL MARKET', 900, false],
      ],
    ])
    expect(weekFeed(list, { week: '2026-W41' })).toEqual({ count: 0, total: 0, days: [] })
  })

  it('ручная трата (бэклог «Ручная трата», Р-2): признак hand, без значка телефона, подпись как вписал человек', () => {
    const list = [
      op('2026-10-14', 2_500, 'sc_food', 'Базар Алматы', { bank: 'hand', note: 'Базар Алматы' }),
      op('2026-10-14', 900, 'sc_food', 'MAGAZIN SMALL MARKET ASTANA Q. KZ'),
    ]
    const f = weekFeed(list, { week: '2026-W42' })
    expect(f).toMatchObject({ count: 2, total: 3_400 })
    expect(f.days[0].ops.map((o) => [o.name, o.hand, o.phone])).toEqual([
      ['Базар Алматы', true, false],
      ['MAGAZIN SMALL MARKET', false, false],
    ])
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

describe('startWeek · firstWeek — какую неделю открыть и докуда листать (Р-102)', () => {
  const up = (slot: string, from: string, to: string): UploadPeriod => ({ slot, period_from: from, period_to: to })

  it('текущая — если за неё уже есть своя выписка или траты', () => {
    expect(startWeek(TOTALS, UPLOADS, 'a', '2026-W43')).toBe('2026-W43') // 20 октября — продукты 6 000
    expect(startWeek([], [up('a', '2026-10-19', '2026-10-19')], 'a', '2026-W43')).toBe('2026-W43')
  })

  it('иначе прошлая — если за неё есть своя выписка или траты (выписку грузят в начале следующей недели)', () => {
    // Понедельник 26 октября (W44): за новую неделю ничего нет, за W43 — есть.
    expect(startWeek(TOTALS, UPLOADS, 'a', '2026-W44')).toBe('2026-W43')
    expect(startWeek([], [up('a', '2026-10-01', '2026-10-25')], 'a', '2026-W44')).toBe('2026-W43')
  })

  it('нет ни там, ни там — текущая (ждёт загрузки); чужие выписки и траты не в счёт', () => {
    expect(startWeek(TOTALS, UPLOADS, 'a', '2026-W46')).toBe('2026-W46')
    expect(startWeek([], [], 'a', '2026-W43')).toBe('2026-W43')
    // У Аруны — только W42 (её итог и выписка по 18 октября): в W44 она на текущей, в W43 — на прошлой.
    expect(startWeek(TOTALS, UPLOADS, 'b', '2026-W44')).toBe('2026-W44')
    expect(startWeek(TOTALS, UPLOADS, 'b', '2026-W43')).toBe('2026-W42')
  })

  it('firstWeek — самая ранняя неделя со своими тратами; трат нет — null', () => {
    expect(firstWeek(TOTALS, 'a')).toBe('2026-W40')
    expect(firstWeek(TOTALS, 'b')).toBe('2026-W42')
    expect(firstWeek([], 'a')).toBeNull()
  })
})

describe('«Мне вернули» в неделе (FB-02, Р-12): одна spendOf у итогов, ленты и листа раздела', () => {
  // W42: продукты Magnum 13-го 7 000 — вернули 3 000 (частично), Базар 15-го 4 000 — вернули всё.
  const edited = OPS.map((o) =>
    o.date === '2026-10-13' && o.merchant === 'Magnum' ? { ...o, refund: { amount: 3_000 } } : o.date === '2026-10-15' && o.merchant === 'Базар' ? { ...o, refund: { amount: 4_000 } } : o,
  )
  const totals = periodsOf(edited).flatMap(({ kind, period }) => spendTotals(edited, 'a', kind, period, T0))
  const food = (t: SpendTotal[]) => t.find((x) => x.kind === 'week' && x.period === '2026-W42' && x.categoryId === 'sc_food')!

  it('итог недели раздела: 25 000 − 3 000 − 4 000 = 18 000; строк — 7 (полный возврат остаётся строкой)', () => {
    expect(food(totals)).toMatchObject({ amount: 18_000, ops: 7 })
  })

  it('лента и лист раздела — те же суммы: строка с полным возвратом — 0', () => {
    const f = weekFeed(edited, { week: '2026-W42' })
    // 41 400 − 7 000 = 34 400.
    expect(f.total).toBe(34_400)
    expect(f.days.find((d) => d.date === '2026-10-15')!.ops.map((o) => o.amount)).toEqual([0])
    const s = sectionWeek(edited, { week: '2026-W42', categoryId: 'sc_food', limit: Infinity })
    expect(s.total).toBe(food(totals).amount)
    expect(s.count).toBe(7)
  })
})

describe('sectionMonth — свои операции раздела за месяц (FB-05, Р-14)', () => {
  it('октябрь, продукты: 11 строк по дням свежими сверху, первые 5 и «Ещё 6 · сумма»; сумма всех = факт раздела месяца', () => {
    const m = sectionMonth(OPS, { month: '2026-10', categoryId: 'sc_food' })
    // 8 000 + 18 000 + 25 000 + 6 000 = 57 000 (сентябрьские 10 000 не в счёт), 11 строк.
    expect(m).toMatchObject({ total: 57_000, count: 11 })
    expect(m.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-18', '2026-10-17', '2026-10-16', '2026-10-15'])
    expect(m.more).toEqual({ count: 6, amount: 57_000 - (6_000 + 2_500 + 1_500 + 3_000 + 4_000) })
    const total = TOTALS.find((t) => t.by === 'a' && t.kind === 'month' && t.period === '2026-10' && t.categoryId === 'sc_food')!
    expect(sectionMonth(OPS, { month: '2026-10', categoryId: 'sc_food', limit: Infinity }).days.flatMap((d) => d.ops).reduce((a, o) => a + o.amount, 0)).toBe(total.amount)
    expect(sectionMonth(OPS, { month: '2026-09', categoryId: 'sc_food' })).toMatchObject({ total: 10_000, count: 1, more: null })
  })

  it('возврат — spendOf и «вернули» в строке; ручная — hand; раздел платежей — только строки без отметки', () => {
    const list: Operation[] = [
      op('2026-10-05', 12_000, 'sc_home', 'Leroy', { refund: { amount: 2_000 } }),
      op('2026-10-06', 3_000, 'sc_home', 'Базар', { bank: 'hand' }),
      op('2026-10-10', 25_000, 'sc_utilities', 'Алсеко', { id: 'u1' }),
      op('2026-10-11', 5_000, 'sc_utilities', 'Алсеко', { id: 'u2' }),
    ]
    const home = sectionMonth(list, { month: '2026-10', categoryId: 'sc_home' })
    expect(home.total).toBe(13_000)
    expect(home.days.flatMap((d) => d.ops)).toEqual([
      { id: expect.any(String), name: 'Базар', amount: 3_000, hand: true },
      { id: expect.any(String), name: 'Leroy', amount: 10_000, hand: false, refund: 2_000 },
    ])
    expect(sectionMonth(list, { month: '2026-10', categoryId: 'sc_utilities', marked: new Set(['u1']), categories: [] }).days.flatMap((d) => d.ops.map((o) => o.id))).toEqual(['u2'])
  })
})

describe('«Разовая» в неделе и месяце (FB-07, Р-16)', () => {
  // W42: продукты Magnum 13-го 7 000 — разовая.
  const edited = OPS.map((o) => (o.date === '2026-10-13' && o.merchant === 'Magnum' ? { ...o, oneOff: true } : o))
  const totalsOf = (ops: Operation[]) => periodsOf(ops).flatMap(({ kind, period }) => spendTotals(ops, 'a', kind, period, T0))

  it('сумма недели, строка раздела и лента — с разовой («Неделя» — мои траты)', () => {
    const before = myWeek(state(), { ...base, totals: totalsOf(OPS), week: '2026-W42', today: '2026-10-21', by: 'a' })
    const after = myWeek(state(), { ...base, ops: edited, totals: totalsOf(edited), week: '2026-W42', today: '2026-10-21', by: 'a' })
    expect(after.total).toBe(before.total)
    expect(after.rows.map((r) => [r.categoryId, r.amount])).toEqual(before.rows.map((r) => [r.categoryId, r.amount]))
    // «Осталось до плана» — из строки раздела месяца, а она без разовых (как на «Месяце»): 51 000 − 7 000.
    expect(after.rows.find((r) => r.categoryId === 'sc_food')).toMatchObject({ spent: 44_000, rest: 106_000 })
    expect(weekFeed(edited, { week: '2026-W42' }).total).toBe(weekFeed(OPS, { week: '2026-W42' }).total)
    expect(sectionWeek(edited, { week: '2026-W42', categoryId: 'sc_food', limit: Infinity }).total).toBe(25_000)
  })

  it('лист раздела «Месяца» — без разовой; лист «Разовые» — только она', () => {
    expect(sectionMonth(edited, { month: '2026-10', categoryId: 'sc_food' }).total).toBe(57_000 - 7_000)
    const one = sectionMonth(edited, { month: '2026-10', oneOff: true })
    expect(one).toMatchObject({ total: 7_000, count: 1, more: null })
    expect(one.days.flatMap((d) => d.ops.map((o) => o.name))).toEqual(['Magnum'])
  })
})
