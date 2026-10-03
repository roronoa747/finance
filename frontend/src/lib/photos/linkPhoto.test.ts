import { describe, expect, it } from 'vitest'
import { bigEnough, MIN_LINK_PHOTO_SIDE } from './linkPhoto'

/** B2C-75: логотип 120×120 и полоска 1200×200 — не фото желания; 300×300 и 800×600 — да. */
describe('lib/photos/linkPhoto — bigEnough', () => {
  it('порог по короткой стороне — 300 px включительно', () => {
    expect(MIN_LINK_PHOTO_SIDE).toBe(300)
    expect(bigEnough(120, 120)).toBe(false)
    expect(bigEnough(1200, 200)).toBe(false)
    expect(bigEnough(299, 1000)).toBe(false)
    expect(bigEnough(300, 300)).toBe(true)
    expect(bigEnough(800, 600)).toBe(true)
  })
})
