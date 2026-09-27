import { describe, it, expect } from 'vitest'

/**
 * Гвард токенов (B2C-12, Р-19): каждый цвет из `:root` есть в `.dark` и наоборот, и у каждого
 * цвета есть класс Tailwind в `@theme inline`. Читает `style.css` как текст — пропущенная пара
 * ловится тестом, а не пропавшим в тёмной теме элементом. Vitest отдаёт CSS-модули пустыми
 * (и `?raw` тоже), поэтому файл читается через node:fs — как корпус в `corpus.test.ts`.
 */
type NodeFs = { readFileSync(path: URL, encoding: string): string }
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs
const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf-8')

const block = (selector: RegExp) => css.match(selector)?.[1] ?? ''
const tokens = (body: string) => new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))

// Первый блок :root — цвета; второй (размеры) и мост shadcn (var(...)) пар не требуют.
const root = tokens(block(/:root\s*\{([^}]*)\}/))
const dark = tokens(block(/\.dark\s*\{([^}]*)\}/))
const theme = tokens(block(/@theme inline\s*\{([^}]*)\}/))

const isColor = (v: string) => /#[0-9a-f]{3,8}\b|rgb\(|^transparent$/i.test(v)

describe('style.css — пары токенов light/dark', () => {
  it('каждый цвет :root есть в .dark', () => {
    const missing = [...root].filter(([k, v]) => isColor(v) && !dark.has(k)).map(([k]) => k)
    expect(missing).toEqual([])
  })

  it('каждый токен .dark есть в :root', () => {
    const extra = [...dark.keys()].filter((k) => !root.has(k))
    expect(extra).toEqual([])
  })

  it('у каждого цвета — класс в @theme inline (--color-<имя>), у теней — --shadow-*', () => {
    const noClass = [...root]
      .filter(([k, v]) => isColor(v) && !k.startsWith('--shadow'))
      .filter(([k]) => !theme.has(`--color-${k.slice(2)}`))
      .map(([k]) => k)
    expect(noClass).toEqual([])
    expect(theme.get('--shadow-sheet')).toBe('var(--shadow-sheet)')
  })

  it('направление А: холст, бренд «глина», разделы трат s1…s12 и «не разобрано», рамка карточки прозрачна в тёмной', () => {
    expect(root.get('--canvas')).toBe('#f3eee6')
    expect(dark.get('--canvas')).toBe('#17130f')
    expect(root.get('--brand')).toBe('#b4562f')
    expect(dark.get('--brand')).toBe('#e58a62')
    for (let i = 1; i <= 12; i++) {
      expect(root.has(`--s${i}`)).toBe(true)
      expect(dark.has(`--s${i}`)).toBe(true)
    }
    expect(root.has('--s-unknown')).toBe(true)
    expect(root.get('--card-border')).toBe('var(--line)')
    expect(dark.get('--card-border')).toBe('transparent')
    expect(theme.get('--font-display')).toContain('Piazzolla')
    expect(css).not.toContain('Onest')
  })
})
