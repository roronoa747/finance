import { assignIds, sanitize } from '../model'
import type { PdfRow } from '../pdf'
import type { Operation, OperationKind, ParsedStatement } from '../types'
import { StatementFormatError, findHeader, logSkipped, rowText } from './common'

// Парсер Kaspi Gold (B2C-03). Формат — CORPUS.md «Kaspi»: таблица «Дата · Сумма · Операция ·
// Детали», строка операции — 4 ячейки на одном y, перенос в «Операции»/«Деталях» — следующая
// строка без даты; от новых к старым.

const HEADER = ['Дата', 'Сумма', 'Операция', 'Детали']
const DATE = /^(\d\d)\.(\d\d)\.(\d\d)$/
/** «- 12 500,00 ₸», «+ 893,82 ₸» — тиын отбрасываются. */
const AMOUNT = /^([+-])\s?(\d{1,3}(?:\s\d{3})*),(\d{2})\s?₸$/
const PERIOD = /за период с (\d\d\.\d\d\.\d\d) по (\d\d\.\d\d\.\d\d)/
/** «Дана К.», «Нур Али Т.», «Ruslan T.» — имя и инициал, как печатает банк. */
const PERSON = /^\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)? \p{Lu}\.$/u
/** Строка продолжения — не дальше полутора шагов строки (15,9 pt) от предыдущей. */
const LINE_GAP = 24

/**
 * «Операция» → вид. Знак решает, покупка это или возврат; перевод со своего депозита —
 * внутренний. Незнакомая операция — `other`, не пропуск: сумма и дата всё равно верны.
 */
function kindOf(name: string, amount: number, details: string): { kind: OperationKind; internal: boolean } {
  switch (name) {
    case 'Покупка':
      return { kind: 'purchase', internal: false }
    case 'Перевод':
      return { kind: amount < 0 ? 'transfer-out' : 'transfer-in', internal: false }
    case 'Пополнение':
      return { kind: 'transfer-in', internal: false }
    case 'Перевод на свой счет':
      // Платёж по Kaspi Кредиту / Red — трата (раздел «Кредиты»); на свой депозит — внутренний.
      return { kind: 'transfer-out', internal: /депозит/i.test(details) }
    case 'Поступление со своего счета':
      return { kind: 'transfer-in', internal: true }
    case 'Снятие':
      return { kind: 'cash', internal: false }
    case 'Разное':
      return { kind: /комисси/i.test(details) ? 'fee' : 'other', internal: false }
    default:
      // «Зачисление кредита» и всё новое: не доход и не трата по виду.
      return { kind: 'other', internal: false }
  }
}

const isoDate = (d: string) => d.replace(DATE, '20$3-$2-$1')

export function isKaspi(rows: PdfRow[]): boolean {
  return rows.some((r) => r.cells.some((c) => c.text.includes('CASPKZKA')))
}

interface Draft {
  row: PdfRow
  date: string
  amount: number | null
  op: string[]
  details: string[]
  lastY: number
}

export function parseKaspi(rows: PdfRow[]): ParsedStatement {
  if (!isKaspi(rows)) throw new StatementFormatError('not-kaspi')
  const period = rows.map(rowText).map((t) => PERIOD.exec(t)).find(Boolean)
  const header = findHeader(rows, HEADER)
  if (!period || !header) throw new StatementFormatError('empty')

  // Границы колонок — середины между заголовками (у Kaspi текст стоит под ними).
  const [b1, b2, b3] = [0, 1, 2].map((i) => (header.xs[i] + header.xs[i + 1]) / 2)
  const column = (x: number) => (x < b1 ? 0 : x < b2 ? 1 : x < b3 ? 2 : 3)

  const drafts: Draft[] = []
  let current: Draft | null = null
  for (const row of rows.slice(header.index + 1)) {
    const first = row.cells[0]
    if (DATE.test(first.text) && column(first.x) === 0) {
      const money = row.cells.find((c) => column(c.x) === 1)
      const m = money && AMOUNT.exec(money.text)
      current = {
        row,
        date: isoDate(first.text),
        amount: m ? (m[1] === '-' ? -1 : 1) * Number(m[2].replace(/\s/g, '')) : null,
        op: row.cells.filter((c) => column(c.x) === 2).map((c) => c.text),
        details: row.cells.filter((c) => column(c.x) === 3).map((c) => c.text),
        lastY: row.y,
      }
      drafts.push(current)
      continue
    }
    // Перенос: строка сразу под операцией, только в «Операции» и «Деталях».
    const continues =
      current && row.page === current.row.page && current.lastY - row.y < LINE_GAP &&
      row.cells.every((c) => column(c.x) >= 2)
    if (continues && current) {
      current.op.push(...row.cells.filter((c) => column(c.x) === 2).map((c) => c.text))
      current.details.push(...row.cells.filter((c) => column(c.x) === 3).map((c) => c.text))
      current.lastY = row.y
    } else {
      current = null // колонтитул, шапка страницы, сноска — операция кончилась
    }
  }

  let skipped = 0
  const operations: Omit<Operation, 'id'>[] = []
  for (const d of drafts) {
    const name = d.op.join(' ')
    const details = sanitize(d.details.join(' '))
    if (d.amount === null || !name || !details) {
      skipped++
      logSkipped('kaspi', d.row)
      continue
    }
    const { kind, internal } = kindOf(name, d.amount, details)
    operations.push({
      bank: 'kaspi',
      date: d.date,
      amount: d.amount,
      kind,
      merchant: details,
      ...(PERSON.test(details) ? { counterparty: details } : {}),
      note: sanitize(name),
      categoryId: null,
      internal,
    })
  }
  if (!operations.length) throw new StatementFormatError('empty')
  return { bank: 'kaspi', from: isoDate(period[1]), to: isoDate(period[2]), operations: assignIds(operations), skipped }
}
