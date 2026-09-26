import { assignIds, sanitize } from '../model'
import type { PdfRow } from '../pdf'
import type { Operation, OperationKind, ParsedStatement } from '../types'
import { StatementFormatError, findHeader, logSkipped, rowText } from './common'

// Парсер Freedom Super Card (B2C-04). Формат — CORPUS.md «Freedom»: таблица «Дата · Сумма ·
// Валюта · Операция · Детали» на каждой странице; ячейки центрируются по вертикали — строка
// с датой посередине многострочного блока, продолжения выше и ниже неё.

const HEADER = ['Дата', 'Сумма', 'Валюта', 'Операция', 'Детали']
const DATE = /^(\d\d)\.(\d\d)\.(\d{4})$/
/** «-1,260.00 ₸», «+21.31 $» — тиын и центы отбрасываются. */
const AMOUNT = /^([+-])(\d{1,3}(?:,\d{3})*)\.(\d{2})\s?(?:₸|\$|€|¥|₺|₽|AED)?$/
const PERIOD = /за период с (\d\d\.\d\d\.\d{4}) по (\d\d\.\d\d\.\d{4})/
const FOOTER = /^Подлинность справки/
/** «Дана К.» в начале деталей перевода (полное ФИО `sanitize` уже сократил) + остальное. */
const PERSON_LEAD = /^(\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)? \p{Lu}\.)(?:\s*\.)?\s*(.*)$/u
/**
 * ФИО, которое `sanitize` не узнал (отчество без известного окончания, «Серік ұлы» отдельным
 * словом, без отчества): у Freedom после ФИО отправителя всегда « .» — опора на неё, а не на
 * окончания. «Фамилия Имя [Отчество] .» в начале деталей → «Имя Ф.» (Р-23).
 */
const FULL_NAME_LEAD = /^(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?) (\p{Lu}\p{Ll}+)(?: \p{Lu}\p{Ll}+(?: \p{Ll}+)?)? \./u
/**
 * Внутри блока строки стоят не дальше шага 12,7 pt, между блоками — от 19 pt (CORPUS.md):
 * зазор от 16 pt начинает новую операцию.
 */
const BLOCK_GAP = 16

const Col = { Date: 0, Amount: 1, Currency: 2, Op: 3, Details: 4 } as const
type Col = (typeof Col)[keyof typeof Col]

interface Cell {
  col: Col
  text: string
}

interface TableRow {
  row: PdfRow
  cells: Cell[]
  date: string | null
}

/** Операция: строка с датой и все строки её блока по порядку чтения. */
interface Block {
  row: PdfRow
  date: string
  cells: Cell[]
}

const isoDate = (d: string) => d.replace(DATE, '$3-$2-$1')

export function isFreedom(rows: PdfRow[]): boolean {
  return rows.some((r) => r.cells.some((c) => c.text.includes('KSNVKZKA')))
}

/**
 * Колонки. Даты, суммы и валюты стоят под своими заголовками — границы по серединам.
 * «Детали» напечатаны на ~70 pt левее своего заголовка, почти у «Операции» (CORPUS.md),
 * поэтому граница «Операция | Детали» — 40 pt правее заголовка «Операция».
 */
function columns(xs: number[]): (x: number) => Col {
  const [date, amount, currency, op] = xs
  const b1 = (date + amount) / 2
  const b2 = (amount + currency) / 2
  const b3 = (currency + op) / 2
  const b4 = op + 40
  return (x) => (x < b1 ? Col.Date : x < b2 ? Col.Amount : x < b3 ? Col.Currency : x < b4 ? Col.Op : Col.Details)
}

/** Строки таблицы: от заголовка страницы до её колонтитула. */
function tableRows(rows: PdfRow[]): TableRow[] {
  const out: TableRow[] = []
  let column: ((x: number) => Col) | null = null
  let page = 0
  for (const row of rows) {
    if (row.page !== page) {
      page = row.page
      column = null
    }
    const header = findHeader([row], HEADER)
    if (header) {
      column = columns(header.xs)
      continue
    }
    if (!column) continue
    if (row.cells.some((c) => FOOTER.test(c.text))) {
      column = null
      continue
    }
    const cells = row.cells.map((c) => ({ col: column!(c.x), text: c.text }))
    const date = cells.find((c) => c.col === Col.Date && DATE.test(c.text))
    out.push({ row, cells, date: date ? isoDate(date.text) : null })
  }
  return out
}

/**
 * Операции из строк таблицы. Зазор от BLOCK_GAP или новая страница режут таблицу на блоки;
 * в блоке одна строка с датой (две — делятся по ближайшей). Блок без даты внизу страницы —
 * начало ячейки, разорванной между страницами (CORPUS.md): оно уходит в начало первой
 * операции следующей страницы.
 */
function assemble(table: TableRow[]): { blocks: Block[]; lost: number } {
  const groups: TableRow[][] = []
  for (const r of table) {
    const last = groups[groups.length - 1]?.at(-1)
    if (!last || last.row.page !== r.row.page || last.row.y - r.row.y >= BLOCK_GAP) groups.push([r])
    else groups[groups.length - 1].push(r)
  }

  const blocks: Block[] = []
  let carried: Cell[] = []
  let lost = 0
  groups.forEach((group, i) => {
    const page = group[0].row.page
    const dated = group.filter((r) => r.date)
    if (!dated.length) {
      const next = groups[i + 1]?.[0].row.page
      if (next !== undefined && next !== page) carried = [...carried, ...group.flatMap((r) => r.cells)]
      else {
        lost++
        logSkipped('freedom', group[0].row)
      }
      return
    }
    const own = dated.map((r) => ({ row: r.row, date: r.date!, cells: [] as Cell[] }))
    for (const r of group) {
      const nearest = own.reduce((best, b) => (Math.abs(b.row.y - r.row.y) < Math.abs(best.row.y - r.row.y) ? b : best))
      nearest.cells.push(...r.cells)
    }
    own[0].cells.unshift(...carried)
    carried = []
    blocks.push(...own)
  })
  return { blocks, lost }
}

/** «Операция» → вид. Детали уточняют переводы: своя конвертация — внутренняя. */
function kindOf(name: string, amount: number, details: string): { kind: OperationKind; internal: boolean } {
  const transfer: OperationKind = amount < 0 ? 'transfer-out' : 'transfer-in'
  switch (name) {
    case 'Покупка':
    case 'Платеж':
      return { kind: 'purchase', internal: false }
    case 'Сумма в обработке':
      return { kind: /^Перевод с карты/.test(details) ? transfer : 'purchase', internal: false }
    case 'Перевод':
      if (/^Перевод валюты Freedom/.test(details)) return { kind: transfer, internal: true }
      if (/^Возврат кешбека/.test(details)) return { kind: 'other', internal: false }
      return { kind: transfer, internal: false }
    case 'Пополнение':
      return { kind: 'transfer-in', internal: false }
    case 'Снятие':
      return { kind: 'cash', internal: false }
    case 'Платеж по кредиту':
    case 'Погашение':
      return { kind: 'transfer-out', internal: false }
    default:
      return { kind: 'other', internal: false }
  }
}

export function parseFreedom(rows: PdfRow[]): ParsedStatement {
  if (!isFreedom(rows)) throw new StatementFormatError('not-freedom')
  const period = rows.map(rowText).map((t) => PERIOD.exec(t)).find(Boolean)
  if (!period || !findHeader(rows, HEADER)) throw new StatementFormatError('empty')

  const { blocks, lost } = assemble(tableRows(rows))
  const text = (b: Block, col: Col) => b.cells.filter((c) => c.col === col).map((c) => c.text).join(' ')

  // Кусок таблицы без даты, который не перенос между страницами, — неразобранная строка.
  let skipped = lost
  let skippedForeign = 0
  const operations: Omit<Operation, 'id'>[] = []
  for (const b of blocks) {
    const m = AMOUNT.exec(text(b, Col.Amount))
    const currency = text(b, Col.Currency)
    const name = text(b, Col.Op)
    const details = sanitize(text(b, Col.Details)).replace(FULL_NAME_LEAD, (_, surname: string, name: string) => `${name} ${surname[0]}.`)
    if (!m || !name) {
      skipped++
      logSkipped('freedom', b.row)
      continue
    }
    // Валюты кроме тенге — не-скоуп (бриф): суммы в тенге банк в строке не печатает.
    if (currency !== 'KZT') {
      skipped++
      skippedForeign++
      continue
    }
    const amount = (m[1] === '-' ? -1 : 1) * Number(m[2].replace(/,/g, ''))
    const { kind, internal } = kindOf(name, amount, details)
    const person = kind === 'transfer-out' || kind === 'transfer-in' ? PERSON_LEAD.exec(details) : null
    operations.push({
      bank: 'freedom',
      date: b.date,
      amount,
      kind,
      merchant: person ? person[1] : details || name,
      ...(person ? { counterparty: person[1] } : {}),
      note: sanitize([name, person?.[2]].filter(Boolean).join(' · ')),
      categoryId: null,
      internal,
    })
  }
  if (!operations.length) throw new StatementFormatError('empty')
  return {
    bank: 'freedom',
    from: isoDate(period[1]),
    to: isoDate(period[2]),
    operations: assignIds(operations),
    skipped,
    skippedForeign,
  }
}
