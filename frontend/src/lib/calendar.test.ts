import { describe, expect, it } from 'vitest'
import { calendarEvents, icsEscape, icsFold, icsText, type CalendarState } from './calendar'
import type { Credit, Obligation, Person } from '@/types/finance'

/**
 * PN-28: «В календарь». Сегодня — понедельник 12 октября 2026 (Алматы). Платежи: аренда 5-го (ближайшая — 5 ноября),
 * Netflix $15 31-го (последний день месяца — 31 октября), страховка раз в год 12 марта (2027), налог раз в год
 * 20 октября (этот год), коммуналка 12-го с оценкой (сегодня же); кредит 24-го. Ильяс — раз в месяц 10-го, Аруна —
 * аванс 15-го и остаток 30-го (→ последний день), Тимур — каждую среду (14 октября).
 */
const T0 = '2026-09-01T00:00:00.000Z'
const NOW = new Date('2026-10-12T05:00:00Z')

const ob = (id: string, name: string, day: number, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day, category: 'd4', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
})
const credit = (id: string, name: string, day: number, payment: number, principal: number): Credit => ({
  id, name, note: '', principal, annualRate: 24, payment, day, updatedAt: T0,
})
const person = (id: Person['id'], name: string, extra: Partial<Person> = {}): Person => ({
  id, name, salary: 500_000, payday: 10, updatedAt: T0, ...extra,
})

function state(extra: Partial<CalendarState> = {}): CalendarState {
  return {
    obligations: [
      ob('rent', 'Аренда', 5, 150_000, { category: 'd1' }),
      ob('netflix', 'Netflix', 31, 15, { versions: [{ from: '2000-01', amount: 15, currency: 'USD', rate: 470 }] }),
      ob('ins', 'Страховка', 12, 60_000, { every: 'year', month: 3 }),
      ob('tax', 'Налог', 20, 30_000, { every: 'year', month: 10 }),
      ob('util', 'Коммуналка', 12, 35_000, { category: 'd1', estimate: true }),
      ob('grp', 'Кино и музыка', 1, 0, { group: true }),
      ob('old', 'Старое', 3, 1_000, { deletedAt: T0 }),
    ],
    credits: [credit('kaspi', 'Kaspi кредит', 24, 85_000, 900_000), credit('closed', 'Закрытый', 7, 10_000, 0)],
    people: [
      person('a', 'Ильяс'),
      person('b', 'Аруна', { salary: 300_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 150_000 }),
      person('c', 'Тимур', { salary: 100_000, payRhythm: 'week', weekday: 3 }),
    ],
    ...extra,
  }
}

// Деньги в событии — с неразрывными пробелами (`money`); обычными их делает запись файла (`icsEscape`).
const byUid = (s = state()) =>
  Object.fromEntries(calendarEvents(s, NOW).map((e) => [e.uid, { ...e, summary: e.summary.replace(/[\u00a0\u202f]/g, ' ') }]))

describe('calendarEvents (PN-28)', () => {
  it('платежи: месячный, 31-е → последний день, годовой (этот и следующий год), оценка «≈»; группа и удалённый — нет', () => {
    const e = byUid()
    expect(e.rent).toEqual({ uid: 'rent', summary: 'Аренда · 150 000 ₸', start: '2026-11-05', rrule: 'FREQ=MONTHLY;BYMONTHDAY=5' })
    expect(e.netflix).toMatchObject({ summary: 'Netflix · 15 $', start: '2026-10-31', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' })
    expect(e.ins).toMatchObject({ start: '2027-03-12', rrule: 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=12' })
    expect(e.tax).toMatchObject({ start: '2026-10-20', rrule: 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=20' })
    // День платежа — сегодня: ближайший — сегодня же.
    expect(e.util).toMatchObject({ summary: 'Коммуналка · ≈ 35 000 ₸', start: '2026-10-12' })
    expect(e.grp).toBeUndefined()
    expect(e.old).toBeUndefined()
  })

  it('кредит — месячный по своему дню с платежом; закрытый — нет', () => {
    const e = byUid()
    expect(e.kaspi).toMatchObject({ summary: 'Kaspi кредит · 85 000 ₸', start: '2026-10-24', rrule: 'FREQ=MONTHLY;BYMONTHDAY=24' })
    expect(e.closed).toBeUndefined()
  })

  it('зарплата по ритму: месяц — день зарплаты, аванс — два события (30-е → последний день), неделя — BYDAY', () => {
    const e = byUid()
    expect(e['salary-a']).toEqual({ uid: 'salary-a', summary: 'Зарплата · Ильяс', start: '2026-11-10', rrule: 'FREQ=MONTHLY;BYMONTHDAY=10' })
    expect(e['advance-b']).toMatchObject({ summary: 'Аванс · Аруна', start: '2026-10-15', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' })
    expect(e['salary-b']).toMatchObject({ summary: 'Зарплата · Аруна', start: '2026-10-31', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' })
    expect(e['salary-c']).toMatchObject({ summary: 'Зарплата · Тимур', start: '2026-10-14', rrule: 'FREQ=WEEKLY;BYDAY=WE' })
    expect(e['advance-c']).toBeUndefined()
  })

  it('аванс, который payEvents не делит (аванс 0), — одно событие; неполный ритм — месячный; без оклада — ничего', () => {
    const e = byUid(state({
      people: [
        person('a', 'Ильяс', { payRhythm: 'advance', payday2: 25, salary2: 0 }),
        person('b', 'Аруна', { payRhythm: 'week' }),
        person('c', 'Тимур', { salary: 0 }),
      ],
    }))
    expect(e['advance-a']).toBeUndefined()
    expect(e['salary-a']).toMatchObject({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=10' })
    expect(e['salary-b']).toMatchObject({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=10' })
    expect(e['salary-c']).toBeUndefined()
  })

  it('сумм зарплаты нет нигде в файле', () => {
    const text = icsText(calendarEvents(state(), NOW), NOW)
    for (const n of ['500 000', '300 000', '150 000 ₸ · Аванс', '100 000']) expect(text).not.toContain(n)
    expect(text).not.toMatch(/Зарплата[^\r\n]*\d/)
    expect(text).not.toMatch(/Аванс[^\r\n]*\d/)
  })
})

describe('icsText (RFC 5545)', () => {
  const text = icsText(calendarEvents(state(), NOW), NOW)
  const lines = text.split('\r\n')

  it('CRLF везде, в конце — CRLF; одиноких LF нет', () => {
    expect(text.endsWith('\r\n')).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('пары BEGIN/END сходятся; событий столько же, сколько в calendarEvents; у каждого — VALARM 9:00', () => {
    const stack: string[] = []
    for (const l of lines) {
      if (l.startsWith('BEGIN:')) stack.push(l.slice(6))
      if (l.startsWith('END:')) expect(stack.pop()).toBe(l.slice(4))
    }
    expect(stack).toEqual([])
    const events = calendarEvents(state(), NOW)
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(events.length)
    expect(lines.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(events.length)
    expect(lines.filter((l) => l === 'TRIGGER:PT9H')).toHaveLength(events.length)
    expect(lines.slice(0, 3)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Finance//RU'])
  })

  it('событие: UID стабилен между вызовами, весь день, DTEND на следующий день, DESCRIPTION, DTSTAMP UTC', () => {
    const block = text.slice(text.indexOf('UID:ff-rent@family-finance'))
    expect(block.slice(0, block.indexOf('END:VEVENT'))).toBe(
      ['UID:ff-rent@family-finance', 'DTSTAMP:20261012T050000Z', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=5', 'SUMMARY:Аренда · 150 000 ₸', 'DESCRIPTION:Family Finance', 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Аренда · 150 000 ₸', 'TRIGGER:PT9H', 'END:VALARM', ''].join('\r\n'),
    )
    const later = icsText(calendarEvents(state(), new Date('2026-11-20T05:00:00Z')))
    const uids = (t: string) => t.split('\r\n').filter((l) => l.startsWith('UID:')).sort()
    expect(uids(later)).toEqual(uids(text))
  })

  it('экранирование: \\ ; , и перевод строки; неразрывные пробелы — обычные', () => {
    expect(icsEscape('a\\b; c, d\ne')).toBe('a\\\\b\\; c\\, d\\ne')
    expect(icsEscape('150 000 ₸')).toBe('150 000 ₸')
    const t = icsText([{ uid: 'x', summary: 'Свет, вода; газ', start: '2026-10-20', rrule: 'FREQ=MONTHLY;BYMONTHDAY=20' }], NOW)
    expect(t).toContain('SUMMARY:Свет\\, вода\\; газ\r\n')
  })

  it('сворачивание по октетам: кириллица (2 октета) не рвётся, строки ≤ 75 октетов, продолжение с пробела', () => {
    const long = `SUMMARY:${'Подписка на онлайн-кинотеатр и музыку для всей семьи '.repeat(3)}`
    const folded = icsFold(long)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(2)
    const bytes = (s: string) => new TextEncoder().encode(s).length
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75)
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true)
    // Развернуть (убрать CRLF + пробел) — та же строка; символы целы.
    expect(folded.replace(/\r\n /g, '')).toBe(long)
    expect(folded).not.toContain('�')
    // По символам строка короче 75, а по октетам — длиннее: сворачивается.
    const ru = `SUMMARY:${'ж'.repeat(60)}`
    expect(ru.length).toBeLessThan(75)
    expect(icsFold(ru).split('\r\n')).toHaveLength(2)
    expect(icsFold('SUMMARY:short')).toBe('SUMMARY:short')
  })
})
