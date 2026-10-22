import { describe, expect, it } from 'vitest'
import { HABIT_MIN_AMOUNT, HABIT_MIN_PER_MONTH, habitKeepFrom, habitOf, habitTotals } from './habits'
import type { Operation } from './types'

// Привычки AU-27: правила по продавцу, разделу, чеку и дню; порог месяца; одна привычка на операцию.
let n = 0
const op = (merchant: string, amount: number, categoryId: string | null, date = '2026-09-15', extra: Partial<Operation> = {}): Operation => ({
  id: `o${++n}`, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
// 2026-09-15 — вторник, 2026-09-19 — суббота.
const times = (k: number, make: (i: number) => Operation) => Array.from({ length: k }, (_, i) => make(i))

describe('habitOf — правила привычек', () => {
  it('такси: Yandex Go и inDrive; Yandex Go Power (пауэрбанк) — нет', () => {
    expect(habitOf(op('YANDEX GO', -1_800, 'sc_transport'))).toBe('taxi')
    expect(habitOf(op('INDRIVE ALMATY', -1_200, 'sc_transport'))).toBe('taxi')
    expect(habitOf(op('YANDEX GO POWER', -600, 'sc_transport'))).toBeNull()
  })

  it('кофе: кофейня 1 200 ₸ — да; ресторан 9 000 — нет (и не обед: чек выше 7 000); кофейня 3 500 — не кофе', () => {
    expect(habitOf(op('Espresso Day', -1_200, 'sc_cafe'))).toBe('coffee')
    expect(habitOf(op('Restoran Navat', -9_000, 'sc_cafe'))).toBeNull()
    expect(habitOf(op('Espresso Day', -3_500, 'sc_cafe'))).toBe('lunch')
  })

  it('обед: кафе в будни 1 500–7 000; в субботу — нет; дешевле 1 500 — нет', () => {
    expect(habitOf(op('Askhana Zira', -2_800, 'sc_cafe', '2026-09-15'))).toBe('lunch')
    expect(habitOf(op('Askhana Zira', -2_800, 'sc_cafe', '2026-09-19'))).toBeNull()
    expect(habitOf(op('Askhana Zira', -1_000, 'sc_cafe', '2026-09-15'))).toBeNull()
  })

  it('доставка Wolt — доставка, не обед, и в будни', () => {
    expect(habitOf(op('WOLT.COM', -4_200, 'sc_cafe', '2026-09-15'))).toBe('delivery')
    expect(habitOf(op('YANDEX EDA', -6_000, 'sc_cafe', '2026-09-19'))).toBe('delivery')
  })

  it('маркетплейс: 4 500 — да, 12 000 — нет', () => {
    expect(habitOf(op('Kaspi Magazin', -4_500, 'sc_shopping'))).toBe('marketplace')
    expect(habitOf(op('WILDBERRIES', -12_000, 'sc_shopping'))).toBeNull()
  })

  it('не трата: приход, внутренний перевод, перевод человеку; продавец в чужом разделе — не привычка', () => {
    expect(habitOf(op('YANDEX GO', 1_800, 'sc_transport'))).toBeNull()
    expect(habitOf(op('YANDEX GO', -1_800, 'sc_transport', '2026-09-15', { internal: true }))).toBeNull()
    expect(habitOf(op('Перевод', -3_000, 'sc_cafe', '2026-09-15', { kind: 'transfer-out', counterparty: 'Дана К.' }))).toBeNull()
    expect(habitOf(op('YANDEX GO', -1_800, 'sc_other'))).toBeNull()
  })
})

describe('habitTotals — итоги месяца', () => {
  it('порог: 7 поездок — нет, 8 — да; сумма и счётчик, id участник:месяц:привычка', () => {
    const seven = times(7, () => op('YANDEX GO', -2_000, 'sc_transport'))
    expect(habitTotals(seven, 'a', '2026-09')).toEqual([])
    const eight = [...seven, op('YANDEX GO', -3_000, 'sc_transport')]
    expect(habitTotals(eight, 'a', '2026-09', 'T')).toEqual([
      { id: 'a:2026-09:taxi', by: 'a', period: '2026-09', habit: 'taxi', count: 8, amount: 17_000, updatedAt: 'T' },
    ])
    expect(HABIT_MIN_PER_MONTH.taxi).toBe(8)
  })

  it('доставка — по сумме месяца (Х-12): 3 заказа на 30 000 — привычка, 5 на 15 000 — нет', () => {
    expect(HABIT_MIN_AMOUNT.delivery).toBe(20_000)
    const big = habitTotals(times(3, () => op('WOLT.COM', -10_000, 'sc_cafe', '2026-09-19')), 'b', '2026-09')
    expect(big.map((t) => [t.habit, t.count, t.amount])).toEqual([['delivery', 3, 30_000]])
    expect(habitTotals(times(5, () => op('WOLT.COM', -3_000, 'sc_cafe', '2026-09-19')), 'b', '2026-09')).toEqual([])
    // Граница: ровно 20 000 — привычка, 19 999 — нет.
    expect(habitTotals([op('WOLT.COM', -20_000, 'sc_cafe', '2026-09-19')], 'b', '2026-09').map((t) => t.amount)).toEqual([20_000])
    expect(habitTotals([op('WOLT.COM', -19_999, 'sc_cafe', '2026-09-19')], 'b', '2026-09')).toEqual([])
  })

  it('только операции месяца; операция — в одной привычке (кофе не считается обедом)', () => {
    const ops = [
      ...times(10, () => op('Coffee Boom', -1_500, 'sc_cafe', '2026-09-15')),
      ...times(8, () => op('YANDEX GO', -2_000, 'sc_transport', '2026-08-10')),
    ]
    const sep = habitTotals(ops, 'b', '2026-09')
    expect(sep.map((t) => [t.habit, t.count, t.amount])).toEqual([['coffee', 10, 15_000]])
    expect(habitTotals(ops, 'b', '2026-08').map((t) => t.habit)).toEqual(['taxi'])
  })

  it('в итоге только счётчик и сумма — ни продавцов, ни дат', () => {
    const [t] = habitTotals(times(8, () => op('YANDEX GO', -2_000, 'sc_transport')), 'a', '2026-09')
    expect(Object.keys(t).sort()).toEqual(['amount', 'by', 'count', 'habit', 'id', 'period', 'updatedAt'])
    expect(JSON.stringify(t)).not.toMatch(/yandex|2026-09-15/i)
  })

  it('habitKeepFrom: 4 месяца от последнего', () => {
    expect(habitKeepFrom(['2026-05', '2026-09', '2026-07'])).toBe('2026-06')
    expect(habitKeepFrom([])).toBeNull()
  })
})

describe('«Мне вернули» в привычках (FB-02, Р-12)', () => {
  it('частичный возврат — сумма без него; полный — не привычка', () => {
    const rides = times(12, (i) => op('YANDEX GO', -2_000, 'sc_transport', `2026-09-${String(i + 1).padStart(2, '0')}`))
    const base = habitTotals(rides, 'a', '2026-09', 'T').find((t) => t.habit === 'taxi')!
    const partial = rides.map((o, i) => (i === 0 ? { ...o, refund: { amount: 500 } } : o))
    expect(habitTotals(partial, 'a', '2026-09', 'T').find((t) => t.habit === 'taxi')).toMatchObject({ count: base.count, amount: base.amount - 500 })
    const full = rides.map((o, i) => (i === 0 ? { ...o, refund: { amount: 2_000 } } : o))
    expect(habitTotals(full, 'a', '2026-09', 'T').find((t) => t.habit === 'taxi')).toMatchObject({ count: base.count - 1, amount: base.amount - 2_000 })
  })
})
