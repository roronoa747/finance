import { describe, it, expect } from 'vitest'

/**
 * Гвард «цвет только из токена» в компонентах (CLAUDE.md правило 6; ревью Блока 3 Н-14):
 * `style.tokens.test.ts` держит пары в `style.css`, этот — что `.vue` цвет литералом не пишут
 * (у литерала нет пары тёмной темы). Исключений нет. Плюс `lib/storyCard.ts`: canvas переменных
 * не читает, поэтому там копии светлых значений токенов (DESIGN §7) — они обязаны совпадать со
 * `style.css`, иначе смена токена разъедется молча. Файлы — через node:fs, как `style.tokens.test.ts`.
 */
type Dirent = { name: string; isDirectory(): boolean }
type NodeFs = {
  readFileSync(path: URL, encoding: string): string
  readdirSync(path: URL, opts: { withFileTypes: true }): Dirent[]
}
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs

const SRC = new URL('./', import.meta.url)
const read = (rel: string) => fs.readFileSync(new URL(rel, SRC), 'utf-8')

/** Все `.vue` под `src/` — пути относительно `src/`. */
function vueFiles(dir = ''): string[] {
  return fs.readdirSync(new URL(dir || './', SRC), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : vueFiles(`${rel}/`)
    return e.name.endsWith('.vue') ? [rel] : []
  })
}

const FORBIDDEN: [string, RegExp][] = [
  ['#hex', /#[0-9a-f]{3,8}\b/gi],
  ['rgb(', /\brgba?\(/gi],
  ['bg-black / bg-white', /\bbg-(?:black|white)\b/g],
  ['text-white', /\btext-white\b/g],
]

describe('*.vue — цвет только из токена (Н-14)', () => {
  const files = vueFiles()

  it('компоненты найдены', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain('components/goals/WishSheet.vue')
  })

  it('нет #hex, rgb(, bg-black|white, text-white', () => {
    const hits = files.flatMap((f) =>
      read(f)
        .split('\n')
        .flatMap((line, i) => FORBIDDEN.filter(([, re]) => line.match(re)).map(([what]) => `${f}:${i + 1} ${what}: ${line.trim()}`)),
    )
    expect(hits).toEqual([])
  })

  it('гвард ловит литералы (самопроверка шаблонов)', () => {
    const caught = (s: string) => FORBIDDEN.some(([, re]) => s.match(re))
    for (const bad of ['color: #fff;', 'fill="#E6DED2"', 'rgb(0 0 0)', 'rgba(0,0,0,.5)', 'bg-white', 'bg-black/40', 'text-white']) expect(caught(bad)).toBe(true)
    for (const ok of ['bg-surface-3', 'text-on-photo', '<template #default>', 'bg-photo-scrim', 'text-ink']) expect(caught(ok)).toBe(false)
  })
})

describe('lib/storyCard.ts — копии светлых токенов равны style.css (Н-14)', () => {
  const css = read('style.css')
  const root = new Map([...(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const story = read('lib/storyCard.ts')
  const constant = (name: string) => story.match(new RegExp(`const ${name} = '([^']+)'`))?.[1]

  /** `#rrggbb` → `r,g,b`. */
  const rgbOfHex = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')

  it('NO_PHOTO_BG = --surface-3, INK = --ink, WHITE = --on-photo (светлая тема)', () => {
    expect(root.get('--surface-3')).toMatch(/^#[0-9a-f]{6}$/i)
    expect(constant('NO_PHOTO_BG')?.toLowerCase()).toBe(root.get('--surface-3')!.toLowerCase())
    expect(constant('INK')).toBe(rgbOfHex(root.get('--ink')!))
    expect(constant('WHITE')).toBe(rgbOfHex(root.get('--on-photo')!))
  })

  it('градиент под текстом — цвет --photo-scrim светлой темы', () => {
    const scrim = root.get('--photo-scrim')!.match(/^rgb\((\d+) (\d+) (\d+)/)
    expect(scrim).not.toBeNull()
    const rgb = scrim!.slice(1, 4).join(',')
    const used = [...story.matchAll(/rgba\((\d+,\d+,\d+),[\d.]+\)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    expect(new Set(used)).toEqual(new Set([rgb]))
  })
})
