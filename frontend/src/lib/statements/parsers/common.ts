import type { PdfRow } from '../pdf'

// Общее у парсеров банков: ошибка формата и поиск заголовка таблицы.

export type StatementErrorCode = 'not-kaspi' | 'not-freedom' | 'empty' | 'unknown-bank'

/** Файл не той выписки или без операций — экран говорит об этом спокойным текстом. */
export class StatementFormatError extends Error {
  readonly code: StatementErrorCode
  constructor(code: StatementErrorCode) {
    super(`statement format: ${code}`)
    this.name = 'StatementFormatError'
    this.code = code
  }
}

/** Все тексты строки через пробел. */
export const rowText = (row: PdfRow) => row.cells.map((c) => c.text).join(' ')

/** Первая строка, где есть все заголовки колонок; x заголовков — по порядку `titles`. */
export function findHeader(rows: PdfRow[], titles: string[]): { index: number; xs: number[] } | null {
  for (let index = 0; index < rows.length; index++) {
    const xs = titles.map((t) => rows[index].cells.find((c) => c.text === t)?.x)
    if (xs.every((x) => x !== undefined)) return { index, xs: xs as number[] }
  }
  return null
}

/** Неразобранная строка таблицы: в разработке — в консоль, в проде — только счётчик. */
export function logSkipped(bank: string, row: PdfRow): void {
  if (import.meta.env?.DEV) console.warn(`[${bank}] строка не разобрана: стр. ${row.page}, y ${row.y}`)
}
