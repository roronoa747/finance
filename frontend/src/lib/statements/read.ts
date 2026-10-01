import type { Draft, DraftFile } from '@/stores/operations'
import { parseStatement, StatementFormatError } from './parsers'

/**
 * Чтение выбранных PDF-выписок — один цикл для «Недели» и первого запуска (B2C-07, B2C-19):
 * каждый файл отдельно, сбой одного не мешает остальным. pdf.js — ленивым чанком, только когда
 * выбрали файл; сбой загрузки чанка (вышла новая версия, старого чанка на сервере нет) — тоже
 * ошибка файла, а не тишина.
 */
export async function readStatementFiles(files: File[]): Promise<{ ok: DraftFile[]; errors: Draft['errors'] }> {
  const ok: DraftFile[] = []
  const errors: Draft['errors'] = []
  for (const f of files) {
    let stage = 'загрузка'
    try {
      const { pdfToRows } = await import('./pdf')
      stage = 'pdf.js'
      const rows = await pdfToRows(await f.arrayBuffer())
      stage = 'разбор'
      ok.push({ name: f.name, parsed: parseStatement(rows) })
    } catch (err) {
      if (err instanceof StatementFormatError) {
        errors.push({ name: f.name, message: err.code === 'empty' ? 'В файле не нашлось операций' : 'Пока понимаю выписки Kaspi и Freedom' })
        continue
      }
      // Тип и текст ошибки движка или pdf.js — без содержимого выписки.
      console.error('Разбор выписки:', err)
      const detail = `${stage} — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 160)
      errors.push({ name: f.name, message: 'Не получилось прочитать файл', detail })
    }
  }
  return { ok, errors }
}
