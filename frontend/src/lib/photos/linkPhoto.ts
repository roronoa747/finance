/**
 * Маленькая картинка со страницы — не фото желания (B2C-75, смоук 2 Б12): у SPA-магазинов (Pinduoduo)
 * в `og:image` — общий логотип приложения, в плитке он рассыпается на пиксели. Короткая сторона меньше
 * `MIN_LINK_PHOTO_SIDE` — как «картинки нет»: плитка без фото, своё — кнопкой камеры. Одно правило для
 * вставки ссылки (`useLinkPreview`) и обхода старых желаний (`wishLinkPhotos`).
 */
export const MIN_LINK_PHOTO_SIDE = 300

/** Картинка со страницы годится в фото желания: короткая сторона ≥ `MIN_LINK_PHOTO_SIDE`. */
export function bigEnough(width: number, height: number): boolean {
  return Math.min(width, height) >= MIN_LINK_PHOTO_SIDE
}

/** Размер картинки до показа; null — не узнать (нет `createImageBitmap`, не декодируется). */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}
