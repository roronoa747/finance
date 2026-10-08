import { describe, it, expect } from 'vitest'
import { clean, fxRounds, fxWhole, moneyKind, numChanged } from './num'
import { parseMoney } from './money'

const NB = ' '

/** ML-09 (Р-13, хвост 1000): сумма в валюте принимает дробь и сохраняется целым — `Math.round`. */
describe('lib/num.ts — поле суммы в валюте (fx)', () => {
  it('целое по Math.round: 9,99 → 10, 9.49 → 9, 1 000,5 → 1001', () => {
    expect(fxWhole('9,99')).toBe(10)
    expect(fxWhole('9.49')).toBe(9)
    expect(fxWhole(`1${NB}000,5`)).toBe(1001)
    expect(fxWhole('15')).toBe(15)
    expect(fxWhole('')).toBe(0)
    expect(parseMoney('9,99')).toBe(10)
    expect(parseMoney(`1${NB}000,5`)).toBe(1001)
  })

  it('ввод: одна запятая (точка → запятая), вторая отбрасывается, до двух знаков, разряды', () => {
    expect(clean('9,9,9', 'fx')).toBe('9,99')
    expect(clean('9.99', 'fx')).toBe('9,99')
    expect(clean('9,999', 'fx')).toBe('9,99')
    expect(clean('1000,5', 'fx')).toBe(`1${NB}000,5`)
    expect(clean('007', 'fx')).toBe('7')
    expect(fxRounds('9,99')).toBe(true)
    expect(fxRounds('9,')).toBe(false)
    expect(fxRounds('10')).toBe(false)
  })

  it('тенге (money) — как было: без запятой; вид поля по валюте', () => {
    expect(clean('9,99', 'money')).toBe('999')
    expect(parseMoney('1 050 000 ₸')).toBe(1_050_000)
    expect(parseMoney('−5 000')).toBe(-5000)
    expect(moneyKind('USD')).toBe('fx')
    expect(moneyKind('KZT')).toBe('money')
    expect(moneyKind(null)).toBe('money')
  })

  it('уход из поля без изменения целого — не правка', () => {
    expect(numChanged('10,2', '10', 'fx')).toBe(false)
    expect(numChanged('10,6', '10', 'fx')).toBe(true)
  })
})
