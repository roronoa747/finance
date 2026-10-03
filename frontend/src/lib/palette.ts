/**
 * Все цвета, которые пользователь может выбрать, заданы ПАРАМИ light/dark.
 * Свободного выбора HEX нет намеренно: любой выбранный вариант уже проверен
 * на контраст в обеих темах, поэтому «невидимый в тёмной теме» элемент
 * получить невозможно.
 *
 * Бренд один — «глина» из `style.css`; акцент пользователя убран (DESIGN.md §3,
 * B2C-12). Разделы трат выписок красятся токенами `--s1…--s12` (`spendColor`).
 */

import type { ArticleKey, Person, PersonColor, PersonId } from '@/types/finance'

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

/**
 * Единственное место, где тема попадает в DOM: класс `dark` на `<html>`. Цвета разделов
 * бюджета (`--d1…--d5`) больше не пишутся — их последний читатель, «Бюджет», убран в Р-33.
 *
 * Строка сверху телефона (`theme-color`, B2C-53) — цвет фона выбранной темы: `--canvas`
 * читается после смены класса, литерала цвета здесь нет. Оба мета-тега из `index.html`
 * получают одно значение — ручной выбор сильнее их `media`.
 */
export function applyTheme(opts: { theme: ThemeChoice }) {
  const root = document.documentElement
  root.classList.toggle('dark', resolveDark(opts.theme))
  const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim()
  if (!canvas) return
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', canvas)
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

export function spendSlot(category: { id: string; order: number; slot?: number | null }): number {
  // Выбранный семьёй слот (B2C-21) сильнее таблицы §4 и порядка.
  if (category.slot && category.slot >= 1 && category.slot <= SPEND_SLOTS) return Math.round(category.slot)
  return SPEND_SLOT_BY_ID[category.id] ?? ((Math.max(1, Math.round(category.order)) - 1) % SPEND_SLOTS) + 1
}

/** CSS-значение цвета раздела трат — токен, не литерал: `var(--s3)` / `var(--s-unknown)`. */
export function spendColor(category: { id: string; order: number; slot?: number | null } | null): string {
  return category ? `var(--s${spendSlot(category)})` : 'var(--s-unknown)'
}

/** Цвета кружка на выбор (Р-61, макет «Свой кружок»): ключи токенов, буква на каждом — ≥ 3:1 в обеих темах (гвард). */
export const PERSON_COLORS: PersonColor[] = ['pa', 'pb', 's3', 's1', 's8', 's6']

/** Смайлики кружка (макет «Свой кружок»); первым в выборе идёт буква имени. */
export const PERSON_EMOJI = ['🦊', '🐻', '🌿', '⚡️', '🌙', '🍉', '🚀', '🐱', '☕️', '🎧', '🌸']

/**
 * Свой смайлик с клавиатуры (B2C-69): ровно один графемный кластер с пиктограммой — 🦊, 👨‍👩‍👧, 🏳️‍🌈, 🇰🇿.
 * Буквы, цифры, два смайлика, пусто — null. Кластеры режет `Intl.Segmenter`, без него — кодовые точки
 * (тогда семья через ZWJ не пройдёт — запас, не правило).
 */
export function oneEmoji(text: string): string | null {
  const parts = graphemes(text.trim())
  if (parts.length !== 1) return null
  return /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(parts[0]) ? parts[0] : null
}

/**
 * Последний смайлик ввода (B2C-74, смоук 2 Б12): в поле уже стоит прежний свой, вставленный дописывается к
 * нему — берётся последняя графема, если это смайлик («🐼🦊» → 🦊). Последняя — буква или цифра — null.
 */
export function lastEmoji(text: string): string | null {
  const last = graphemes(text.trim()).at(-1)
  return last ? oneEmoji(last) : null
}

/** Графемы текста: `Intl.Segmenter`, без него — кодовые точки. */
function graphemes(text: string): string[] {
  if (!text) return []
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
    : Array.from(text)
}

/**
 * Цвет участника — токен: выбранный (`color`, ключ из `PERSON_COLORS`), иначе по слоту: `a`/`b` — `--pa`/`--pb`,
 * у третьего слота (`c`, обычно viewer) своего токена нет — `--ink-3`. Незнакомый ключ — по слоту.
 */
export function personColor(id: PersonId, color?: string | null): string {
  if (color && (PERSON_COLORS as string[]).includes(color)) return `var(--${color})`
  return `var(--${slotColor(id)})`
}

/** Ключ токена цвета слота: `a`/`b` — `pa`/`pb`, у третьего слота — `ink-3`. */
export function slotColor(id: PersonId): string {
  return id === 'c' ? 'ink-3' : `p${id}`
}

/** Цвет участника по документу — один путь для всех экранов (Р-61): живой участник с выбранным цветом, иначе слот. */
export function memberColor(people: readonly Person[], id: PersonId): string {
  return personColor(id, people.find((p) => p.id === id && !p.deletedAt)?.color)
}

/**
 * Цвет статьи разбора (B2C-57) — токен раздела, как в макете `money-breakdown.html`: Обязательное —
 * `--s1`, Жизнь — `--s5`, Запас — `--s3`, Дорогие долги — `--s6`, Подушка — `--s8`, Мечты — `--s4`,
 * Траты — `--s12`.
 */
export const ARTICLE_COLORS: Record<ArticleKey, string> = {
  must: 'var(--s1)',
  life: 'var(--s5)',
  reserve: 'var(--s3)',
  debts: 'var(--s6)',
  cushion: 'var(--s8)',
  dreams: 'var(--s4)',
  spend: 'var(--s12)',
}
