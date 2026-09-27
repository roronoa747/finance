/**
 * Тема живёт в одном месте (перенос React `useThemeSync` / `useIsDark`): сюда
 * стекаются выбор на устройстве и системная настройка, отсюда цвета попадают в
 * DOM. Оформление — дело устройства (Р-20): `localStorage`, в общий документ не
 * попадает. Акцента пользователя больше нет (B2C-12): бренд один, старый ключ
 * `ff_accent` в хранилище просто не читается.
 *
 * На уровне модуля ничего не выполняется и `window` не трогается: SSR-тесты
 * идут в Node. Применяет тему `main.ts` до `mount` — она есть и на `/access`,
 * и на `/start`, а не только когда открыты Настройки.
 */
import { ref } from 'vue'
import { HUE_KEYS, applyTheme, resolveDark, type CategoryKey, type HueKey, type ThemeChoice } from '@/lib/palette'

const THEME_KEY = 'ff_theme'
const CATEGORY_HUES_KEY = 'ff_category_hues'
const THEMES: ThemeChoice[] = ['auto', 'light', 'dark']

/** Цвета разделов по умолчанию (React `defaultSettings.categories`). */
export const DEFAULT_CATEGORY_HUES: Readonly<Record<CategoryKey, HueKey>> = {
  d1: 'blue',
  d2: 'brick',
  d3: 'green',
  d4: 'ochre',
  d5: 'steel',
}

/** Тёмная ли тема прямо сейчас — для inline-цветов в SVG. В Node — false. */
export const isDark = ref(false)

// Хранилище может быть недоступно (приватный режим, запрет сайта) — тогда дефолт.
function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch {
    // Не запомнилось — тема всё равно применена на этот запуск.
  }
}

export function readThemeChoice(): ThemeChoice {
  const v = read(THEME_KEY) as ThemeChoice | null
  return v && THEMES.includes(v) ? v : 'auto'
}

/**
 * «Цвета разделов» устройства (PV-22, Р-20). Сломанная или чужая запись — дефолт по
 * каждому разделу отдельно: один испорченный ключ не сбрасывает остальные.
 */
export function readCategoryHues(): Record<CategoryKey, HueKey> {
  const out = { ...DEFAULT_CATEGORY_HUES }
  let saved: unknown = null
  try {
    saved = JSON.parse(read(CATEGORY_HUES_KEY) ?? 'null')
  } catch {
    return out
  }
  if (saved && typeof saved === 'object') {
    for (const key of Object.keys(out) as CategoryKey[]) {
      const hue = (saved as Record<string, unknown>)[key]
      if (HUE_KEYS.includes(hue as HueKey)) out[key] = hue as HueKey
    }
  }
  return out
}

/** Применяет выбранные тему и цвета разделов к документу и обновляет `isDark`. */
export function applyCurrentPalette() {
  const theme = readThemeChoice()
  applyTheme({ theme, categories: readCategoryHues() })
  isDark.value = resolveDark(theme)
}

export function setThemeChoice(theme: ThemeChoice) {
  write(THEME_KEY, theme)
  applyCurrentPalette()
}

export function setCategoryHue(key: CategoryKey, hue: HueKey) {
  write(CATEGORY_HUES_KEY, JSON.stringify({ ...readCategoryHues(), [key]: hue }))
  applyCurrentPalette()
}

/**
 * «Авто» следит за телефоном: сменилась системная тема — переприменяем палитру.
 * Под «Светлой» и «Тёмной» системная смена ничего не трогает. Возвращает отписку.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (readThemeChoice() === 'auto') applyCurrentPalette()
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
