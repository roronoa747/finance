import { describe, expect, it } from 'vitest'
import { closerDays, closerThisMonth, goalPace } from './finance'

/** PN-09 (Р-15): темп взносов, «ближе на N дней» — целые дни, 30,4 дня в месяце. */
const mv = (date: string, amount: number) => ({ id: date + amount, date, amount, by: 'a' as const })

describe('PN-09: goalPace / closerDays / closerThisMonth', () => {
  it('goalPace — план взноса, если он есть; без плана — среднее положительных движений за три месяца (сумма / 3); ничего — 0', () => {
    expect(goalPace({ monthly: 50_000, movements: [mv('2026-09-01', 999_999)] }, '2026-09')).toBe(50_000)
    // Июль + август + сентябрь: 60 000 + 30 000 + 0 → 30 000 в месяц; июнь и снятия не считаются.
    const movements = [mv('2026-06-15', 100_000), mv('2026-07-10T05:00:00.000Z', 60_000), mv('2026-08-20', 30_000), mv('2026-09-05', -10_000)]
    expect(goalPace({ monthly: 0, movements }, '2026-09')).toBe(30_000)
    expect(goalPace({ monthly: 0, movements: [] }, '2026-09')).toBe(0)
    expect(goalPace({ monthly: 0 }, '2026-09')).toBe(0)
  })

  it('closerDays — 100 000 при темпе 50 000 → 61 день; целые; без темпа или взноса — null', () => {
    expect(closerDays(100_000, 50_000)).toBe(61)
    expect(closerDays(50_000, 50_000)).toBe(30)
    expect(closerDays(10_000, 60_000)).toBe(5)
    expect(closerDays(100_000, 0)).toBeNull()
    expect(closerDays(0, 50_000)).toBeNull()
    expect(closerDays(-5_000, 50_000)).toBeNull()
    expect(Number.isInteger(closerDays(123_456, 78_901)!)).toBe(true)
  })

  it('closerThisMonth — только положительные движения месяца при темпе цели; снятия и другие месяцы не считаются', () => {
    const goal = { monthly: 60_000, movements: [mv('2026-09-03', 70_000), mv('2026-09-20T18:30:00.000Z', 30_000), mv('2026-09-25', -20_000), mv('2026-08-30', 500_000)] }
    // 100 000 / 60 000 × 30,4 = 50,67 → 51.
    expect(closerThisMonth(goal, '2026-09')).toBe(51)
    expect(closerThisMonth({ monthly: 60_000, movements: [mv('2026-08-30', 500_000)] }, '2026-09')).toBeNull()
    expect(closerThisMonth({ monthly: 0, movements: [mv('2026-09-03', 30_000)] }, '2026-09')).toBe(Math.round((30_000 / 10_000) * 30.4))
  })
})
