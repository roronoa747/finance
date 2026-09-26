// Ступень «файл → строки» (Р-23): текст PDF-выписки → строки таблицы.
// Файл разбирается на устройстве и никуда не уходит (Р-4).

/** Ячейка строки: левый край текста и сам текст (без пробелов по краям). */
export interface PdfCell {
  x: number
  text: string
}

/**
 * Строка страницы. `y` — координата PDF (ось вверх: больше — выше на странице),
 * строки идут сверху вниз, ячейки — слева направо. У xlsx (B2C-04) `page` — лист,
 * `y` — номер строки листа.
 */
export interface PdfRow {
  page: number
  y: number
  cells: PdfCell[]
}

/** Текстовый элемент страницы, как его отдаёт pdf.js (`transform[4]`, `transform[5]`). */
export interface PdfItem {
  page: number
  x: number
  y: number
  text: string
}

/** Элементы одной строки таблицы расходятся по `y` не больше чем на доли пункта. */
export const ROW_TOLERANCE = 2

/**
 * Группирует элементы в строки: страница за страницей, сверху вниз; элемент попадает в
 * строку, если его `y` отличается от `y` первого элемента строки не больше чем на
 * `tolerance`. Пустые и пробельные элементы (pdf.js ставит их между колонками) отброшены.
 */
export function groupItems(items: PdfItem[], tolerance = ROW_TOLERANCE): PdfRow[] {
  const sorted = items
    .map((item) => ({ ...item, text: item.text.trim() }))
    .filter((item) => item.text !== '')
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)

  const rows: PdfRow[] = []
  let current: PdfRow | null = null
  for (const item of sorted) {
    if (!current || current.page !== item.page || current.y - item.y > tolerance) {
      current = { page: item.page, y: item.y, cells: [] }
      rows.push(current)
    }
    current.cells.push({ x: item.x, text: item.text })
  }
  for (const row of rows) row.cells.sort((a, b) => a.x - b.x)
  return rows
}

type Pdfjs = typeof import('pdfjs-dist')

let pdfjs: Promise<Pdfjs> | null = null

const NODE_BUILD = 'pdfjs-dist/legacy/build/pdf.mjs'

// Выбор сборки pdf.js — только здесь. Браузер: обычная сборка ленивым чанком, worker —
// файл пакета (URL от Vite). Node (скрипты, тесты): legacy-сборка — читает текст без
// canvas и без worker-URL; спецификатор в переменной, чтобы Vite не тянул её в сборку.
function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= typeof window === 'undefined'
    ? import(/* @vite-ignore */ NODE_BUILD)
    : Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]).then(([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = worker.default
        return lib
      })
  return pdfjs
}

/** Все строки текста PDF по порядку страниц. */
export async function pdfToRows(data: ArrayBuffer): Promise<PdfRow[]> {
  const lib = await loadPdfjs()
  const task = lib.getDocument({ data: new Uint8Array(data), verbosity: 0 })
  try {
    const doc = await task.promise
    const items: PdfItem[] = []
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        items.push({ page, x: item.transform[4], y: item.transform[5], text: item.str })
      }
    }
    return groupItems(items)
  } finally {
    await task.destroy()
  }
}
