import { describe, expect, it } from 'vitest'
import freedom01 from '../fixtures/freedom-01.rows.json'
import kaspi01 from '../fixtures/kaspi-01.rows.json'
import { detectBank, parseStatement, StatementFormatError } from './index'

describe('реестр парсеров', () => {
  it('Kaspi → kaspi, Freedom → freedom, пустые строки → null', () => {
    expect(detectBank(kaspi01)).toBe('kaspi')
    expect(detectBank(freedom01)).toBe('freedom')
    expect(detectBank([])).toBeNull()
    expect(detectBank([{ page: 1, y: 700, cells: [{ x: 40, text: 'Halyk Bank' }] }])).toBeNull()
  })

  it('parseStatement выбирает парсер по строкам; незнакомый файл — unknown-bank', () => {
    expect(parseStatement(kaspi01).bank).toBe('kaspi')
    expect(parseStatement(freedom01).bank).toBe('freedom')
    expect(() => parseStatement([])).toThrow(StatementFormatError)
    expect(() => parseStatement([])).toThrow(expect.objectContaining({ code: 'unknown-bank' }))
  })
})
