import { describe, expect, it } from 'vitest'
import { money, moneyShort, parseMoney, plain } from './money'

/** Ожидание с обычными пробелами → неразрывные, как печатает `money`. */
const nb = (s: string) => s.replace(/ /g, '\u00a0')

describe('money — знак минуса (ревью Блока 3, Н-2)', () => {
  it('отрицательные деньги печатаются типографским «−», не дефисом', () => {
    expect(money(-1903408)).toBe(nb('−1 903 408 ₸'))
    expect(plain(-5000)).toBe(nb('−5 000'))
    expect(moneyShort(-2_500_000)).toBe(nb('−2,5 млн ₸'))
    expect(moneyShort(-350_000)).toBe(nb('−350 тыс. ₸'))
    expect(moneyShort(-5_000)).toBe(nb('−5 000 ₸'))
    for (const s of [money(-1903408), moneyShort(-2_500_000), moneyShort(-350_000)]) expect(s).not.toContain('-')
  })

  it('положительные — без знака', () => {
    expect(money(1050000)).toBe(nb('1 050 000 ₸'))
  })

  it('parseMoney понимает и «−», и дефис', () => {
    expect(parseMoney('−5 000')).toBe(-5000)
    expect(parseMoney('-5 000')).toBe(-5000)
    expect(parseMoney(money(-1903408))).toBe(-1903408)
    expect(parseMoney('1 050 000 ₸')).toBe(1050000)
  })
})
