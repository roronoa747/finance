/**
 * Все цвета, которые пользователь может выбрать, заданы ПАРАМИ light/dark.
 * Свободного выбора HEX нет намеренно: любой выбранный вариант уже проверен
 * на контраст в обеих темах, поэтому «невидимый в тёмной теме» элемент
 * получить невозможно.
 *
 * Бренд один — «глина» из `style.css`; акцент пользователя убран (DESIGN.md §3,
 * B2C-12). Разделы трат выписок красятся токенами `--s1…--s12` (`spendColor`).
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

export type ThemeChoice = 'auto' | 'light' | 'dark'
export type CategoryKey = 'd1' | 'd2' | 'd3' | 'd4' | 'd5'

/**
 * Имена разделов бюджета, пока семья их не завела: разделы создаются лениво (первая
 * сумма в плане), а форма платежа должна предложить раздел и в пустом документе.
 */
export const DEFAULT_CATEGORY_NAMES: Record<CategoryKey, string> = {
  d1: 'Жильё',
  d2: 'Кредиты',
  d3: 'Цели',
  d4: 'Еда и быт',
  d5: 'Свободно',
}

/** Имя раздела: как его назвала семья, а если раздел не заведён — запасное. */
export function categoryName(categories: { key: CategoryKey; name: string }[], key: CategoryKey): string {
  return categories.find((c) => c.key === key)?.name ?? DEFAULT_CATEGORY_NAMES[key]
}

export function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveDark(choice: ThemeChoice): boolean {
  return choice === 'dark' || (choice === 'auto' && prefersDark())
}

/** Единственное место, где цвета попадают в DOM. */
export function applyTheme(opts: { theme: ThemeChoice; categories: Record<CategoryKey, HueKey> }) {
  const root = document.documentElement
  const dark = resolveDark(opts.theme)
  root.classList.toggle('dark', dark)

  for (const [key, hue] of Object.entries(opts.categories)) {
    const h = HUES[hue as HueKey]
    root.style.setProperty(`--${key}`, dark ? h.dark : h.light)
  }
}

/** Цвет оттенка для текущей темы — для inline-заливок в SVG. */
export function hueColor(hue: HueKey, dark: boolean): string {
  return dark ? HUES[hue].dark : HUES[hue].light
}

/** Сколько оттенков у разделов трат в `style.css` (`--s1…--s12`). */
export const SPEND_SLOTS = 12

/**
 * Раздел трат → оттенок `--sN` (DESIGN.md §4): у разделов стартового словаря — свой номер
 * из таблицы, у остальных 17 и у заведённых семьёй — по кругу от `order`. `null` —
 * «не разобрано» (`--s-unknown`).
 */
const SPEND_SLOT_BY_ID: Record<string, number> = {
  sc_food: 1,
  sc_cafe: 2,
  sc_transport: 3,
  sc_subscriptions: 4,
  sc_health: 5,
  sc_shopping: 6,
  sc_fun: 7,
  sc_home: 8,
  sc_people: 9,
  sc_credit: 10,
  sc_utilities: 11,
  sc_other: 12,
}

export function spendSlot(category: { id: string; order: number }): number {
  return SPEND_SLOT_BY_ID[category.id] ?? ((Math.max(1, Math.round(category.order)) - 1) % SPEND_SLOTS) + 1
}

/** CSS-значение цвета раздела трат — токен, не литерал: `var(--s3)` / `var(--s-unknown)`. */
export function spendColor(category: { id: string; order: number } | null): string {
  return category ? `var(--s${spendSlot(category)})` : 'var(--s-unknown)'
}
