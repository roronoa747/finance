import { describe, it, expect } from 'vitest'
import { MAX_BYTES, MAX_SIDE, MAX_TRIES, MIN_QUALITY, MIN_SIDE, TARGET_BYTES, compressImage, encodeWithin, fitSize, nextQuality, nextSide, outputType, pickQuality } from './compress'

describe('lib/photos/compress — подбор качества и размера (B2C-17)', () => {
  it('pickQuality: стартовое качество ниже у больших исходников', () => {
    expect(pickQuality(50 * 1024)).toBe(0.92)
    expect(pickQuality(150 * 1024)).toBe(0.85)
    expect(pickQuality(400 * 1024)).toBe(0.75)
    expect(pickQuality(900 * 1024)).toBe(0.65)
    expect(pickQuality(5 * 1024 * 1024)).toBe(0.55)
    expect(pickQuality(300, 200)).toBe(0.85)
  })

  it('nextQuality: уложились — стоп; больше цели — на шаг ниже, но до дна доходит; на дне — стоп', () => {
    expect(nextQuality(90 * 1024, 0.85)).toBeNull()
    expect(nextQuality(TARGET_BYTES, 0.85)).toBeNull()
    expect(nextQuality(200 * 1024, 0.85)).toBe(0.75)
    expect(nextQuality(200 * 1024, 0.6)).toBe(0.5)
    // Старт 0,65 / 0,55 доходит до 0,5, а не останавливается на 0,55 (возврат приёмки 2 п. 5).
    expect(nextQuality(200 * 1024, 0.65)).toBe(0.55)
    expect(nextQuality(200 * 1024, 0.55)).toBe(MIN_QUALITY)
    expect(nextQuality(200 * 1024, MIN_QUALITY)).toBeNull()
  })

  it('fitSize: длинная сторона ≤ 1600 с теми же пропорциями; маленькое не растягивается', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3000, 4000)).toEqual({ width: 1200, height: 1600 })
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitSize(MAX_SIDE, 1)).toEqual({ width: 1600, height: 1 })
    expect(fitSize(1, 1, 1600)).toEqual({ width: 1, height: 1 })
  })

  it('nextSide: холст меньше на пятую часть, не меньше MIN_SIDE', () => {
    expect(nextSide(1600)).toBe(1280)
    expect(nextSide(1280)).toBe(1024)
    expect(nextSide(1024)).toBe(819)
    expect(nextSide(819)).toBeNull()
    expect(nextSide(MIN_SIDE - 1)).toBeNull()
  })

  it('encodeWithin — детальное фото (Грузия: 192,7 КБ на 0,55 при 1600 px): качество до дна, затем холст меньше, пока больше 150 КБ', async () => {
    // Модель кодировщика: байты растут с площадью и качеством; 1600 px и 0,55 — как у Грузии в Chrome.
    const tries: [number, number][] = []
    const detailed = async (side: number, quality: number) => {
      tries.push([side, quality])
      return new Blob([new Uint8Array(Math.round(192.7 * 1024 * (side / 1600) ** 2 * (quality / 0.55)))])
    }
    const { blob, side } = await encodeWithin(detailed, 1600, pickQuality(5 * 1024 * 1024))
    // 0,5 при 1600 px — 175 КБ, больше потолка; 1280 px — 112 КБ: в потолке, дальше резкость не режем.
    expect(tries).toEqual([[1600, 0.55], [1600, 0.5], [1280, 0.5]])
    expect(side).toBe(1280)
    expect(blob.size).toBeLessThanOrEqual(MAX_BYTES)
    expect(MAX_BYTES).toBe(150 * 1024)

    // Обычное фото укладывается качеством — холст не трогается; совсем «шумное» — останавливается на MIN_SIDE;
    // на дне качества и в потолке (120 КБ) — холст тоже не трогается.
    tries.length = 0
    const plain = await encodeWithin(async (s, q) => (tries.push([s, q]), new Blob([new Uint8Array(Math.round(150 * 1024 * (q / 0.75)))])), 1600, 0.75)
    expect(plain.side).toBe(1600)
    expect(tries.map(([, q]) => q)).toEqual([0.75, 0.65, 0.55, 0.5])
    let n = 0
    const noisy = await encodeWithin(async () => (n++, new Blob([new Uint8Array(MAX_BYTES + 1)])), 1600, 0.92)
    expect(noisy.side).toBe(819)
    expect(n).toBeLessThanOrEqual(MAX_TRIES)
    expect((await encodeWithin(async () => new Blob([new Uint8Array(120 * 1024)]), 1600, 0.55)).side).toBe(1600)
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
