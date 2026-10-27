import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'

/** FG-31 (FG-Х1): PWA на iPhone рисует контент под строкой статуса и полосой жеста — отступы даёт `env(safe-area-inset-*)`. */
describe('index.html — iPhone safe-area (FG-31)', () => {
  it('viewport с viewport-fit=cover: без него env(safe-area-inset-*) на iPhone — 0', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? ''
    expect(viewport.split(',').map((s) => s.trim())).toContain('viewport-fit=cover')
  })

  it('строка статуса PWA — black-translucent (контент под ней, своей полосы iOS не рисует); theme-color оба остались', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />')
    expect(html.match(/<meta name="theme-color"/g)).toHaveLength(2)
  })
})
