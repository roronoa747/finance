import type { PdfRow } from '../pdf'
import type { BankId, ParsedStatement } from '../types'
import { StatementFormatError } from './common'
import { isKaspi, parseKaspi } from './kaspi'

// Реестр парсеров (B2C-03): банк определяется по строкам файла, не по имени.

export { StatementFormatError } from './common'

const PARSERS: { bank: BankId; is: (rows: PdfRow[]) => boolean; parse: (rows: PdfRow[]) => ParsedStatement }[] = [
  { bank: 'kaspi', is: isKaspi, parse: parseKaspi },
]

export function detectBank(rows: PdfRow[]): BankId | null {
  return PARSERS.find((p) => p.is(rows))?.bank ?? null
}

export function parseStatement(rows: PdfRow[]): ParsedStatement {
  const parser = PARSERS.find((p) => p.is(rows))
  if (!parser) throw new StatementFormatError('unknown-bank')
  return parser.parse(rows)
}
