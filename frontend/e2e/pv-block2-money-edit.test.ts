import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Блок 2 «Правка денег» (PV-09…PV-13): сценарии на уровне стора и SSR-экранов.
 * Браузерная проверка — на стенде §6 (скрипты в scratchpad сессии, не в репо).
 */

describe('PV-09: кит окон', () => {
  it('токен затемнения --scrim — в светлой и тёмной теме, окна берут цвет только из него', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8')
    const block = (sel: string) => {
      const at = css.indexOf(`${sel} {`)
      return css.slice(at, css.indexOf('\n}', at))
    }
    expect(block(':root')).toMatch(/--scrim:/)
    expect(block('.dark')).toMatch(/--scrim:/)
    expect(css).toMatch(/--color-scrim: var\(--scrim\)/)

    // Экраны блока — без литерального затемнения.
    for (const file of ['../src/views/Capital.vue', '../src/components/PaidRow.vue']) {
      const src = readFileSync(resolve(import.meta.dirname, file), 'utf-8')
      expect(src).not.toMatch(/bg-black|fixed inset-0|<select/)
    }
  })
})
