import { describe, expect, it } from 'vitest'
import { amountAt, amountIn, budgetAmounts, debitDayIso, docCurrencies, duesTotals, freedChange, keepCard, keepQuestions, monthDues, monthlyAmount, nextChange, nextObligationDue, subscriptionYearly } from './finance'
import { money } from './money'
import type { Obligation, Payment, RateBook } from '@/types/finance'

// Подписки и платежи в валюте (B2C-81, Р-75): сумма версии — в валюте, тенге — по курсу Нацбанка на
// день списания месяца (выходной — пятница, день впереди — последний курс книги), без книги — курс
// версии. Тенговые — как были. Числа — ручной расчёт в комментариях.

// 10.10.2026 — суббота (курс пятницы 09.10); 05.03.2026 — четверг.
const book: RateBook = { USD: { '2026-03-05': 480, '2026-09-10': 475.2, '2026-10-09': 470.5, '2026-10-12': 471 } }
const T = '2026-09-01T00:00:00.000Z'
const ob = (patch: Partial<Obligation>): Obligation => ({ id: 'o', name: 'Netflix', note: '', day: 10, category: 'd4', versions: [], updatedAt: T, ...patch })
const netflix = ob({ versions: [{ from: '2000-01', amount: 15, currency: 'USD', rate: 472 }] })
const rent = ob({ id: 'rent', name: 'Аренда', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 200_000 }] })

describe('amountAt — сумма месяца в тенге', () => {
  it('тенговое — как записано', () => {
    expect(amountAt(rent, '2026-10', book)).toBe(200_000)
    expect(amountIn(rent, '2026-10')).toEqual({ amount: 200_000, currency: 'KZT' })
  })

  it('доллар по курсу дня списания: сентябрь 15 × 475,2 (10.09) = 7 128 ₸', () => {
    expect(amountAt(netflix, '2026-09', book)).toBe(7_128)
    expect(amountIn(netflix, '2026-09')).toEqual({ amount: 15, currency: 'USD' })
  })

  it('день списания в выходной — пятница: 10.10 (сб) → 09.10, 15 × 470,5 = 7 057,5 → 7 058 ₸', () => {
    expect(debitDayIso(netflix, '2026-10')).toBe('2026-10-10')
    expect(amountAt(netflix, '2026-10', book)).toBe(7_058)
  })

  it('день впереди — последний курс книги: ноябрь, 15 × 471 = 7 065 ₸; без книги — курс версии 15 × 472 = 7 080 ₸', () => {
    expect(amountAt(netflix, '2026-11', book)).toBe(7_065)
    expect(amountAt(netflix, '2026-10')).toBe(7_080)
  })

  it('годовая в валюте — курс дня своего месяца: iCloud $120 5 марта → 120 × 480 = 57 600 ₸, в месяц 4 800 ₸', () => {
    const icloud = ob({ every: 'year', month: 3, day: 5, versions: [{ from: '2000-01', amount: 120, currency: 'USD', rate: 470 }] })
    expect(debitDayIso(icloud, '2026-10')).toBe('2026-03-05')
    expect(amountAt(icloud, '2026-10', book)).toBe(57_600)
    expect(monthlyAmount(icloud, '2026-10', book)).toBe(4_800)
  })

  it('смена валюты версией: 5 000 ₸ до сентября, $15 с октября — 7 058 ₸; разница — в тенге', () => {
    const o = ob({ versions: [{ from: '2000-01', amount: 5_000 }, { from: '2026-10', amount: 15, currency: 'USD', rate: 472 }] })
    expect(amountAt(o, '2026-09', book)).toBe(5_000)
    expect(amountAt(o, '2026-10', book)).toBe(7_058)
    // 7 058 − 5 000 = 2 058 ₸.
    expect(nextChange(o, '2026-09', book)).toMatchObject({ from: '2026-10', amount: 15, currency: 'USD', delta: 2_058 })
    // Обратно — освободится: $15 → 5 000 ₸ с ноября; 7 058 − 5 000 = 2 058 ₸ в месяц.
    const back = ob({ versions: [{ from: '2000-01', amount: 15, currency: 'USD', rate: 472 }, { from: '2026-11', amount: 5_000 }] })
    expect(freedChange([back], '2026-10', book)).toMatchObject({ monthly: 2_058, yearly: 24_696 })
  })
})

describe('платежи месяца и бюджет с валютной подпиской', () => {
  it('октябрь: 200 000 + 7 058 = 207 058 ₸; отмеченная — суммой отметки (7 100): 207 100 ₸', () => {
    const dues = monthDues({ obligations: [rent, netflix], book }, '2026-10')
    expect(dues.map((d) => d.amount)).toEqual([200_000, 7_058])
    expect(duesTotals(dues)).toEqual({ total: 207_058, left: 207_058 })
    const paid: Payment = { id: 'p', kind: 'obligation', targetId: 'o', period: '2026-10', amount: 7_100, accountId: null, by: 'a', at: T, updatedAt: T }
    expect(duesTotals(monthDues({ obligations: [rent, netflix], payments: [paid], book }, '2026-10'))).toEqual({ total: 207_100, left: 200_000 })
  })

  it('бюджет: «Еда и быт» включает подписку в тенге по книге', () => {
    const base = budgetAmounts({ obligations: [rent] }, '2026-10')
    expect(budgetAmounts({ obligations: [rent, netflix], book }, '2026-10').d4 - base.d4).toBe(7_058)
  })

  it('валюты платежей попадают в книгу курсов', () => {
    expect(docCurrencies({ obligations: [netflix, rent] })).toEqual(['USD'])
    expect(docCurrencies({ obligations: [{ ...netflix, deletedAt: T }] })).toEqual([])
  })
})

describe('«дальше» и «оставить подписку?» — по книге, не по курсу версии (ревью frontend Н-2)', () => {
  it('следующий платёж Netflix: ноябрь, 15 × 471 (последний курс книги) = 7 065 ₸; без книги — 15 × 472 = 7 080 ₸', () => {
    const after = { day: 1, key: '2026-11' }
    expect(nextObligationDue(netflix, [], after, book)?.amount).toBe(7_065)
    expect(nextObligationDue(netflix, [], after)?.amount).toBe(7_080)
  })

  it('карточка «оставить?» ежемесячной: октябрь 15 × 470,5 = 7 058 ₸ в месяц, за год 7 058 × 12 = 84 696 ₸', () => {
    expect(subscriptionYearly(netflix, '2026-10', book)).toBe(84_696)
    const card = keepCard(netflix, [], [], { day: 15, key: '2026-10' }, book)
    expect(card.meta).toBe(`${money(7_058)} · каждый месяц`)
    expect(card.inner).toBe(`За год — ${money(84_696)}`)
  })

  it('годовая в валюте — цена продления по книге: iCloud $120 5 марта 2027 (впереди) → 120 × 471 = 56 520 ₸; без книги 120 × 470 = 56 400 ₸', () => {
    const icloud = ob({ id: 'icloud', every: 'year', month: 3, day: 5, versions: [{ from: '2000-01', amount: 120, currency: 'USD', rate: 470 }] })
    expect(keepCard(icloud, [], [], { day: 1, key: '2026-10' }, book).inner).toBe(`За год — ${money(56_520)}`)
    expect(keepCard(icloud, [], [], { day: 1, key: '2026-10' }).inner).toBe(`За год — ${money(56_400)}`)
  })

  it('порядок вопросов — по сумме месяца в тенге по книге: Netflix 7 058 < «Кино» 7 070 (без книги 7 080 > 7 070)', () => {
    const kino = ob({ id: 'kino', name: 'Кино', versions: [{ from: '2000-01', amount: 7_070 }] })
    const now = new Date('2026-10-15T07:00:00.000Z')
    expect(keepQuestions([netflix, kino], now, book).map((o) => o.id)).toEqual(['kino', 'o'])
    expect(keepQuestions([netflix, kino], now).map((o) => o.id)).toEqual(['o', 'kino'])
  })
})
