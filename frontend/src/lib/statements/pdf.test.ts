import { describe, expect, it } from 'vitest'
import { groupItems, pdfToRows, type PdfItem } from './pdf'

const item = (page: number, x: number, y: number, text: string): PdfItem => ({ page, x, y, text })
const texts = (rows: ReturnType<typeof groupItems>) => rows.map((r) => r.cells.map((c) => c.text))

describe('groupItems', () => {
  it('элементы с близким y — одна строка, ячейки по x', () => {
    const rows = groupItems([
      item(1, 311, 317.8, 'Magnum'),
      item(1, 51.8, 317.8, '26.07.25'),
      item(1, 257, 318.6, 'Покупка'),
      item(1, 139.8, 317.1, '- 4 200,00 ₸'),
    ])
    expect(texts(rows)).toEqual([['26.07.25', '- 4 200,00 ₸', 'Покупка', 'Magnum']])
    expect(rows[0].cells.map((c) => c.x)).toEqual([51.8, 139.8, 257, 311])
  })

  it('строки сверху вниз; разрыв больше допуска — новая строка', () => {
    const rows = groupItems([
      item(1, 40, 301.9, 'вторая'),
      item(1, 40, 317.8, 'первая'),
      item(1, 273, 297, 'третья'), // 4,9 pt ниже «второй» — уже не она
    ])
    expect(texts(rows)).toEqual([['первая'], ['вторая'], ['третья']])
    expect(rows.map((r) => r.y)).toEqual([317.8, 301.9, 297])
  })

  it('допуск меряется от первого элемента строки, а не цепочкой', () => {
    const rows = groupItems([item(1, 10, 100, 'a'), item(1, 20, 98.5, 'b'), item(1, 30, 97, 'c')])
    expect(texts(rows)).toEqual([['a', 'b'], ['c']])
  })

  it('две страницы не смешиваются даже при одинаковом y', () => {
    const rows = groupItems([item(2, 40, 700, 'стр2'), item(1, 40, 700, 'стр1'), item(1, 90, 700, 'ещё')])
    expect(rows.map((r) => r.page)).toEqual([1, 2])
    expect(texts(rows)).toEqual([['стр1', 'ещё'], ['стр2']])
  })

  it('пробельные элементы между колонками отброшены, текст обрезан', () => {
    const rows = groupItems([
      item(1, 51.8, 300, '26.07.25'),
      item(1, 88.8, 300, '        '),
      item(1, 257, 300, 'Покупка '),
      item(1, 40, 280, ''),
    ])
    expect(texts(rows)).toEqual([['26.07.25', 'Покупка']])
  })
})

/** PDF в одну страницу с двумя строками текста (стандартный шрифт, без встраивания). */
function tinyPdf(lines: string[]): ArrayBuffer {
  const stream = lines.map((l, i) => `BT /F1 12 Tf 20 ${160 - i * 20} Td (${l}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((o, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf).buffer as ArrayBuffer
}

describe('pdfToRows', () => {
  it('читает текст и без асинхронного перебора ReadableStream (Safari на iPhone)', async () => {
    const proto = ReadableStream.prototype as unknown as Record<symbol | string, unknown>
    const saved = { iterator: proto[Symbol.asyncIterator], values: proto.values }
    delete proto[Symbol.asyncIterator]
    delete proto.values
    try {
      const rows = await pdfToRows(tinyPdf(['26.07.25 Magnum', 'Hello statement']))
      expect(texts(rows)).toEqual([['26.07.25 Magnum'], ['Hello statement']])
    } finally {
      proto[Symbol.asyncIterator] = saved.iterator
      proto.values = saved.values
    }
  })
})
