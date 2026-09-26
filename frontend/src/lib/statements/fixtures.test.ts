import { describe, expect, it } from 'vitest'
import type { PdfRow } from './pdf'

// Гвард фикстур (B2C-01, Р-23): в git не должно попасть ничего, похожего на личные данные.
// Фикстуры синтетические (CORPUS.md), гвард страхует от правки руками и от генератора.
const fixtures = import.meta.glob<PdfRow[]>('./fixtures/*.rows.json', { eager: true, import: 'default' })

// Фамилии владельца и партнёра — только локально, из каталога корпуса (вне git);
// в CI файла нет — работают базовые правила.
const secretLists = import.meta.glob<string>('../../../../memory/secrets/statements/README.md', {
  eager: true, query: '?raw', import: 'default',
})
const surnames = Object.values(secretLists)
  .flatMap((text) => text.split('\n'))
  .map((line) => /^- (\p{L}[\p{L}-]*)\s*$/u.exec(line)?.[1])
  .filter((word): word is string => Boolean(word))

const names = Object.keys(fixtures)
const textOf = (rows: PdfRow[]) => rows.flatMap((r) => r.cells.map((c) => c.text)).join('\n')

describe('фикстуры выписок', () => {
  it('по две и больше на банк', () => {
    for (const bank of ['kaspi', 'freedom']) {
      expect(names.filter((n) => n.includes(`/${bank}-`)).length).toBeGreaterThanOrEqual(2)
    }
  })

  describe.each(names)('%s', (name) => {
    const text = textOf(fixtures[name])

    it('формат строк pdfToRows', () => {
      for (const row of fixtures[name]) {
        expect(row.page).toBeGreaterThanOrEqual(1)
        expect(row.cells.length).toBeGreaterThan(0)
        for (const cell of row.cells) expect(cell.text).toBe(cell.text.trim())
      }
    })

    it('нет последовательностей из 6+ цифр', () => {
      expect(text.match(/\d{6,}/g)).toBeNull()
    })

    it('нет IBAN-подобных строк', () => {
      expect(text.match(/KZ[0-9A-Z]{18}/g)).toBeNull()
    })

    it('нет паролей и ключей', () => {
      expect(text).not.toMatch(/password|пароль|secret|token/i)
    })

    it('нет фамилий владельца и партнёра', () => {
      for (const surname of surnames) {
        expect(text.toLowerCase()).not.toContain(surname.toLowerCase())
      }
    })
  })
})
