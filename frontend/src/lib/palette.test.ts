import { describe, it, expect, vi } from 'vitest'
import { HUES, HUE_KEYS, resolveDark, hueColor, applyTheme, prefersDark, spendColor, spendSlot, SPEND_SLOTS } from './palette'
import { DEFAULT_SPEND_CATEGORIES } from './statements/dictionary'

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

  it('applyTheme ставит класс dark и цвета разделов бюджета; бренд не трогает (акцента нет — B2C-12)', () => {
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
      categories: {
        d1: 'blue',
        d2: 'brick',
        d3: 'green',
        d4: 'ochre',
        d5: 'steel',
      },
    })

    expect(mockRoot.classList.toggle).toHaveBeenCalledWith('dark', true)
    expect(mockRoot.style.setProperty).toHaveBeenCalledWith('--d1', HUES.blue.dark)
    expect(mockRoot.style.setProperty).not.toHaveBeenCalledWith('--brand', expect.anything())
    vi.unstubAllGlobals()
  })

  describe('B2C-12: цвета разделов трат — токены --s1…--s12 (DESIGN.md §4)', () => {
    const byId = Object.fromEntries(DEFAULT_SPEND_CATEGORIES.map((c) => [c.id, c]))

    it('разделы словаря — по таблице: Продукты s1, Кафе s2, Дом и быт s8, Развлечения s7, Прочее s12', () => {
      expect(spendColor(byId.sc_food)).toBe('var(--s1)')
      expect(spendColor(byId.sc_cafe)).toBe('var(--s2)')
      expect(spendColor(byId.sc_home)).toBe('var(--s8)')
      expect(spendColor(byId.sc_fun)).toBe('var(--s7)')
      expect(spendColor(byId.sc_other)).toBe('var(--s12)')
    })

    it('раздел семьи без номера — по кругу от order; «не разобрано» — --s-unknown; литералов цвета нет', () => {
      expect(spendColor({ id: 'sc_x', order: 13 })).toBe('var(--s1)')
      expect(spendColor({ id: 'sc_y', order: 24 })).toBe('var(--s12)')
      expect(spendColor({ id: 'sc_z', order: 0 })).toBe('var(--s1)')
      expect(spendColor(null)).toBe('var(--s-unknown)')
      for (const c of DEFAULT_SPEND_CATEGORIES) {
        const slot = spendSlot(c)
        expect(slot).toBeGreaterThanOrEqual(1)
        expect(slot).toBeLessThanOrEqual(SPEND_SLOTS)
        expect(spendColor(c)).not.toMatch(/#|rgb/)
      }
    })
  })
})
