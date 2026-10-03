import { describe, expect, it } from 'vitest'
import { isWide, WIDE_RATIO } from './fit'

/** B2C-73: заметно шире квадрата — вписать целиком; квадратные, высокие и битые — на всю плитку. */
describe('lib/photos/fit — isWide', () => {
  it('1200×400 — широкое; 800×800, 600×900 — нет; 0×0 (битая) — нет', () => {
    expect(isWide(1200, 400)).toBe(true)
    expect(isWide(800, 800)).toBe(false)
    expect(isWide(600, 900)).toBe(false)
    expect(isWide(0, 0)).toBe(false)
  })

  it('порог включительно: 1250×1000 — широкое, 1240×1000 — нет', () => {
    expect(WIDE_RATIO).toBe(1.25)
    expect(isWide(1250, 1000)).toBe(true)
    expect(isWide(1240, 1000)).toBe(false)
  })
})
