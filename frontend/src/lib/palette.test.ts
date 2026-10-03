import { describe, it, expect, vi } from 'vitest'
import { HUES, HUE_KEYS, resolveDark, hueColor, applyTheme, prefersDark, spendColor, spendSlot, SPEND_SLOTS, personColor, PERSON_COLORS, PERSON_EMOJI, memberColor, oneEmoji, lastEmoji, slotColor } from './palette'
import type { Person } from '@/types/finance'
import { DEFAULT_SPEND_CATEGORIES } from './statements/dictionary'

// Токены читаются из style.css текстом, как в style.tokens.test.ts (Vitest отдаёт CSS пустым).
type NodeFs = { readFileSync(path: URL, encoding: string): string }
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf-8')
const canvasOf = (selector: RegExp) => /--canvas\s*:\s*([^;]+);/.exec(css.match(selector)?.[1] ?? '')?.[1].trim()
const CANVAS = { light: canvasOf(/:root\s*\{([^}]*)\}/), dark: canvasOf(/\.dark\s*\{([^}]*)\}/) }

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

  it('applyTheme ставит только класс dark: ни бренда (акцента нет — B2C-12), ни цветов разделов бюджета (Р-33)', () => {
    const mockRoot = {
      classList: {
        toggle: vi.fn(),
      },
      style: {
        setProperty: vi.fn(),
      },
    }

    vi.stubGlobal('document', { documentElement: mockRoot, querySelectorAll: () => [] })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))

    applyTheme({ theme: 'dark' })

    expect(mockRoot.classList.toggle).toHaveBeenCalledWith('dark', true)
    expect(mockRoot.style.setProperty).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('B2C-53: applyTheme красит строку сверху (оба theme-color) в --canvas своей темы — светлая, тёмная, авто', () => {
    expect(CANVAS.light).toMatch(/^#[0-9a-f]{6}$/i)
    expect(CANVAS.dark).toMatch(/^#[0-9a-f]{6}$/i)
    expect(CANVAS.light).not.toBe(CANVAS.dark)

    const classes = new Set<string>()
    const metas = [{ content: CANVAS.light }, { content: CANVAS.dark }].map((m) => ({
      ...m,
      setAttribute(_: string, v: string) {
        this.content = v
      },
    }))
    let systemDark = false
    vi.stubGlobal('document', {
      documentElement: { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } },
      querySelectorAll: (q: string) => (q === 'meta[name="theme-color"]' ? metas : []),
    })
    // Браузер вычисляет --canvas по классу dark на <html> — как .dark в style.css.
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (k: string) => (k === '--canvas' ? ` ${classes.has('dark') ? CANVAS.dark : CANVAS.light}` : ''),
    }))
    vi.stubGlobal('window', { matchMedia: () => ({ matches: systemDark }) })
    const bar = () => metas.map((m) => m.content)

    // Ручной выбор сильнее media мета-тегов: оба тега — цвет выбранной темы.
    applyTheme({ theme: 'dark' })
    expect(bar()).toEqual([CANVAS.dark, CANVAS.dark])
    systemDark = true
    applyTheme({ theme: 'light' })
    expect(bar()).toEqual([CANVAS.light, CANVAS.light])
    applyTheme({ theme: 'auto' })
    expect(bar()).toEqual([CANVAS.dark, CANVAS.dark])
    systemDark = false
    applyTheme({ theme: 'auto' })
    expect(bar()).toEqual([CANVAS.light, CANVAS.light])
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

  it('personColor: a/b — токены --pa/--pb, третий слот — --ink-3 (токена --pc нет)', () => {
    expect(personColor('a')).toBe('var(--pa)')
    expect(personColor('b')).toBe('var(--pb)')
    expect(personColor('c')).toBe('var(--ink-3)')
  })

  it('B2C-63 personColor: выбранный токен сильнее слота; без выбора и незнакомый ключ — слот', () => {
    expect(PERSON_COLORS).toEqual(['pa', 'pb', 's3', 's1', 's8', 's6'])
    expect(personColor('a', 's8')).toBe('var(--s8)')
    expect(personColor('b', 'pa')).toBe('var(--pa)')
    expect(personColor('c', 's1')).toBe('var(--s1)')
    expect(personColor('a', null)).toBe('var(--pa)')
    expect(personColor('b', 's2')).toBe('var(--pb)')
    expect(personColor('a', '#ff0000')).toBe('var(--pa)')
  })

  it('клинап Б12 memberColor/slotColor: один путь цвета участника — выбранный у живого, у удалённого и без выбора — слот', () => {
    const p = (id: Person['id'], extra: Partial<Person> = {}) => ({ id, name: id, salary: 0, updatedAt: '', ...extra }) as Person
    const people = [p('a', { color: 's8' }), p('b', { color: 's3', deletedAt: '2026-10-01' }), p('c')]
    expect(memberColor(people, 'a')).toBe('var(--s8)')
    expect(memberColor(people, 'b')).toBe('var(--pb)')
    expect(memberColor(people, 'c')).toBe('var(--ink-3)')
    expect(memberColor([], 'a')).toBe('var(--pa)')
    expect(slotColor('a')).toBe('pa')
    expect(slotColor('c')).toBe('ink-3')
    expect(PERSON_COLORS).not.toContain(slotColor('c'))
  })

  it('B2C-69 oneEmoji: один смайлик — и простой, и семья через ZWJ, и флаги; буквы, цифры, два смайлика, пусто — null', () => {
    for (const e of ['🦊', '👨‍👩‍👧', '🏳️‍🌈', '🇰🇿', '⚡️', '☕️', '🐼']) expect(oneEmoji(e), e).toBe(e)
    expect(oneEmoji(' 🐼 ')).toBe('🐼')
    for (const e of PERSON_EMOJI) expect(oneEmoji(e), e).toBe(e)
    for (const bad of ['', '   ', 'ab', 'a', '7', '#', '🦊🐻', '🇰🇿🇰🇿', 'a b', '🦊 x', 'Ж']) expect(oneEmoji(bad), JSON.stringify(bad)).toBeNull()
  })

  it('B2C-74 lastEmoji: вставка дописалась к прежнему своему — берётся последний смайлик; последняя графема не смайлик — null', () => {
    expect(lastEmoji('🐼🦊')).toBe('🦊')
    expect(lastEmoji('🦊')).toBe('🦊')
    expect(lastEmoji('🐼a')).toBeNull()
    expect(lastEmoji('🐼ab')).toBeNull()
    expect(lastEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧')
    expect(lastEmoji('🐼👨‍👩‍👧')).toBe('👨‍👩‍👧')
    expect(lastEmoji('🇰🇿🇺🇸')).toBe('🇺🇸')
    expect(lastEmoji(' 🐼🦊 ')).toBe('🦊')
    expect(lastEmoji('')).toBeNull()
    expect(lastEmoji('ab')).toBeNull()
  })
})
