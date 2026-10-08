import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Проверяет собранный dist: запускать после `npm run build` (так идёт CI).
// Признак сборки — index.html, а не sw.js: иначе пропажа SW пропустила бы тест молча.
const dist = resolve(import.meta.dirname, '../dist')
const built = existsSync(resolve(dist, 'index.html'))

// Цвета — из токенов style.css (правило 6 CLAUDE.md): фон экрана и бренд светлой / тёмной темы.
const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8')
const token = (selector: RegExp, name: string) =>
  new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(css.match(selector)?.[1] ?? '')?.[1].toUpperCase()
const LIGHT = /:root\s*\{([^}]*)\}/
const DARK = /\.dark\s*\{([^}]*)\}/

describe('B2C-53: строка сверху — цвет фона, бренд — только в style.css и иконке', () => {
  it('в index.html и vite.config.ts нет бренда #B4562F', () => {
    for (const f of ['../index.html', '../vite.config.ts']) {
      expect(readFileSync(resolve(import.meta.dirname, f), 'utf-8').toUpperCase(), f).not.toContain('#B4562F')
    }
  })

  it('index.html: два theme-color по системной теме — --canvas светлой и тёмной', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf-8')
    const metas = [...html.matchAll(/<meta name="theme-color" media="\(prefers-color-scheme: (light|dark)\)" content="(#[0-9a-f]{6})"/gi)]
    expect(Object.fromEntries(metas.map((m) => [m[1], m[2].toUpperCase()]))).toEqual({
      light: token(LIGHT, '--canvas'),
      dark: token(DARK, '--canvas'),
    })
    expect(html.match(/name="theme-color"/g)).toHaveLength(2)
  })
})

describe.skipIf(!built)('PWA-сборка Vue (MGV-17)', () => {
  it('манифест — имя, язык, standalone', () => {
    const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf-8'))
    expect(manifest).toMatchObject({
      name: 'Family Finance',
      short_name: 'FF',
      lang: 'ru',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    })
    // Заставка и строка установленной PWA — светлый фон экрана, не бренд (B2C-53).
    expect(manifest.background_color).toBe(token(LIGHT, '--canvas'))
    expect(manifest.theme_color).toBe(token(LIGHT, '--canvas'))
    expect(manifest.icons).toEqual([
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ])
  })

  it('SW на /sw.js со scope / перехватывает управление и не трогает /api/', () => {
    const register = readFileSync(resolve(dist, 'registerSW.js'), 'utf-8')
    expect(register).toContain("register('/sw.js', { scope: '/' })")

    const sw = readFileSync(resolve(dist, 'sw.js'), 'utf-8')
    expect(sw).toContain('skipWaiting()')
    expect(sw).toContain('clientsClaim()')
    expect(sw).toContain('cleanupOutdatedCaches()')
    expect(sw).toContain(String.raw`createHandlerBoundToURL("index.html"),{denylist:[/^\/api\//]}`)
    // API в прекэш и runtime-кэш не попадает
    expect(sw).not.toMatch(/url:"\/?api\//)
    expect(sw).not.toContain(String.raw`registerRoute(/^\/api`)
  })

  it('приложение перезагружается на новую версию SW и проверяет её при возврате (PV-07)', () => {
    const assets = resolve(dist, 'assets')
    const js = readdirSync(assets)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(resolve(assets, f), 'utf-8'))
      .join('\n')
    expect(js).toContain('controllerchange')
    expect(js).toContain('visibilitychange')
    expect(js).toContain('getRegistration')
  })

  it('иконка в цвет бренда: заливка = --brand светлой темы (направление А, B2C-12); строка сверху — фон (B2C-53)', () => {
    // Сверка с React-эталоном ушла вместе с паритетом React→Vue (прод на Go + Vue с 2026-09-24).
    const icon = readFileSync(resolve(dist, 'favicon.svg'), 'utf-8')
    const fill = /<rect width="64" height="64" rx="14" fill="(#[0-9A-Fa-f]{6})"/.exec(icon)?.[1]
    expect(fill?.toUpperCase()).toBe(token(LIGHT, '--brand'))
  })

  it('собранный index.html несёт оба theme-color (B2C-53)', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf-8')
    expect(html).toContain(`media="(prefers-color-scheme: light)" content="${token(LIGHT, '--canvas')?.toLowerCase()}"`)
    expect(html).toContain(`media="(prefers-color-scheme: dark)" content="${token(DARK, '--canvas')?.toLowerCase()}"`)
  })

  it('шрифт системный (пивот 3, Р-36): ни Google Fonts, ни веб-шрифтов в сборке', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf-8')
    for (const bad of ['fonts.googleapis', 'fonts.gstatic', 'Piazzolla', 'Golos', 'Onest']) expect(html).not.toContain(bad)
    const css = readdirSync(resolve(dist, 'assets'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(resolve(dist, 'assets', f), 'utf-8'))
      .join('\n')
    expect(css).toContain('ui-rounded')
    for (const bad of ['fonts.gstatic', 'Piazzolla', 'Golos', '@font-face']) expect(css).not.toContain(bad)
  })

  it('пивот 3 (B2C-45): чанков пяти удалённых экранов нет, «Деньги» — свой чанк, главный — меньше 500 КБ (порог Vite)', () => {
    const js = readdirSync(resolve(dist, 'assets')).filter((f) => f.endsWith('.js'))
    for (const gone of ['Budget-', 'Capital-', 'DebtPlan-', 'Deposit-', 'History-']) expect(js.filter((f) => f.startsWith(gone)), gone).toEqual([])
    expect(js.some((f) => f.startsWith('Money-'))).toBe(true)
    const main = js.filter((f) => f.startsWith('index-')).map((f) => readFileSync(resolve(dist, 'assets', f)).length)
    expect(Math.max(...main)).toBeLessThan(500 * 1024)
  })
})

describe.skipIf(!built)('pdf.js в сборке — legacy (выписка на iPhone)', () => {
  // Обычная сборка pdf.js зовёт Promise.try, Uint8Array#toHex, Math.sumPrecise без полифиллов —
  // Safari на iPhone их не знает, и настоящая выписка «не читается» (смоук владельца Блока 1 B2C).
  it('воркер и библиотека несут полифиллы новых API', () => {
    const assets = readdirSync(resolve(dist, 'assets'))
    const read = (f: string) => readFileSync(resolve(dist, 'assets', f), 'utf-8')
    const worker = assets.filter((f) => /^pdf\.worker.*\.mjs$/.test(f))
    expect(worker).toHaveLength(1)
    expect(read(worker[0])).toContain('sumPrecise:function sumPrecise')
    const lib = assets.filter((f) => /^pdf-.*\.js$/.test(f)).map(read).join('\n')
    expect(lib).toMatch(/\{try:function\(/)
    expect(lib).toMatch(/getOrInsertComputed:function\(/)
  })
})
