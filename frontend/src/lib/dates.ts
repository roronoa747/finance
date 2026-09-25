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

/**
 * Календарь приложения — по Алматы (Р-30): фиксированный UTC+5, как `almaty` в
 * backend/internal/fx. «Сегодня» и месяц одинаковы на любом телефоне, в каком бы
 * поясе он ни был: иначе вечером последнего числа отметка платежа на одном телефоне
 * ложилась бы в один месяц, а календарь другого показывал бы уже следующий.
 */
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000

/** Момент времени, у которого UTC-поля — это часы на стене в Алматы. */
const almaty = (d: Date) => new Date(d.getTime() + ALMATY_OFFSET_MS)

/** Ключ месяца вида «2026-09» — на нём строятся все срезы. Месяц — по Алматы. */
export function monthKey(d = new Date()): string {
  const a = almaty(d)
  return `${a.getUTCFullYear()}-${String(a.getUTCMonth() + 1).padStart(2, '0')}`
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

/** «сен 2026» — строка таблицы: график платежей, план по месяцам. */
export function monthShort(key: string): string {
  const { year, month } = parseMonthKey(key)
  return `${MONTHS_NOM[month].slice(0, 3).toLowerCase()} ${year}`
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

/** Сегодняшнее число и месяц — по Алматы. */
export function today(d = new Date()): { day: number; key: string } {
  return { day: almaty(d).getUTCDate(), key: monthKey(d) }
}

/** День момента времени по Алматы, «5 сентября» — когда отметили оплату. */
export function atLabel(iso: string): string {
  const d = today(new Date(iso))
  return dayLabel(d.day, d.key)
}
