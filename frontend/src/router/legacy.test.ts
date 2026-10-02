import { describe, it, expect } from 'vitest'

/**
 * Гвард уборки раскладки (B2C-58, Р-52): разбор заменил \`WeekSalary\` — в коде \`src/\` нет ни экрана, ни
 * его адреса \`/week/salary\`, кроме редиректа в \`router/index.ts\` (старые ссылки и закладки PWA). Тесты не
 * считаются: они проверяют сам редирект. Файлы — через node:fs, как \`style.literals.test.ts\`.
 */
type Dirent = { name: string; isDirectory(): boolean }
type NodeFs = {
  readFileSync(path: URL, encoding: string): string
  readdirSync(path: URL, opts: { withFileTypes: true }): Dirent[]
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs

const SRC = new URL('../', import.meta.url)

/** Код под `src/` (без тестов) — пути относительно `src/`. */
function codeFiles(dir = ''): string[] {
  return fs.readdirSync(new URL(dir || './', SRC), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'test' ? [] : codeFiles(`${rel}/`)
    return /\.(vue|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [rel] : []
  })
}

describe('B2C-58: старой раскладки в коде нет', () => {
  it('нет WeekSalary; адрес /week/salary — только редиректом в router/index.ts', () => {
    const hits = codeFiles().flatMap((rel) =>
      fs
        .readFileSync(new URL(rel, SRC), 'utf-8')
        .split('\n')
        .map((line, i) => ({ rel, line: line.trim(), n: i + 1 }))
        .filter((x) => /WeekSalary|week\/salary/.test(x.line)),
    )
    const allowed = (x: { rel: string; line: string }) =>
      x.rel === 'router/index.ts' && /path: 'week\/salary', redirect:/.test(x.line)
    expect(hits.filter((x) => !allowed(x)).map((x) => `${x.rel}:${x.n} ${x.line}`)).toEqual([])
    expect(hits.filter(allowed)).toHaveLength(1)
  })
})
