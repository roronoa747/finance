import { describe, it, expect, vi } from 'vitest'
import {
  HUES,
  HUE_KEYS,
  ACCENTS,
  ACCENT_KEYS,
  resolveDark,
  hueColor,
  applyTheme,
  prefersDark,
} from './palette'

describe('palette.ts — цветовая система и темы оформления', () => {
  it('все оттенки HUES имеют валидные пары light и dark HEX цветов', () => {
    expect(HUE_KEYS.length).toBeGreaterThan(0)
    for (const key of HUE_KEYS) {
      const hue = HUES[key]
      expect(hue.light).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(hue.dark).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(hue.label).toBeTruthy()
    }
  })

  it('все акценты ACCENTS имеют валидные контрастные токены текста и фона', () => {
    expect(ACCENT_KEYS.length).toBeGreaterThan(0)
    for (const key of ACCENT_KEYS) {
      const acc = ACCENTS[key]
      expect(acc.light).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(acc.dark).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(acc.lightInk).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(acc.darkInk).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(acc.lightSoft).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(acc.darkSoft).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('resolveDark корректно вычисляет тему (light / dark / auto)', () => {
    expect(resolveDark('light')).toBe(false)
    expect(resolveDark('dark')).toBe(true)

    // При auto без window.matchMedia
    expect(resolveDark('auto')).toBe(false)
    expect(prefersDark()).toBe(false)
  })

  it('hueColor возвращает правильный цвет для светлой и тёмной темы', () => {
    expect(hueColor('blue', false)).toBe(HUES.blue.light)
    expect(hueColor('blue', true)).toBe(HUES.blue.dark)
    expect(hueColor('green', false)).toBe(HUES.green.light)
    expect(hueColor('green', true)).toBe(HUES.green.dark)
  })

  it('applyTheme применяет CSS переменные к root элементу', () => {
    const mockRoot = {
      classList: {
        toggle: vi.fn(),
      },
      style: {
        setProperty: vi.fn(),
      },
    }

    vi.stubGlobal('document', { documentElement: mockRoot })

    applyTheme({
      theme: 'dark',
      accent: 'emerald',
      categories: {
        d1: 'blue',
        d2: 'brick',
        d3: 'green',
        d4: 'ochre',
        d5: 'steel',
      },
    })

    expect(mockRoot.classList.toggle).toHaveBeenCalledWith('dark', true)
    expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--brand', ACCENTS.emerald.dark)
    expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--d1', HUES.blue.dark)
  })
})
