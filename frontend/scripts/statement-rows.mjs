// Снимает строки с корпуса выписок (B2C-01): STATEMENTS_DIR/<банк>/<файл>.pdf →
// <выход>/<банк>/<файл>.rows.json. Корпус и результат — вне git (инвариант 11):
// выход указывать в scratchpad или memory/secrets/.
//
//   STATEMENTS_DIR=../memory/secrets/statements node scripts/statement-rows.mjs <выход>
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { pdfToRows } from '../src/lib/statements/pdf.ts'

const dir = process.env.STATEMENTS_DIR
const out = process.argv[2]
if (!dir || !out) {
  console.error('usage: STATEMENTS_DIR=<корпус> node scripts/statement-rows.mjs <выход>')
  process.exit(1)
}

function* files(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else yield path
  }
}

let done = 0
for (const path of files(dir)) {
  const ext = extname(path).toLowerCase()
  const rel = relative(dir, path)
  if (ext !== '.pdf') {
    // xlsx читает B2C-04 (если формат появится в корпусе), остальное — не выписки.
    console.log(`skip ${rel}: ${ext === '.xlsx' ? 'xlsx — B2C-04' : 'не PDF'}`)
    continue
  }
  const data = readFileSync(path)
  const rows = await pdfToRows(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const target = join(out, relative(dir, join(path, '..')))
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, `${basename(path, ext)}.rows.json`), JSON.stringify(rows))
  const pages = rows.length ? rows[rows.length - 1].page : 0
  console.log(`${rel}: страниц ${pages}, строк ${rows.length}`)
  done++
}
console.log(`файлов снято: ${done}`)
