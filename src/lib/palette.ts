/**
 * Все цвета, которые пользователь может выбрать, заданы ПАРАМИ light/dark.
 * Свободного выбора HEX нет намеренно: любой выбранный вариант уже проверен
 * на контраст в обеих темах, поэтому «невидимый в тёмной теме» элемент
 * получить невозможно.
 */

export type HueKey = 'blue' | 'teal' | 'green' | 'ochre' | 'brick' | 'plum' | 'indigo' | 'steel'

export const HUES: Record<HueKey, { light: string; dark: string; label: string }> = {
  blue: { light: '#3B62B8', dark: '#7FA5F0', label: 'Синий' },
  teal: { light: '#0F7A72', dark: '#2FC3B4', label: 'Бирюзовый' },
  green: { light: '#2E7D4F', dark: '#5CC98A', label: 'Зелёный' },
  ochre: { light: '#8A6D3B', dark: '#D8B372', label: 'Охра' },
  brick: { light: '#B4523C', dark: '#F0917A', label: 'Кирпичный' },
  plum: { light: '#8A2E58', dark: '#F088B0', label: 'Слива' },
  indigo: { light: '#4B3FA8', dark: '#A79BFF', label: 'Индиго' },
  steel: { light: '#5A6C78', dark: '#9FB3BE', label: 'Стальной' },
}

export const HUE_KEYS = Object.keys(HUES) as HueKey[]

export type AccentKey = 'emerald' | 'cobalt' | 'graphite' | 'copper' | 'indigo' | 'plum'

type Accent = {
  label: string
  light: string
  dark: string
  lightInk: string
  darkInk: string
  lightSoft: string
  darkSoft: string
}

export const ACCENTS: Record<AccentKey, Accent> = {
  emerald: {
    label: 'Изумруд',
    light: '#0A6B57', dark: '#17B98C',
    lightInk: '#FFFFFF', darkInk: '#04201A',
    lightSoft: '#DCEDE7', darkSoft: '#0F312A',
  },
  cobalt: {
    label: 'Кобальт',
    light: '#1B4FA8', dark: '#6FA8FF',
    lightInk: '#FFFFFF', darkInk: '#04162E',
    lightSoft: '#DDE7F8', darkSoft: '#102338',
  },
  graphite: {
    label: 'Графит',
    light: '#3A4A52', dark: '#A6BAC3',
    lightInk: '#FFFFFF', darkInk: '#0B1417',
    lightSoft: '#E2E8EA', darkSoft: '#1B2529',
  },
  copper: {
    label: 'Медь',
    light: '#8A5320', dark: '#E0A45E',
    lightInk: '#FFFFFF', darkInk: '#231303',
    lightSoft: '#F6E8D8', darkSoft: '#2C1F0E',
  },
  indigo: {
    label: 'Индиго',
    light: '#4B3FA8', dark: '#A79BFF',
    lightInk: '#FFFFFF', darkInk: '#100A2E',
    lightSoft: '#E4E1F7', darkSoft: '#1B1836',
  },
  plum: {
    label: 'Слива',
    light: '#8A2E58', dark: '#F088B0',
    lightInk: '#FFFFFF', darkInk: '#2A0A18',
    lightSoft: '#F7E0E9', darkSoft: '#2E1520',
  },
}

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[]

export type ThemeChoice = 'auto' | 'light' | 'dark'
export type CategoryKey = 'd1' | 'd2' | 'd3' | 'd4' | 'd5'

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveDark(choice: ThemeChoice): boolean {
  return choice === 'dark' || (choice === 'auto' && prefersDark())
}

/** Единственное место, где цвета попадают в DOM. */
export function applyTheme(opts: {
  theme: ThemeChoice
  accent: AccentKey
  categories: Record<CategoryKey, HueKey>
}) {
  const root = document.documentElement
  const dark = resolveDark(opts.theme)
  root.classList.toggle('dark', dark)

  const a = ACCENTS[opts.accent]
  root.style.setProperty('--brand', dark ? a.dark : a.light)
  root.style.setProperty('--brand-ink', dark ? a.darkInk : a.lightInk)
  root.style.setProperty('--brand-soft', dark ? a.darkSoft : a.lightSoft)

  for (const [key, hue] of Object.entries(opts.categories)) {
    const h = HUES[hue as HueKey]
    root.style.setProperty(`--${key}`, dark ? h.dark : h.light)
  }
}

/** Цвет оттенка для текущей темы — для inline-заливок в SVG. */
export function hueColor(hue: HueKey, dark: boolean): string {
  return dark ? HUES[hue].dark : HUES[hue].light
}
