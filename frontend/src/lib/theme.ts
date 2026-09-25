/**
 * Тема живёт в одном месте (перенос React `useThemeSync` / `useIsDark`): сюда
 * стекаются выбор на устройстве и системная настройка, отсюда цвета попадают в
 * DOM. Оформление — дело устройства (Р-20): `localStorage`, в общий документ не
 * попадает.
 *
 * На уровне модуля ничего не выполняется и `window` не трогается: SSR-тесты
 * идут в Node. Применяет тему `main.ts` до `mount` — она есть и на `/access`,
 * и на `/setup`, а не только когда открыта панель «Оформление».
 */
import { ref } from 'vue'
import { ACCENT_KEYS, applyTheme, resolveDark, type AccentKey, type ThemeChoice } from '@/lib/palette'

const THEME_KEY = 'ff_theme'
const ACCENT_KEY = 'ff_accent'
const THEMES: ThemeChoice[] = ['auto', 'light', 'dark']

/** Цвета разделов пока зашиты — «Цвета разделов» подключит PV-22. */
const CATEGORIES = { d1: 'blue', d2: 'brick', d3: 'green', d4: 'ochre', d5: 'steel' } as const

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

export function readAccent(): AccentKey {
  const v = read(ACCENT_KEY)
  // Список, а не `in`: имена из прототипа объекта («toString») — не акцент.
  return v && ACCENT_KEYS.includes(v as AccentKey) ? (v as AccentKey) : 'emerald'
}

/** Применяет выбранные тему и акцент к документу и обновляет `isDark`. */
export function applyCurrentPalette() {
  const theme = readThemeChoice()
  applyTheme({ theme, accent: readAccent(), categories: CATEGORIES })
  isDark.value = resolveDark(theme)
}

export function setThemeChoice(theme: ThemeChoice) {
  write(THEME_KEY, theme)
  applyCurrentPalette()
}

export function setAccent(accent: AccentKey) {
  write(ACCENT_KEY, accent)
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
