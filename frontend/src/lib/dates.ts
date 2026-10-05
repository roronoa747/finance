export const MONTHS_NOM = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/** Дательный падеж: «к марту», «соберём к ноябрю». */
export const MONTHS_DAT = [
  'январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню',
  'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю',
]

/** Предложный падеж: «в сентябре», «закроется в августе». */
export const MONTHS_PRE = [
  'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
]

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
export function monthShort(key: string, withYear = true): string {
  const { year, month } = parseMonthKey(key)
  const short = MONTHS_NOM[month].slice(0, 3).toLowerCase()
  return withYear ? `${short} ${year}` : short
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

/** Срок: «к марту» в этом году, «к марту 2027» — в другом (`now` — месяц, от которого смотрим). */
export function monthBy(key: string, now = monthKey()): string {
  const { year, month } = parseMonthKey(key)
  return `к ${MONTHS_DAT[month]}` + (year !== parseMonthKey(now).year ? ` ${year}` : '')
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

/** «5 сентября» */
export function dayLabel(day: number, key = monthKey()): string {
  return `${day} ${MONTHS_GEN[parseMonthKey(key).month]}`
}

/** Сегодняшнее число и месяц — по Алматы. */
export function today(d = new Date()): { day: number; key: string } {
  return { day: almaty(d).getUTCDate(), key: monthKey(d) }
}

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * ISO-неделя «2026-W39» (с понедельника; неделя года — та, где её четверг). Дата
 * `YYYY-MM-DD` (строка выписки) — уже календарная; момент времени — по Алматы.
 */
export function weekKey(d: Date | string = new Date()): string {
  const a = typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : almaty(d)
  const day = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const thursday = new Date(day + (3 - ((a.getUTCDay() + 6) % 7)) * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Понедельник и воскресенье ISO-недели, `YYYY-MM-DD`. */
export function weekRange(key: string): { from: string; to: string } {
  const [year, week] = key.split('-W').map(Number)
  const jan4 = Date.UTC(year, 0, 4)
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS + (week - 1) * 7 * DAY_MS
  return { from: isoDay(monday), to: isoDay(monday + 6 * DAY_MS) }
}

/** Сегодняшняя дата по Алматы, `YYYY-MM-DD` (день книги курсов). */
export function todayIso(d = new Date()): string {
  return almaty(d).toISOString().slice(0, 10)
}

/** Дата `YYYY-MM-DD` на `n` дней раньше / позже. */
export function addDaysIso(iso: string, n: number): string {
  return isoDay(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS)
}

/** Дата `YYYY-MM-DD` на `n` месяцев раньше / позже; 31-е в коротком месяце — его последний день. */
export function shiftIsoMonths(iso: string, n: number): string {
  const [y, mo, d] = iso.split('-').map(Number)
  const key = addMonths(`${y}-${String(mo).padStart(2, '0')}`, n)
  return isoIn(key, d)
}

/** День `day` месяца `key` как `YYYY-MM-DD`, обрезанный по длине месяца (день зарплаты 31 → 30 сентября). */
export function isoIn(key: string, day: number): string {
  return `${key}-${String(Math.min(Math.max(1, day), daysInMonth(key))).padStart(2, '0')}`
}

/** День момента времени по Алматы, «5 сентября» — когда отметили оплату. */
export function atLabel(iso: string): string {
  const d = today(new Date(iso))
  return dayLabel(d.day, d.key)
}

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** Короткий день недели момента по Алматы — «вт» (когда загрузили выписку, карточка «Выписки»); нет даты — ''. */
export function weekdayShort(iso: string | null | undefined): string {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isNaN(t) ? '' : WEEKDAYS_SHORT[almaty(new Date(t)).getUTCDay()]
}

/**
 * Диапазон недели для заголовка «Эта неделя · 21–27 сентября» (главный и «Неделя»): один
 * месяц — «21–27 сентября», на стыке — «29 сентября – 5 октября».
 */
export function weekRangeLabel(r: { from: string; to: string }): string {
  const day = (iso: string) => Number(iso.slice(8, 10))
  const gen = (iso: string) => MONTHS_GEN[Number(iso.slice(5, 7)) - 1]
  return gen(r.from) === gen(r.to) ? `${day(r.from)}–${day(r.to)} ${gen(r.to)}` : `${day(r.from)} ${gen(r.from)} – ${day(r.to)} ${gen(r.to)}`
}

/**
 * Когда добавили или купили желание: новые даты — ISO, «5 сентября» по Алматы; старые строки
 * из прода (`24.09.2026`) — как есть; пусто — ''.
 */
export function addedLabel(s: string | null | undefined): string {
  if (!s) return ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? atLabel(s) : s
}
