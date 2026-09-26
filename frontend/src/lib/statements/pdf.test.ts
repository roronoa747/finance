import { describe, expect, it } from 'vitest'
import { groupItems, type PdfItem } from './pdf'

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
