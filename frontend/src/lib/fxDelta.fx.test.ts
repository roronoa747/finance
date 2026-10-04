import { describe, expect, it } from 'vitest'
import { fxMonthDelta, fxYearDelta, paydayRates, rateSeries } from './finance'
import type { Person, RateBook } from '@/types/finance'

// «Курс за год» (B2C-82, Р-76): оклад месяца в валюте × (курс на день зарплаты − курс дня зарплаты
// год назад), каждая сторона — fxToTenge. Числа — ручной расчёт в комментариях.

// 10.10.2025 — пятница; 10.10.2026 — суббота (курс пятницы 09.10).
const book: RateBook = {
  EUR: { '2025-10-10': 622.23, '2026-03-10': 590, '2026-09-10': 511.4, '2026-10-09': 488.23 },
}
const ilyas: Person = { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: '', salaryVersions: [{ from: '2025-01', amount: 1_500, currency: 'EUR', rate: 505 }] }

describe('fxYearDelta', () => {
  it('евро упал на 134 ₸ при окладе 1 500 €: 1 500 × 488,23 = 732 345 − 1 500 × 622,23 = 933 345 → −201 000 ₸', () => {
    // День зарплаты 10.10.2026 — суббота: курс пятницы 09.10 (488,23).
    expect(fxYearDelta(ilyas, '2026-10', book)).toEqual({ currency: 'EUR', rateNow: 488.23, rateThen: 622.23, perUnit: -134, tenge: -201_000 })
  })

  it('рост — плюс: курс 2026-10 выше прошлогоднего на 10,5 → 1 500 × 10,5 = +15 750 ₸', () => {
    const up: RateBook = { EUR: { '2025-10-10': 500, '2026-10-09': 510.5 } }
    expect(fxYearDelta(ilyas, '2026-10', up)).toMatchObject({ perUnit: 11, tenge: 15_750 })
  })

  it('нет курса год назад (книга короче) — null; тенговый оклад — null', () => {
    expect(fxYearDelta(ilyas, '2026-10', { EUR: { '2026-10-09': 488.23 } })).toBeNull()
    expect(fxYearDelta({ ...ilyas, salaryVersions: undefined, salary: 700_000 }, '2026-10', book)).toBeNull()
  })

  it('против любого месяца: «в марте по 590 ₸ · было бы» 1 500 × 590 = 885 000 − 732 345 = +152 655 ₸', () => {
    expect(fxMonthDelta(ilyas, '2026-10', '2026-03', book)).toEqual({ currency: 'EUR', rateNow: 488.23, rate: 590, perUnit: 102, tenge: 152_655 })
  })
})

describe('данные листа', () => {
  it('дни зарплаты 12 месяцев (старые первыми), месяц без дня в книге — курс последнего дня до него', () => {
    const list = paydayRates(ilyas, '2026-10', book)
    expect(list).toHaveLength(12)
    // «было бы» по курсу октября 2025: 933 345 − 732 345 = +201 000 ₸.
    expect(list[0]).toEqual({ key: '2025-10', day: '2025-10-10', rate: 622.23, tenge: 201_000 })
    // Ноябрь 2025 — в книге только 10.10.2025: тот же курс.
    expect(list[1]).toMatchObject({ key: '2025-11', rate: 622.23 })
    expect(list.at(-1)).toMatchObject({ key: '2026-09', rate: 511.4 })
  })

  it('линия — дни книги в периоде по порядку', () => {
    expect(rateSeries(book, 'EUR', '2026-01-01', '2026-10-10').map((x) => x.day)).toEqual(['2026-03-10', '2026-09-10', '2026-10-09'])
    expect(rateSeries(null, 'EUR', '2026-01-01', '2026-10-10')).toEqual([])
  })
})
