import { describe, expect, it } from 'vitest'
import { addDaysIso, isoIn, shiftIsoMonths, todayIso } from './dates'
import { docCurrencies, fxToTenge, rateOn } from './finance'
import { BOOK_MONTHS, CURRENCIES, CURRENCY_SIGN, bookWindow, demoRateBook } from './fx'
import type { Account, RateBook } from '@/types/finance'

// Книга курсов (B2C-77, Р-72): даты книги, курс на день, валюты документа, демо-книга.

describe('даты книги курсов', () => {
  it('todayIso — дата по Алматы: 20:30 UTC 30 сентября — уже 1 октября', () => {
    expect(todayIso(new Date('2026-09-30T20:30:00Z'))).toBe('2026-10-01')
    expect(todayIso(new Date('2026-09-30T18:59:00Z'))).toBe('2026-09-30')
  })

  it('addDaysIso — через границы месяца и года', () => {
    expect(addDaysIso('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('shiftIsoMonths — 31-е в коротком месяце — его последний день', () => {
    expect(shiftIsoMonths('2026-10-03', -13)).toBe('2025-09-03')
    expect(shiftIsoMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(shiftIsoMonths('2026-10-31', -12)).toBe('2025-10-31')
  })

  it('isoIn — день зарплаты обрезается по длине месяца', () => {
    expect(isoIn('2026-09', 31)).toBe('2026-09-30')
    expect(isoIn('2026-02', 30)).toBe('2026-02-28')
    expect(isoIn('2026-10', 5)).toBe('2026-10-05')
  })

  it('bookWindow — 13 месяцев до сегодня, не длиннее 400 дней ручки', () => {
    const w = bookWindow('2026-10-03')
    expect(w).toEqual({ from: '2025-09-03', to: '2026-10-03' })
    const days = (Date.parse(w.to) - Date.parse(w.from)) / 86_400_000 + 1
    expect(BOOK_MONTHS).toBe(13)
    expect(days).toBeLessThanOrEqual(400)
  })
})

describe('rateOn — курс на день по книге', () => {
  // Пятница 25.09 — 513,46; суббота и воскресенье в книге отсутствуют; понедельник 28.09 — 515,10.
  const book: RateBook = { EUR: { '2026-09-24': 512.8, '2026-09-25': 513.46, '2026-09-28': 515.1 } }

  it('точный день', () => {
    expect(rateOn(book, 'EUR', '2026-09-25')).toBe(513.46)
    expect(rateOn(book, 'EUR', '2026-09-28', 400)).toBe(515.1)
  })

  it('выходной — курс пятницы', () => {
    expect(rateOn(book, 'EUR', '2026-09-26')).toBe(513.46)
    expect(rateOn(book, 'EUR', '2026-09-27', 400)).toBe(513.46)
  })

  it('после конца книги — последний известный день', () => {
    expect(rateOn(book, 'EUR', '2026-10-15')).toBe(515.1)
  })

  it('до начала книги → fallback → null', () => {
    expect(rateOn(book, 'EUR', '2026-09-01', 505.5)).toBe(505.5)
    expect(rateOn(book, 'EUR', '2026-09-01')).toBeNull()
    expect(rateOn(book, 'EUR', '2026-09-01', 0)).toBeNull()
    expect(rateOn(book, 'USD', '2026-09-25', 447.85)).toBe(447.85)
    expect(rateOn(null, 'USD', '2026-09-25')).toBeNull()
    expect(rateOn(undefined, 'EUR', '2026-09-25', 500)).toBe(500)
  })

  it('KZT → 1 при любой книге', () => {
    expect(rateOn(book, 'KZT', '2026-09-25')).toBe(1)
    expect(rateOn(null, 'KZT', '2000-01-01')).toBe(1)
  })

  it('тенге по курсу дня — только через fxToTenge: 1 500 € × 513,46 = 770 190 ₸', () => {
    expect(fxToTenge(1_500, rateOn(book, 'EUR', '2026-09-27')!)).toBe(770_190)
  })
})

describe('docCurrencies — валюты документа для книги', () => {
  const acc = (id: string, currency?: Account['currency'], deletedAt?: string): Account =>
    ({ id, name: id, note: '', amount: 0, kind: 'card', currency, deletedAt }) as Account

  it('живые валютные счета, без тенге и повторов, по алфавиту', () => {
    expect(docCurrencies({ accounts: [acc('a', 'USD'), acc('b'), acc('c', 'EUR'), acc('d', 'USD'), acc('e', 'KZT'), acc('f', 'CNY', '2026-09-01')] })).toEqual(['EUR', 'USD'])
    expect(docCurrencies({})).toEqual([])
  })
})

describe('валюты и демо-книга', () => {
  it('одна таблица: пять валют, у каждой знак; CNY — ¥', () => {
    expect(CURRENCIES).toEqual(['KZT', 'USD', 'EUR', 'RUB', 'CNY'])
    expect(CURRENCIES.map((c) => CURRENCY_SIGN[c])).toEqual(['₸', '$', '€', '₽', '¥'])
  })

  it('демо: евро и доллар на каждый день 13 месяцев, евро дешевеет с ~640 до ~506', () => {
    const book = demoRateBook('2026-10-03')
    const days = Object.keys(book.EUR!).sort()
    expect(days[0]).toBe('2025-09-03')
    expect(days.at(-1)).toBe('2026-10-03')
    expect(days.length).toBe(Object.keys(book.USD!).length)
    expect(days.length).toBe(396)
    expect(Math.abs(book.EUR!['2025-09-03'] - 640)).toBeLessThan(3)
    expect(Math.abs(book.EUR!['2026-10-03'] - 506)).toBeLessThan(3)
    for (const v of [...Object.values(book.EUR!), ...Object.values(book.USD!)]) {
      expect(v).toBeGreaterThan(0)
      expect(Math.round(v * 100) / 100).toBe(v)
    }
    // Тот же день — та же книга (демо-цифры не прыгают между открытиями).
    expect(demoRateBook('2026-10-03')).toEqual(book)
  })
})
