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

  it('пивот 3 (Р-36): нейтральный холст, бренд «глина» прежний, разделы трат s1…s12 и «не разобрано», рамка карточки прозрачна в тёмной', () => {
    expect(root.get('--canvas')).toBe('#f2f2f0')
    expect(dark.get('--canvas')).toBe('#121214')
    expect(root.get('--brand')).toBe('#b4562f')
    expect(dark.get('--brand')).toBe('#e58a62')
    for (let i = 1; i <= 12; i++) {
      expect(root.has(`--s${i}`)).toBe(true)
      expect(dark.has(`--s${i}`)).toBe(true)
    }
    expect(root.has('--s-unknown')).toBe(true)
    expect(root.get('--card-border')).toBe('var(--line)')
    expect(dark.get('--card-border')).toBe('transparent')
    // Бренд и разделы трат пивот не трогает.
    expect(root.get('--s1')).toBe('#c2703f')
    expect(dark.get('--s12')).toBe('#b8b0a2')
  })

  it('пивот 3 (Р-44): участники «шалфей и лаванда», буква в кружке — контраст ≥ 3:1 в обеих темах', () => {
    expect(root.get('--pa')).toBe('#4f7a63')
    expect(root.get('--pb')).toBe('#7d6a9e')
    expect(dark.get('--pa')).toBe('#94c2a8')
    expect(dark.get('--pb')).toBe('#b9a8dc')
    expect(dark.has('--dot-ink')).toBe(true)

    // WCAG relative luminance; `var(--x)` раскрывается в той же теме.
    const hex = (theme: Map<string, string>, v: string): string => {
      const ref = v.match(/^var\((--[\w-]+)\)$/)
      return ref ? hex(theme, theme.get(ref[1]) ?? '') : v
    }
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5]
        .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    for (const theme of [root, dark]) {
      const ink = hex(theme, theme.get('--dot-ink') ?? '')
      for (const p of ['--pa', '--pb']) {
        expect(contrast(ink, theme.get(p) ?? '')).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('пивот 3 (Р-45): токены движения 150–400 мс, полосы ≤ 1 с; «уменьшить движение» гасит анимации, переходы и задержки', () => {
    const sizes = tokens(css.match(/:root\s*\{([^}]*--motion-fast[^}]*)\}/)?.[1] ?? '')
    const ms = (k: string) => parseInt(sizes.get(k) ?? '', 10)
    expect(ms('--motion-fast')).toBeGreaterThanOrEqual(150)
    expect(ms('--motion-base')).toBeLessThanOrEqual(400)
    expect(ms('--motion-slow')).toBeLessThanOrEqual(400)
    expect(ms('--motion-fill')).toBeLessThanOrEqual(1000)
    expect(sizes.get('--ease-out')).toMatch(/^cubic-bezier\(/)
    for (const u of ['press', 'fx-in', 'fx-fade', 'fx-sheet']) expect(css).toContain(`@utility ${u} {`)
    const reduce = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    for (const rule of ['animation-duration', 'animation-delay', 'transition-duration', 'transition-delay']) {
      expect(reduce).toContain(`${rule}:`)
    }
  })

  it('пивот 3 (Р-36): шрифт системный, крупные цифры — ui-rounded, Google Fonts нет', () => {
    expect(theme.get('--font-display')).toMatch(/^-apple-system/)
    expect(theme.get('--font-sans')).toMatch(/^-apple-system/)
    expect(theme.get('--font-num')).toMatch(/^ui-rounded/)
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf-8')
    for (const bad of ['Piazzolla', 'Golos', 'Onest', 'fonts.googleapis']) {
      expect(css).not.toContain(bad)
      expect(html).not.toContain(bad)
    }
    // Крупные цифры (процент героя, большие суммы) — на --font-num, вес 700.
    for (const u of ['type-percent', 'type-big', 'type-big-md']) {
      const body = css.match(new RegExp(`@utility ${u} \\{([^}]*)\\}`))?.[1] ?? ''
      expect(body).toContain('font-family: var(--font-num)')
      expect(body).toContain('font-weight: 700')
    }
  })
})
