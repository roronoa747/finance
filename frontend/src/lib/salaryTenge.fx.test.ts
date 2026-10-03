import { describe, expect, it } from 'vitest'
import { budgetAmounts, fxToTenge, monthBreakdown, paidTenge, salaryAt, salaryTenge, totalIncome, untilPayday } from './finance'
import type { FxExchange, Payment, Person, RateBook } from '@/types/finance'

// Тенге зарплаты месяца (B2C-80, Р-74): обменянное — по своему курсу, необменянное — по курсу
// Нацбанка на день зарплаты, до прихода — весь оклад по курсу (день впереди — последний курс книги).
// Числа — ручной расчёт в комментариях.

// 10.09.2026 — четверг; 10.10.2026 — суббота (курс пятницы 09.10); последний день книги — 12.10.
const book: RateBook = { EUR: { '2026-09-10': 511.4, '2026-10-09': 503, '2026-10-12': 504 } }

const ilyas: Person = { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: '', salaryVersions: [{ from: '2026-08', amount: 1_500, currency: 'EUR', rate: 505.5 }] }
const aruna: Person = { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: '' }

const came = (period: string, extra: Partial<Payment> = {}): Payment => ({
  id: `s-${period}`, kind: 'salary', targetId: 'a', period, amount: 754_470, foreign: 1_500, currency: 'EUR', accountId: 'eur', by: 'a',
  at: `${period}-10T06:00:00.000Z`, updatedAt: `${period}-10T06:00:00.000Z`, ...extra,
})
const ex = (id: string, period: string, foreign: number, rate: number, extra: Partial<FxExchange> = {}): FxExchange => ({
  id, by: 'a', accountId: 'eur', toAccountId: 'kzt', currency: 'EUR', foreign, rate, tenge: fxToTenge(foreign, rate), period,
  at: `${period}-11T08:00:00.000Z`, updatedAt: `${period}-11T08:00:00.000Z`, ...extra,
})

describe('salaryTenge — тенге зарплаты месяца', () => {
  it('тенговый оклад — как salaryAt, отметка с премией не меняет', () => {
    const bonus: Payment = { ...came('2026-10'), targetId: 'b', by: 'b', amount: 650_000, foreign: undefined, currency: undefined }
    for (const key of ['2026-09', '2026-10']) expect(salaryTenge(aruna, key, { book, payments: [bonus] }).tenge).toBe(salaryAt(aruna, key))
    expect(salaryTenge(aruna, '2026-10').tenge).toBe(500_000)
  })

  it('евро до прихода — по последнему курсу книги: ноябрь, 1 500 × 504 (12.10) = 756 000 ₸', () => {
    const t = salaryTenge(ilyas, '2026-11', { book })
    expect(t).toMatchObject({ tenge: 756_000, exchanged: 0, left: 1_500, rate: 504, rateDay: '2026-11-10' })
  })

  it('пришла без обмена — курс дня зарплаты: сентябрь, 1 500 × 511,40 (10.09) = 767 100 ₸', () => {
    expect(salaryTenge(ilyas, '2026-09', { book, payments: [came('2026-09')] }).tenge).toBe(767_100)
  })

  it('два обмена и остаток: 500 × 515 = 257 500 + 300 × 512,5 = 153 750 + 700 × 503 (пятница 09.10) = 352 100 → 763 350 ₸', () => {
    const t = salaryTenge(ilyas, '2026-10', { book, payments: [came('2026-10')], exchanges: [ex('x1', '2026-10', 500, 515), ex('x2', '2026-10', 300, 512.5)] })
    expect(t).toEqual({ tenge: 763_350, currency: 'EUR', exchanged: 800, exchangedTenge: 411_250, left: 700, rate: 503, rateDay: '2026-10-10' })
  })

  it('обменяли больше прихода — необменянного 0, тенге — сумма обменов: 1 000 × 515 + 600 × 510 = 821 000 ₸', () => {
    const t = salaryTenge(ilyas, '2026-10', { book, payments: [came('2026-10')], exchanges: [ex('x1', '2026-10', 1_000, 515), ex('x2', '2026-10', 600, 510)] })
    expect(t).toMatchObject({ tenge: 821_000, exchanged: 1_600, left: 0 })
  })

  it('отменённый обмен и обмен другого месяца не считаются', () => {
    const xs = [ex('x1', '2026-10', 500, 515, { deletedAt: '2026-10-12T00:00:00.000Z' }), ex('x2', '2026-09', 300, 512)]
    // 1 500 × 503 = 754 500 ₸.
    expect(salaryTenge(ilyas, '2026-10', { book, payments: [came('2026-10')], exchanges: xs }).tenge).toBe(754_500)
  })

  it('пришла в тенге (выписка тенгового счёта — банк уже обменял) — сумма отметки', () => {
    const tenge = came('2026-10', { amount: 760_000, foreign: undefined, currency: undefined, accountId: null, source: 'statement' })
    expect(salaryTenge(ilyas, '2026-10', { book, payments: [tenge] }).tenge).toBe(760_000)
    expect(paidTenge({ people: [ilyas], payments: [tenge], book }, 'a', '2026-10', tenge)).toBe(760_000)
  })

  it('без книги — курс версии: 1 500 × 505,5 = 758 250 ₸', () => {
    expect(salaryTenge(ilyas, '2026-10').tenge).toBe(758_250)
  })
})

describe('тенге зарплаты в расчётах — таблица на два месяца', () => {
  // Сентябрь: пришло 1 500 €, обменял 1 000 по 512 = 512 000 ₸, остаток 500 × 511,40 = 255 700 ₸ → 767 700 ₸.
  // Октябрь: пришло 1 500 €, обмены 257 500 + 153 750, остаток 700 × 503 = 352 100 ₸ → 763 350 ₸.
  const payments = [came('2026-09'), came('2026-10')]
  const fxExchanges = [ex('s1', '2026-09', 1_000, 512), ex('o1', '2026-10', 500, 515), ex('o2', '2026-10', 300, 512.5)]
  const state = { people: [ilyas, aruna], payments, fxExchanges, book }

  it('доход семьи и бюджет: сентябрь 767 700 + 500 000 = 1 267 700 ₸, октябрь 763 350 + 500 000 = 1 263 350 ₸', () => {
    expect(totalIncome(state.people, '2026-09', { book, payments, exchanges: fxExchanges })).toBe(1_267_700)
    expect(budgetAmounts(state, '2026-09').income).toBe(1_267_700)
    expect(budgetAmounts(state, '2026-10').income).toBe(1_263_350)
  })

  it('пришедшая валютная зарплата — тенге по Р-74, не снимок отметки (754 470)', () => {
    expect(paidTenge(state, 'a', '2026-10', payments[1])).toBe(763_350)
  })

  it('разбор месяца: зарплата Ильяса — 763 350 ₸; ждём Аруну — 500 000 ₸; разбор Аруны ждёт Ильяса — 763 350 ₸', () => {
    const ctx = { key: '2026-10', totals: [], spendCategories: [], uploads: [] }
    expect(monthBreakdown(state, ctx, { from: 'salary', person: 'a', period: '2026-10' })).toMatchObject({ amount: 763_350, expected: 500_000 })
    const paidB: Payment = { ...came('2026-10'), id: 'sb', targetId: 'b', by: 'b', amount: 500_000, foreign: undefined, currency: undefined }
    expect(monthBreakdown({ ...state, payments: [...payments, paidB] }, ctx, { from: 'salary', person: 'b', period: '2026-10' })).toMatchObject({ amount: 500_000, expected: 763_350 })
  })

  it('«до зарплаты» — следующая зарплата Ильяса (ноябрь) по последнему курсу: 1 500 × 504 = 756 000 ₸', () => {
    const near = untilPayday({ ...state, people: [ilyas] }, { key: '2026-10', day: 15 })!
    expect(near).toMatchObject({ key: '2026-11', income: 756_000 })
  })
})
