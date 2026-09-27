import { describe, it, expect } from 'vitest'
import { MAX_SIDE, MIN_QUALITY, TARGET_BYTES, compressImage, fitSize, nextQuality, outputType, pickQuality } from './compress'

describe('lib/photos/compress — подбор качества и размера (B2C-17)', () => {
  it('pickQuality: стартовое качество ниже у больших исходников', () => {
    expect(pickQuality(50 * 1024)).toBe(0.92)
    expect(pickQuality(150 * 1024)).toBe(0.85)
    expect(pickQuality(400 * 1024)).toBe(0.75)
    expect(pickQuality(900 * 1024)).toBe(0.65)
    expect(pickQuality(5 * 1024 * 1024)).toBe(0.55)
    expect(pickQuality(300, 200)).toBe(0.85)
  })

  it('nextQuality: уложились — стоп; больше цели — на шаг ниже; дно — стоп', () => {
    expect(nextQuality(90 * 1024, 0.85)).toBeNull()
    expect(nextQuality(TARGET_BYTES, 0.85)).toBeNull()
    expect(nextQuality(200 * 1024, 0.85)).toBe(0.75)
    expect(nextQuality(200 * 1024, 0.6)).toBe(0.5)
    expect(nextQuality(200 * 1024, 0.55)).toBeNull()
    expect(nextQuality(200 * 1024, MIN_QUALITY)).toBeNull()
  })

  it('fitSize: длинная сторона ≤ 1600 с теми же пропорциями; маленькое не растягивается', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitSize(MAX_SIDE, 1)).toEqual({ width: 1600, height: 1 })
    expect(fitSize(1, 1, 1600)).toEqual({ width: 1, height: 1 })
  })

  it('outputType: webp остаётся webp, всё остальное (png старого Safari) — jpeg', () => {
    expect(outputType('image/webp')).toBe('image/webp')
    expect(outputType('image/png')).toBe('image/jpeg')
    expect(outputType('')).toBe('image/jpeg')
  })

  it('compressImage: без canvas в Node падает понятной ошибкой, а не тихо', async () => {
    await expect(compressImage(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }))).rejects.toBeTruthy()
  })
})
