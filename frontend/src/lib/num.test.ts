import { describe, it, expect } from 'vitest'
import { numChanged } from './num'

describe('lib/num.ts — numChanged: коммитить ли поле', () => {
  it('то же значение в другом виде — не изменение', () => {
    expect(numChanged('150 000', '150000', 'money')).toBe(false)
    expect(numChanged('150000', 150_000, 'money')).toBe(false)
    expect(numChanged('150 000', '150 000', 'money')).toBe(false)
    expect(numChanged('10', 10, 'int')).toBe(false)
    expect(numChanged('17,5', '17.5', 'rate')).toBe(false)
    expect(numChanged('17,50', '17,5', 'rate')).toBe(false)
    expect(numChanged('', '', 'money')).toBe(false)
  })

  it('другое значение — изменение', () => {
    expect(numChanged('160 000', '150 000', 'money')).toBe(true)
    expect(numChanged('0', '150 000', 'money')).toBe(true)
    expect(numChanged('', '150 000', 'money')).toBe(true)
    expect(numChanged('11', '10', 'int')).toBe(true)
    expect(numChanged('17,6', '17,5', 'rate')).toBe(true)
  })
})
