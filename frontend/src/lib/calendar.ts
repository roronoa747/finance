import type { Credit, Obligation, Person } from '@/types/finance'
import { addDaysIso, addMonths, daysInMonth, isoIn, monthKey, todayIso } from '@/lib/dates'
import { amountIn, isoWeekday, liveObligations, openCredits, payEvents, payRhythmOf, salaryOf } from '@/lib/finance'
import { money, moneyIn } from '@/lib/money'

/**
 * «В календарь» (Р-7 «понятность», PN-28): платежи, кредиты и дни зарплаты — файлом .ics (RFC 5545) в календарь
 * телефона; напоминание в 9:00 дня платежа без пуша. Файл одноразовый: суммы поменялись — выгрузить заново (тот же
 * `UID` — календарь обновит событие, а не задвоит). Сумм зарплаты в файле нет — календарь бывает общим.
 */

/** Повторяющееся событие на весь день. `start` — ближайший день от сегодня, `rrule` — правило повтора. */
export type CalEvent = { uid: string; summary: string; start: string; rrule: string }

export type CalendarState = { obligations: Obligation[]; credits: Credit[]; people: Person[] }

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

/** 29–31 есть не в каждом месяце — такой платёж в календаре в последний день месяца (`BYMONTHDAY=-1`). */
const monthDay = (day: number) => (day > 28 ? -1 : day)
const dayIn = (key: string, day: number) => (day === -1 ? isoIn(key, daysInMonth(key)) : isoIn(key, day))

/** Ближайший день `day` (−1 — последний) от `today` включительно, каждый месяц. */
function nextMonthly(today: string, day: number): string {
  const key = today.slice(0, 7)
  const here = dayIn(key, day)
  return here >= today ? here : dayIn(addMonths(key, 1), day)
}

/** Ближайший `day` месяца `month` (1–12) от `today`, раз в год. */
function nextYearly(today: string, month: number, day: number): string {
  const year = Number(today.slice(0, 4))
  const at = (y: number) => dayIn(`${y}-${String(month).padStart(2, '0')}`, day)
  return at(year) >= today ? at(year) : at(year + 1)
}

/** Ближайший день недели `weekday` (ISO 1–7) от `today`. */
function nextWeekly(today: string, weekday: number): string {
  return addDaysIso(today, (weekday - isoWeekday(today) + 7) % 7)
}

const monthly = (uid: string, summary: string, today: string, day: number): CalEvent => {
  const d = monthDay(day)
  return { uid, summary, start: nextMonthly(today, d), rrule: `FREQ=MONTHLY;BYMONTHDAY=${d}` }
}

/** Платежи, открытые кредиты (производные — из стора) и приходы зарплаты по ритму (`payEvents`, Блок 7). */
export function calendarEvents(state: CalendarState, now = new Date()): CalEvent[] {
  const today = todayIso(now)
  const key = monthKey(now)
  const out: CalEvent[] = []
  for (const o of liveObligations(state.obligations)) {
    const { amount, currency } = amountIn(o, key)
    const summary = `${o.name} · ${o.estimate ? '≈ ' : ''}${moneyIn(amount, currency)}`
    if (o.every === 'year') {
      const month = Math.min(12, Math.max(1, o.month ?? 1))
      const d = monthDay(o.day)
      out.push({ uid: o.id, summary, start: nextYearly(today, month, d), rrule: `FREQ=YEARLY;BYMONTH=${month};BYMONTHDAY=${d}` })
    } else out.push(monthly(o.id, summary, today, o.day))
  }
  for (const c of openCredits(state.credits)) out.push(monthly(c.id, `${c.name} · ${money(c.payment)}`, today, c.day))
  for (const p of state.people) {
    if (salaryOf(p, key).amount <= 0) continue // оклада нет — и дня зарплаты нет
    const rhythm = payRhythmOf(p)
    if (rhythm === 'week') {
      out.push({ uid: `salary-${p.id}`, summary: `Зарплата · ${p.name}`, start: nextWeekly(today, p.weekday!), rrule: `FREQ=WEEKLY;BYDAY=${BYDAY[p.weekday! - 1]}` })
      continue
    }
    // Аванс — два прихода, если `payEvents` их даёт (аванс 0 или не меньше оклада — один приход всей суммой).
    if (rhythm === 'advance' && payEvents(p, key).length > 1) out.push(monthly(`advance-${p.id}`, `Аванс · ${p.name}`, today, p.payday2!))
    out.push(monthly(`salary-${p.id}`, `Зарплата · ${p.name}`, today, p.payday))
  }
  return out
}

/* ---------------- Текст .ics (RFC 5545) ---------------- */

/** Экранирование TEXT (3.3.11): `\`, `;`, `,`, перевод строки; неразрывные пробелы денег — обычными. */
export function icsEscape(text: string): string {
  return text
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Сворачивание строки (3.1): не длиннее 75 октетов, продолжение — с пробела; символ UTF-8 не рвётся. */
export function icsFold(line: string): string {
  const parts: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = encoder.encode(ch).length
    const limit = parts.length ? 74 : 75 // у продолжения первый октет — пробел
    if (size + n > limit) {
      parts.push(cur)
      cur = ''
      size = 0
    }
    cur += ch
    size += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

const basic = (iso: string) => iso.replace(/-/g, '')
/** `DTSTAMP` — UTC без долей секунды: 20261012T050000Z. */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Календарь целиком: CRLF, экранирование, сворачивание; события на весь день с напоминанием в 9:00. */
export function icsText(events: CalEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Finance//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Family Finance']
  for (const e of events) {
    const summary = icsEscape(e.summary)
    lines.push(
      'BEGIN:VEVENT',
      `UID:ff-${e.uid}@family-finance`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${basic(e.start)}`,
      `DTEND;VALUE=DATE:${basic(addDaysIso(e.start, 1))}`,
      `RRULE:${e.rrule}`,
      `SUMMARY:${summary}`,
      'DESCRIPTION:Family Finance',
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${summary}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(icsFold).join('\r\n') + '\r\n'
}
