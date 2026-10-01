// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_BYTES, compressImage } from './compress'

/**
 * `compressImage` в браузерных объектах-заглушках (критик возврата 2): холст перерисовывается из
 * исходной картинки под сторону попытки и только при её смене; размер результата — по нарисованному;
 * webp-кодировщика нет — та же попытка в jpeg и дальше только jpeg.
 */

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Портрет 3000 × 4000 и холст, который помнит, что и какого размера в него рисовали. */
function stubBrowser() {
  const draws: [number, number][] = []
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3000, height: 4000, close: vi.fn() })))
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => draws.push([canvas.width, canvas.height]) }) }
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
  return draws
}

/** Модель детального фото (Грузия): байты растут с площадью и качеством — 192,7 КБ при 1600 px и 0,55. */
const detailedBytes = (side: number, quality: number) => Math.round(192.7 * 1024 * (side / 1600) ** 2 * (quality / 0.55))

describe('lib/photos/compress — compressImage с холстом (DOM)', () => {
  it('холст перерисовывается по стороне попытки и только при её смене; размер результата — по нарисованному', async () => {
    const draws = stubBrowser()
    const calls: [number, string, number][] = []
    const encoder = async (canvas: HTMLCanvasElement, type: string, quality: number) => {
      calls.push([Math.max(canvas.width, canvas.height), type, quality])
      return new Blob([new Uint8Array(detailedBytes(Math.max(canvas.width, canvas.height), quality))], { type })
    }
    const out = await compressImage(new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'image/jpeg' }), { encoder })
    expect(calls).toEqual([[1600, 'image/webp', 0.55], [1600, 'image/webp', 0.5], [1280, 'image/webp', 0.5]])
    expect(draws).toEqual([[1200, 1600], [960, 1280]])
    expect(out).toMatchObject({ type: 'image/webp', width: 960, height: 1280 })
    expect(out.blob.size).toBeLessThanOrEqual(MAX_BYTES)
  })

  it('кодировщик не умеет webp (отдал png) — та же попытка в jpeg тем же качеством, дальше только jpeg', async () => {
    stubBrowser()
    const calls: [number, string, number][] = []
    const encoder = async (canvas: HTMLCanvasElement, type: string, quality: number) => {
      calls.push([Math.max(canvas.width, canvas.height), type, quality])
      const side = Math.max(canvas.width, canvas.height)
      return new Blob([new Uint8Array(detailedBytes(side, quality))], { type: type === 'image/webp' ? 'image/png' : type })
    }
    const out = await compressImage(new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'image/jpeg' }), { encoder })
    expect(calls).toEqual([[1600, 'image/webp', 0.55], [1600, 'image/jpeg', 0.55], [1600, 'image/jpeg', 0.5], [1280, 'image/jpeg', 0.5]])
    expect(out).toMatchObject({ type: 'image/jpeg', width: 960, height: 1280 })
  })
})
