/**
 * Сжатие фото на телефоне (Р-9, B2C-17): картинка любого размера → webp около 100 КБ (длинная
 * сторона ≤ 1600), качество подбирается по размеру результата. Браузер без webp-кодировщика
 * (старый Safari отдаёт png) — jpeg. Подбор качества и размера — чистые функции с тестами;
 * рисование — canvas, проверяется в браузере.
 */

/** Целевой размер файла, байт (~100 КБ — Р-9). */
export const TARGET_BYTES = 100 * 1024
/** Длинная сторона после сжатия, px: экран телефона 393 × 3 — больше не видно. */
export const MAX_SIDE = 1600
/** Ниже этого качества не опускаемся — лучше чуть больше байт, чем каша. */
export const MIN_QUALITY = 0.5
/** Шаг понижения качества между попытками. */
export const QUALITY_STEP = 0.1
/** Сколько попыток кодирования максимум. */
export const MAX_TRIES = 5

export type PhotoType = 'image/webp' | 'image/jpeg'

/**
 * С какого качества начать по размеру исходника: маленькие файлы почти не жмутся, большие —
 * сразу ниже, чтобы не тратить попытки.
 */
export function pickQuality(sizeBytes: number, target = TARGET_BYTES): number {
  if (sizeBytes <= target) return 0.92
  const ratio = sizeBytes / target
  if (ratio <= 2) return 0.85
  if (ratio <= 5) return 0.75
  if (ratio <= 10) return 0.65
  return 0.55
}

/** Следующее качество после результата `sizeBytes`; null — уложились или дошли до дна. */
export function nextQuality(sizeBytes: number, quality: number, target = TARGET_BYTES): number | null {
  if (sizeBytes <= target) return null
  const next = Math.round((quality - QUALITY_STEP) * 100) / 100
  return next >= MIN_QUALITY ? next : null
}

/** Размер холста: длинная сторона ≤ `max`, пропорции те же, не меньше 1 px. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
  const k = max / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** Что отдавать на сервер: браузер закодировал webp — webp, иначе (png от старого Safari) — jpeg. */
export function outputType(encoded: string): PhotoType {
  return encoded === 'image/webp' ? 'image/webp' : 'image/jpeg'
}

type Encoder = (canvas: HTMLCanvasElement, type: string, quality: number) => Promise<Blob | null>

const encode: Encoder = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))

/**
 * Файл или Blob → сжатая картинка. Формат — webp, если браузер умеет его кодировать, иначе jpeg;
 * качество подбирается от `pickQuality` вниз, пока не уложимся в `target` или не дойдём до дна.
 */
export async function compressImage(
  source: Blob,
  opts: { target?: number; maxSide?: number; encoder?: Encoder } = {},
): Promise<{ blob: Blob; type: PhotoType; width: number; height: number }> {
  const target = opts.target ?? TARGET_BYTES
  const bitmap = await createImageBitmap(source)
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height, opts.maxSide ?? MAX_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d недоступен')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const enc = opts.encoder ?? encode
    // Первая проба — webp: если кодировщика нет, браузер вернёт png — тогда всё дальше в jpeg.
    let type: PhotoType = 'image/webp'
    let quality: number | null = pickQuality(source.size, target)
    let best: Blob | null = null
    for (let i = 0; i < MAX_TRIES && quality !== null; i++) {
      const blob = await enc(canvas, type, quality)
      if (!blob) throw new Error('не удалось закодировать картинку')
      if (i === 0 && outputType(blob.type) !== type) {
        type = 'image/jpeg'
        const jpeg = await enc(canvas, type, quality)
        if (!jpeg) throw new Error('не удалось закодировать картинку')
        best = jpeg
      } else {
        best = blob
      }
      quality = nextQuality(best.size, quality, target)
    }
    if (!best) throw new Error('не удалось закодировать картинку')
    return { blob: best, type, width, height }
  } finally {
    bitmap.close()
  }
}
