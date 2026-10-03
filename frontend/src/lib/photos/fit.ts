import { ref, watch } from 'vue'

/**
 * Широкие фото желаний — целиком (B2C-73, смоук 2 Б12): баннер магазина (контроллер, стол с надписями)
 * в квадратной плитке терял края. Заметно шире квадрата — вписать (`object-contain`) на фоне плитки;
 * квадратные и высокие — на всю плитку (`object-cover`), как раньше. Цели и мечты не меняются.
 */
export const WIDE_RATIO = 1.25

/** Ширина к высоте ≥ `WIDE_RATIO`; битая картинка (0×0) — не широкая. */
export function isWide(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height >= WIDE_RATIO
}

/**
 * Класс вписывания по размерам картинки после `load`. До загрузки и при смене картинки — `object-cover`,
 * как раньше: без заглушки и анимации.
 */
export function useWideFit(src: () => string | null | undefined) {
  const wide = ref(false)
  watch(src, () => (wide.value = false))
  const onLoad = (e: Event) => {
    const img = e.target as HTMLImageElement
    wide.value = isWide(img.naturalWidth, img.naturalHeight)
  }
  const fit = () => (wide.value ? 'object-contain' : 'object-cover')
  return { wide, onLoad, fit }
}
