/**
 * Сжатие фото на телефоне (Р-9, B2C-17): картинка любого размера → webp около 100 КБ (длинная
 * сторона ≤ 1600), качество подбирается по размеру результата, на дне качества — меньше холст.
 * Браузер без webp-кодировщика (старый Safari отдаёт png) — jpeg. Подбор качества и размера —
 * чистые функции с тестами; рисование — canvas, проверяется в браузере.
 */

/** Целевой размер файла, байт (~100 КБ — Р-9): к нему подбирается качество. */
export const TARGET_BYTES = 100 * 1024
/**
 * Потолок, байт (B2C-17: «≤ ~150 КБ на сервере»): на дне качества холст уменьшается, только пока
 * файл больше потолка — фото мечты остаётся резким, а не 500 px ради 100 КБ.
 */
export const MAX_BYTES = 150 * 1024
/** Длинная сторона после сжатия, px: экран телефона 393 × 3 — больше не видно. */
export const MAX_SIDE = 1600
/** Ниже этого качества не опускаемся — лучше холст поменьше, чем каша. */
export const MIN_QUALITY = 0.5
/** Шаг понижения качества между попытками. */
export const QUALITY_STEP = 0.1
/**
 * Качество на дне, а файл всё ещё больше потолка (детальное фото: листва, город) — длинная сторона
 * меньше на пятую часть (возврат приёмки 2 п. 5: Грузия выходила 192 КБ).
 */
export const SIDE_STEP = 0.8
/** Меньше не уменьшаем: герой во всю ширину телефона (393 × 2) — дальше лучше чуть больше байт. */
export const MIN_SIDE = 800
/** Сколько попыток кодирования максимум: качество 0,92 → 0,5 — пять, холст 1600 → 819 — три. */
export const MAX_TRIES = 10

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

/** Следующее качество после результата `sizeBytes`: на шаг ниже, но не ниже дна; null — уложились или уже на дне. */
export function nextQuality(sizeBytes: number, quality: number, target = TARGET_BYTES): number | null {
  if (sizeBytes <= target || quality <= MIN_QUALITY) return null
  return Math.max(MIN_QUALITY, Math.round((quality - QUALITY_STEP) * 100) / 100)
}

/** Длинная сторона следующей попытки, когда качество уже на дне; null — меньше `MIN_SIDE` не уменьшаем. */
export function nextSide(side: number): number | null {
  const next = Math.round(side * SIDE_STEP)
  return next >= MIN_SIDE ? next : null
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

/**
 * Подбор попыток: качество от `quality` вниз до `MIN_QUALITY`, пока результат больше `target`;
 * на дне — холст меньше (`nextSide`), пока результат больше `max`; попыток — не больше
 * `MAX_TRIES`. `encode(side, quality)` — картинка с длинной стороной `side`. Отдаёт последнюю
 * попытку и её сторону.
 */
export async function encodeWithin(
  encode: (side: number, quality: number) => Promise<Blob>,
  side: number,
  quality: number,
  target = TARGET_BYTES,
  max = MAX_BYTES,
): Promise<{ blob: Blob; side: number }> {
  let blob = await encode(side, quality)
  for (let i = 1; i < MAX_TRIES && blob.size > target; i++) {
    const q = nextQuality(blob.size, quality, target)
    const s = q !== null ? side : blob.size > max ? nextSide(side) : null
    if (s === null) break
    quality = q ?? quality
    side = s
    blob = await encode(side, quality)
  }
  return { blob, side }
}

type Encoder = (canvas: HTMLCanvasElement, type: string, quality: number) => Promise<Blob | null>

const encode: Encoder = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))

/**
 * Файл или Blob → сжатая картинка. Формат — webp, если браузер умеет его кодировать, иначе jpeg;
 * качество и размер — `encodeWithin` от `pickQuality` и длинной стороны ≤ `maxSide`.
 */
export async function compressImage(
  source: Blob,
  opts: { target?: number; maxSide?: number; encoder?: Encoder } = {},
): Promise<{ blob: Blob; type: PhotoType; width: number; height: number }> {
  const target = opts.target ?? TARGET_BYTES
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d недоступен')
    const sizeAt = (side: number) => fitSize(bitmap.width, bitmap.height, side)
    let drawn = 0
    const draw = (side: number) => {
      if (side === drawn) return
      const { width, height } = sizeAt(side)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(bitmap, 0, 0, width, height)
      drawn = side
    }

    const enc = opts.encoder ?? encode
    // Первая проба — webp: если кодировщика нет, браузер вернёт png — тогда всё дальше в jpeg.
    let type: PhotoType = 'image/webp'
    const encodeAt = async (side: number, quality: number) => {
      draw(side)
      let blob = await enc(canvas, type, quality)
      if (blob && type === 'image/webp' && outputType(blob.type) !== type) {
        type = 'image/jpeg'
        blob = await enc(canvas, type, quality)
      }
      if (!blob) throw new Error('не удалось закодировать картинку')
      return blob
    }
    const first = Math.min(Math.max(bitmap.width, bitmap.height), opts.maxSide ?? MAX_SIDE)
    const { blob, side } = await encodeWithin(encodeAt, first, pickQuality(source.size, target), target)
    return { blob, type, ...sizeAt(side) }
  } finally {
    bitmap.close()
  }
}
