export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** Предложный падеж: «в сентябре», «закроется в августе». */
export const MONTHS_PRE = [
  'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
]

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Ключ месяца вида «2026-09» — на нём строятся все срезы. */
export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function parseMonthKey(key: string): { year: number; month: number } {
  const [y, mo] = key.split('-').map(Number)
  return { year: y, month: mo - 1 }
}

/** «Сентябрь 2026» */
export function monthTitle(key: string): string {
  const { year, month } = parseMonthKey(key)
  return `${MONTHS_NOM[month]} ${year}`
}

/** Сдвиг ключа месяца на N месяцев. */
export function addMonths(key: string, n: number): string {
  const { year, month } = parseMonthKey(key)
  const total = year * 12 + month + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Месяц, в который цель закроется, если копить N месяцев начиная со следующего. */
export function monthAfter(n: number, from = monthKey()): string {
  return monthTitle(addMonths(from, Math.max(0, n)))
}

/**
 * Падежи месяца. В русском интерфейсе «в сентябрь» и «с ноябрь» читаются
 * как машинный перевод, поэтому склонение живёт в одном месте, а не в шаблонах.
 */

/** Предложный: «в сентябре 2026». Без года — monthIn(key, false). */
export function monthIn(key: string, withYear = true): string {
  const { year, month } = parseMonthKey(key)
  return MONTHS_PRE[month] + (withYear ? ` ${year}` : '')
}

/** Родительный: «с ноября 2026», «до августа». */
export function monthFrom(key: string, withYear = true): string {
  const { year, month } = parseMonthKey(key)
  return MONTHS_GEN[month] + (withYear ? ` ${year}` : '')
}

/** Предложный для «через N месяцев»: «в апреле 2028». */
export function monthInAfter(n: number, from = monthKey()): string {
  return monthIn(addMonths(from, Math.max(0, n)))
}

/** Родительный для «вместо октября 2028». */
export function monthFromAfter(n: number, from = monthKey()): string {
  return monthFrom(addMonths(from, Math.max(0, n)))
}

/** Сколько дней в месяце. */
export function daysInMonth(key: string): number {
  const { year, month } = parseMonthKey(key)
  return new Date(year, month + 1, 0).getDate()
}

/** Сколько пустых клеток перед 1-м числом в сетке с понедельника. */
export function leadingBlanks(key: string): number {
  const { year, month } = parseMonthKey(key)
  return (new Date(year, month, 1).getDay() + 6) % 7
}

/** «5 сентября» */
export function dayLabel(day: number, key = monthKey()): string {
  return `${day} ${MONTHS_GEN[parseMonthKey(key).month]}`
}

export function today(): { day: number; key: string } {
  const d = new Date()
  return { day: d.getDate(), key: monthKey(d) }
}
