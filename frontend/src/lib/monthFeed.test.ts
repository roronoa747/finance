import { describe, expect, it } from 'vitest'
import { monthFeed, weekFeed } from './finance'
import type { Operation } from '@/lib/statements/types'

/** «История» месяца (пачка 2 «Figma», FG-23): та же лента, что у недели, только по календарному месяцу. */
let n = 0
const op = (date: string, amount: number, categoryId: string | null, merchant: string, extra: Partial<Operation> = {}): Operation => ({
  id: `op${++n}`, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})

const OPS: Operation[] = [
  op('2026-09-29', 10_000, 'sc_food', 'Magnum'),
  op('2026-10-02', 8_000, 'sc_food', 'Magnum'),
  op('2026-10-05', 12_000, 'sc_food', 'Magnum'),
  op('2026-10-06', 50_000, null, 'Перевод себе', { kind: 'transfer-out', internal: true }),
  op('2026-10-06', -777_000, null, 'Зарплата', { kind: 'income' }),
  op('2026-10-12', 5_000, 'sc_food', 'Magnum'),
  op('2026-10-14', 4_000, 'sc_transport', 'Yandex Go'),
  op('2026-10-16', 12_400, null, 'ИП Ахметова'),
  op('2026-10-31', 3_000, 'sc_food', 'Small'),
  op('2026-11-01', 7_000, 'sc_food', 'Magnum'),
]

describe('monthFeed — «История» месяца', () => {
  it('только траты месяца по дням, свежие сверху; соседние месяцы, доходы и переводы между своими не входят', () => {
    const f = monthFeed(OPS, { month: '2026-10' })
    expect(f.count).toBe(6)
    expect(f.total).toBe(8_000 + 12_000 + 5_000 + 4_000 + 12_400 + 3_000)
    expect(f.days.map((d) => d.date)).toEqual(['2026-10-31', '2026-10-16', '2026-10-14', '2026-10-12', '2026-10-05', '2026-10-02'])
    expect(monthFeed(OPS, { month: '2026-12' })).toEqual({ count: 0, total: 0, days: [] })
  })

  it('неделя целиком внутри месяца — те же строки и суммы, что у «Истории» недели', () => {
    const week = weekFeed(OPS, { week: '2026-W42' })
    const month = monthFeed(OPS, { month: '2026-10' })
    const inWeek = month.days.filter((d) => d.date >= '2026-10-12' && d.date <= '2026-10-18')
    expect(inWeek).toEqual(week.days)
    // Неделя на стыке месяцев (W40: 28.09–04.10) — в месяц входит только своя часть.
    expect(month.days.some((d) => d.date === '2026-09-29')).toBe(false)
    expect(weekFeed(OPS, { week: '2026-W40' }).count).toBe(2)
  })
})
