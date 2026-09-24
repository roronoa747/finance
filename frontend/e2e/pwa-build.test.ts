import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Проверяет собранный dist: запускать после `npm run build` (так идёт CI).
// Признак сборки — index.html, а не sw.js: иначе пропажа SW пропустила бы тест молча.
const dist = resolve(import.meta.dirname, '../dist')
const built = existsSync(resolve(dist, 'index.html'))

describe.skipIf(!built)('PWA-сборка заменяет React-PWA (MGV-17)', () => {
  it('манифест совпадает с React-версией', () => {
    const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf-8'))
    expect(manifest).toMatchObject({
      name: 'Family Finance',
      short_name: 'FF',
      lang: 'ru',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#E9EDEC',
      theme_color: '#0A6B57',
    })
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

  it('иконка — привычная иконка React-PWA', () => {
    const icon = readFileSync(resolve(dist, 'favicon.svg'), 'utf-8')
    const reactIcon = readFileSync(resolve(import.meta.dirname, '../../public/favicon.svg'), 'utf-8')
    expect(icon).toBe(reactIcon)
  })

  it('шрифты Onest и Golos Text подключены, как в React', () => {
    const html = readFileSync(resolve(dist, 'index.html'), 'utf-8')
    expect(html).toContain('fonts.googleapis.com/css2?family=Onest')
    expect(html).toContain('family=Golos+Text')
  })
})
