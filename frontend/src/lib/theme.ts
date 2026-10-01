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
import { applyTheme, resolveDark, type ThemeChoice } from '@/lib/palette'

const THEME_KEY = 'ff_theme'
const THEMES: ThemeChoice[] = ['auto', 'light', 'dark']

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
 * Применяет выбранную тему к документу и обновляет `isDark`. «Цвета разделов» бюджета
 * (PV-22) сняты вместе с «Бюджетом» (Р-33): старый ключ `ff_category_hues` просто не читается.
 */
export function applyCurrentPalette() {
  const theme = readThemeChoice()
  applyTheme({ theme })
  isDark.value = resolveDark(theme)
}

export function setThemeChoice(theme: ThemeChoice) {
  write(THEME_KEY, theme)
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
