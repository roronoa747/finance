import { describe, it, expect } from 'vitest'
import { DEFAULT_SPEND_CATEGORIES, plannedElsewhere } from './dictionary'
import { STAT_BASE, STAT_CONSUMER_TOTAL, STAT_NORMS, STAT_SOURCE } from './norms'

/** B2C-59 (Р-57): ориентир долей — из статистики РК, разделы словаря, целые, сумма ≤ 100. */
describe('lib/statements/norms — ориентир долей трат', () => {
  it('ключи — существующие разделы трат (не «Обязательное»), значения целые, сумма ≤ 100', () => {
    const ids = DEFAULT_SPEND_CATEGORIES.map((c) => c.id)
    for (const [id, share] of Object.entries(STAT_NORMS)) {
      expect(ids).toContain(id)
      expect(plannedElsewhere(id, [])).toBe(false)
      expect(Number.isInteger(share) && share > 0).toBe(true)
    }
    expect(Object.values(STAT_NORMS).reduce((a, v) => a + v, 0)).toBeLessThanOrEqual(100)
    for (const id of Object.keys(STAT_SOURCE)) expect(ids).toContain(id)
  })

  it('доли — ручной расчёт по суммам источника (тенге на душу в год, 2025)', () => {
    // База: 1 181 437 − (72 051 + 43 102 + 9 332) = 1 056 952.
    expect(STAT_BASE).toBe(1_056_952)
    expect(STAT_CONSUMER_TOTAL).toBe(1_181_437)
    // Продукты: 618 539 + 6 429 + 18 669 = 643 637 → 60,9 % → 61; кафе: 26 821 + 10 285 = 37 106 → 3,5 % → 4.
    expect(STAT_NORMS).toEqual({
      sc_food: 61,
      sc_cafe: 4,
      sc_transport: 7, // 78 859 → 7,46 %
      sc_health: 3, // 36 211 → 3,43 %
      sc_home: 9, // 90 072 → 8,52 %
      sc_shopping: 9, // 98 137 → 9,29 %
      sc_fun: 2, // 20 970 → 1,98 %
      sc_education: 2, // 17 669 → 1,67 %
    })
    // Путешествия (гостиницы 314 ₸) — 0 %, черты нет; переводов людям, наличных, комиссий в источнике нет.
    for (const id of ['sc_travel', 'sc_people', 'sc_cash', 'sc_fees', 'sc_other']) expect(id in STAT_NORMS).toBe(false)
  })
})
