import { describe, expect, it } from 'vitest'
import { exchangeOfOperation, matchCandidates } from './matching'
import { assignIds } from './model'
import type { Operation } from './types'
import { fxToTenge } from '@/lib/finance'
import type { FxExchange, Payment, Person, RateBook } from '@/types/finance'

// Сопоставление выписки у валютного участника (B2C-80, Р-74): в тенговую выписку приходит обмен, а не
// оклад; ожидаемая сумма зарплаты — тенге месяца (`salaryTenge`). Тенговые участники — без изменений
// (`matching.test.ts`). Числа — ручной расчёт в комментариях.

const book: RateBook = { EUR: { '2026-10-09': 503 } }
const ilyas: Person = { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: '', salaryVersions: [{ from: '2026-01', amount: 1_500, currency: 'EUR', rate: 505.5 }] }
const op = (date: string, amount: number, merchant = 'Kaspi Обмен'): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'transfer-in', merchant, categoryId: null, internal: false,
})
// Пришло 1 500 € на евро-счёт 10.10; обмен 500 € по 515 = 257 500 ₸ 11.10 (Алматы) на Kaspi.
const came: Payment = { id: 's', kind: 'salary', targetId: 'a', period: '2026-10', amount: 754_500, foreign: 1_500, currency: 'EUR', accountId: 'eur', by: 'a', at: '2026-10-10T04:00:00.000Z', updatedAt: '' }
const x1: FxExchange = { id: 'x1', by: 'a', accountId: 'eur', toAccountId: 'kzt', currency: 'EUR', foreign: 500, rate: 515, tenge: fxToTenge(500, 515), period: '2026-10', at: '2026-10-11T05:00:00.000Z', updatedAt: '' }

describe('валютный участник в тенговой выписке', () => {
  it('зачисление 257 300 ₸ против обмена 257 500 ₸ — это обмен: не вопрос и не зарплата', () => {
    const [o] = assignIds([op('2026-10-11', 257_300)])
    expect(exchangeOfOperation(o, [x1], 'a')).toBe(x1)
    // До отметки «Пришла» — обмен тоже не предлагается зарплатой ноября или октября.
    expect(matchCandidates([o], { people: [ilyas], payments: [], fxExchanges: [x1], book }, [], 'a')).toEqual([])
    expect(matchCandidates([o], { people: [ilyas], payments: [came], fxExchanges: [x1], book }, [], 'a')).toEqual([])
  })

  it('обмен не свой, отменён, без зачисления, далеко по дате или сумме — не он', () => {
    const [o] = assignIds([op('2026-10-11', 257_300)])
    expect(exchangeOfOperation(o, [x1], 'b')).toBeNull()
    expect(exchangeOfOperation(o, [{ ...x1, deletedAt: '2026-10-12T00:00:00.000Z' }], 'a')).toBeNull()
    expect(exchangeOfOperation(o, [{ ...x1, toAccountId: null }], 'a')).toBeNull()
    const [far] = assignIds([op('2026-10-25', 257_300)])
    expect(exchangeOfOperation(far, [x1], 'a')).toBeNull()
    // 257 500 × 1,1 = 283 250 — 290 000 вне допуска.
    const [big] = assignIds([op('2026-10-11', 290_000)])
    expect(exchangeOfOperation(big, [x1], 'a')).toBeNull()
  })

  it('оклад в евро не ищется как оклад: приход 1 500 ₸ — не зарплата; приход ≈ тенге месяца (1 500 × 503 = 754 500) — вопрос', () => {
    const list = assignIds([op('2026-10-10', 1_500, 'Работодатель'), op('2026-10-10', 750_000, 'Работодатель')])
    const out = matchCandidates(list, { people: [ilyas], payments: [], fxExchanges: [], book }, [], 'a')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'salary', targetId: 'a', period: '2026-10', amount: 750_000 })
  })
})
