import { describe, it, expect } from 'vitest'

/**
 * Гвард «тенге из валюты — только `fxToTenge`» (CLAUDE.md правило 6, Р-71, B2C-77): ни один
 * файл `lib/`, `components/`, `views/`, `stores/` не умножает на курс сам — иначе округление
 * разъедется между экранами. Курсом считается имя с сегментом `rate…`/`…Rate…` (кроме ставок
 * кредитов и вкладов: `annualRate`, `costlyRate`) и результат `rateOn(…)`. Исключение одно —
 * сама `fxToTenge` в `lib/finance.ts`. Файлы — через node:fs, как `style.literals.test.ts`.
 */
type Dirent = { name: string; isDirectory(): boolean }
type NodeFs = {
  readFileSync(path: URL, encoding: string): string
  readdirSync(path: URL, opts: { withFileTypes: true }): Dirent[]
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs

const SRC = new URL('./', import.meta.url)

function sources(dir: string): string[] {
  return fs.readdirSync(new URL(dir, SRC), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}${e.name}`
    if (e.isDirectory()) return sources(`${rel}/`)
    return /\.(ts|vue)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [rel] : []
  })
}

/** Ставки, а не курсы валют. */
const NOT_FX = /^(annual|costly|deposit|interest)/i
const NAME = String.raw`[\w.]*(?:\brate|Rate)\w*(?:\.\w+)*`
const MUL_RATE = new RegExp(String.raw`(${NAME})\s*\*|\*\s*\(?\s*(${NAME})|\brateOn\([^)]*\)\s*!?\s*\*|\*\s*rateOn\(`, 'g')

/** Курс ли это: сегмент имени с `rate`/`Rate`, кроме ставок. */
function isFx(m: RegExpMatchArray): boolean {
  const seg = (m[1] ?? m[2] ?? 'rateOn').split('.').find((s) => /^rate|Rate/.test(s)) ?? 'rateOn'
  return !NOT_FX.test(seg)
}

const caught = (line: string) => [...line.matchAll(MUL_RATE)].some(isFx)

const ALLOWED = 'export const fxToTenge = (foreignAmount: number, rate: number) => Math.round(foreignAmount * rate);'

describe('fxToTenge — единственное умножение на курс', () => {
  const files = ['lib/', 'components/', 'views/', 'stores/'].flatMap(sources)

  it('файлы найдены', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('никто, кроме fxToTenge, не умножает на курс', () => {
    const hits: string[] = []
    for (const f of files) {
      fs.readFileSync(new URL(f, SRC), 'utf-8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (f === 'lib/finance.ts' && line.trim() === ALLOWED) return
          if (caught(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(hits).toEqual([])
  })

  it('гвард ловит умножение на курс (самопроверка шаблона)', () => {
    expect(caught('const t = foreign * rate')).toBe(true)
    expect(caught('Math.round(amount * v.rate)')).toBe(true)
    expect(caught('rateValue.value * 2')).toBe(true)
    expect(caught('x * rateOn(book, "EUR", day)!')).toBe(true)
    expect(caught('rateOn(book, "EUR", day)! * x')).toBe(true)
    expect(caught('const i = principal * annualRate')).toBe(false)
    expect(caught('const due = (d.principal * d.annualRate) / 12')).toBe(false)
    expect(caught('Math.round(c.annualRate * 10_000)')).toBe(false)
  })
})
