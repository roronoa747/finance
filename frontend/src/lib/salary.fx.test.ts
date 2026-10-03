import { describe, expect, it } from 'vitest'
import { budgetAmounts, docCurrencies, nextSalaryChange, paydayIso, salaryAt, salaryOf, totalIncome } from './finance'
import type { Person, RateBook } from '@/types/finance'

// Оклад в валюте (B2C-78, Р-70, Р-72): сумма версии — в валюте, тенге — по курсу дня зарплаты
// месяца из книги, без книги — по курсу версии на момент ввода. Числа — ручной расчёт.

// Сентябрь 2026: 10-е — четверг, 11-е — пятница, 12–13 — выходные (Нацбанк в книге — по рабочим дням).
const book: RateBook = {
  EUR: {
    '2025-10-10': 622.5,
    '2026-04-10': 560,
    '2026-09-09': 510.12,
    '2026-09-10': 511.4,
    '2026-09-11': 512,
    '2026-09-14': 513.3,
  },
}

const person = (patch: Partial<Person> = {}): Person => ({ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '', ...patch })
const eur = (from: string, amount = 1_500, rate = 505.5) => ({ from, amount, currency: 'EUR' as const, rate })

describe('salaryOf / salaryAt — оклад в валюте', () => {
  it('тенговый оклад — как был: версия или salary', () => {
    expect(salaryAt(person(), '2026-09', book)).toBe(700_000)
    expect(salaryOf(person(), '2026-09')).toEqual({ amount: 700_000, currency: 'KZT' })
    const p = person({ salaryVersions: [{ from: '2000-01', amount: 700_000 }, { from: '2026-10', amount: 800_000 }] })
    expect(salaryAt(p, '2026-09')).toBe(700_000)
    expect(salaryAt(p, '2026-10', book)).toBe(800_000)
  })

  it('евро — по курсу Нацбанка на день зарплаты: 1 500 € × 511,40 (10.09) = 767 100 ₸', () => {
    const p = person({ salaryVersions: [eur('2025-10')] })
    expect(salaryOf(p, '2026-09')).toEqual({ amount: 1_500, currency: 'EUR', rate: 505.5 })
    expect(salaryAt(p, '2026-09', book)).toBe(767_100)
  })

  it('день зарплаты в выходной — курс пятницы: 13.09 (вс) → 11.09, 1 500 × 512 = 768 000 ₸', () => {
    const p = person({ payday: 13, salaryVersions: [eur('2025-10')] })
    expect(paydayIso(p, '2026-09')).toBe('2026-09-13')
    expect(salaryAt(p, '2026-09', book)).toBe(768_000)
  })

  it('без книги или дня в ней — курс версии: 1 500 × 505,5 = 758 250 ₸', () => {
    const p = person({ salaryVersions: [eur('2025-10')] })
    expect(salaryAt(p, '2026-09')).toBe(758_250)
    expect(salaryAt(p, '2026-09', {})).toBe(758_250)
    // Месяц раньше начала книги (Р-72): снимок курса версии.
    expect(salaryAt(person({ salaryVersions: [eur('2025-01')] }), '2025-02', book)).toBe(758_250)
  })

  it('смена валюты версией: тенге до марта, евро с апреля — 1 500 × 560 (10.04) = 840 000 ₸', () => {
    const p = person({ salaryVersions: [{ from: '2000-01', amount: 700_000 }, eur('2026-04')] })
    expect(salaryAt(p, '2026-03', book)).toBe(700_000)
    expect(salaryAt(p, '2026-04', book)).toBe(840_000)
    expect(salaryOf(p, '2026-03').currency).toBe('KZT')
  })

  it('задним числом: прошлые месяцы пересчитаны, текущий (своя версия) — нет', () => {
    const before = person({ salaryVersions: [{ from: '2000-01', amount: 700_000 }, { from: '2026-10', amount: 800_000 }] })
    const after = { ...before, salaryVersions: [...before.salaryVersions!, eur('2025-10')].sort((a, b) => a.from.localeCompare(b.from)) }
    // Октябрь 2025: 1 500 × 622,5 = 933 750 ₸; сентябрь 2026: 767 100 ₸; октябрь 2026 — прежние 800 000 ₸.
    expect(salaryAt(after, '2025-10', book)).toBe(933_750)
    expect(salaryAt(after, '2026-09', book)).toBe(767_100)
    expect(salaryAt(after, '2026-10', book)).toBe(800_000)
    expect(salaryAt(after, '2025-09', book)).toBe(700_000)
  })

  it('месяц, где день зарплаты ещё не наступил, — последний курс книги: 1 500 × 513,3 (14.09) = 769 950 ₸', () => {
    expect(salaryAt(person({ salaryVersions: [eur('2025-10')] }), '2026-10', book)).toBe(769_950)
  })

  it('доход семьи и бюджет — тенге по книге; без книги — по курсу версии', () => {
    const people = [person({ salaryVersions: [eur('2025-10')] }), person({ id: 'b', name: 'Аруна', salary: 500_000, payday: 20 })]
    // 767 100 + 500 000 = 1 267 100 ₸; без книги — 758 250 + 500 000 = 1 258 250 ₸.
    expect(totalIncome(people, '2026-09', book)).toBe(1_267_100)
    expect(totalIncome(people, '2026-09')).toBe(1_258_250)
    expect(budgetAmounts({ people, book }, '2026-09').income).toBe(1_267_100)
    expect(budgetAmounts({ people }, '2026-09').income).toBe(1_258_250)
  })

  it('ближайшее изменение в валюте: сумма в евро, разница — в тенге', () => {
    const p = person({ salaryVersions: [{ from: '2000-01', amount: 700_000 }, eur('2026-11', 1_600)] })
    const next = nextSalaryChange(p, '2026-09', book)!
    // 1 600 × 513,3 = 821 280 ₸ (ноябрь — последний курс книги) − 700 000 = 121 280 ₸.
    expect(next).toMatchObject({ from: '2026-11', amount: 1_600, currency: 'EUR', delta: 121_280 })
  })

  it('валюты окладов попадают в книгу курсов', () => {
    expect(docCurrencies({ people: [person({ salaryVersions: [eur('2025-10'), { from: '2027-01', amount: 9_000, currency: 'USD', rate: 470 }] }), person({ id: 'b' })] })).toEqual(['EUR', 'USD'])
    expect(docCurrencies({ people: [person({ deletedAt: '2026-09-01', salaryVersions: [eur('2025-10')] })] })).toEqual([])
  })
})
