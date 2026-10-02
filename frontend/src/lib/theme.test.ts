import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  applyCurrentPalette,
  isDark,
  readThemeChoice,
  setThemeChoice,
  watchSystemTheme,
} from './theme'

describe('PV-08: тема на старте и «Авто» следит за телефоном', () => {
  const storage = new Map<string, string>()
  let classes: Set<string>
  let system: { matches: boolean; listeners: (() => void)[] }
  const props = new Map<string, string>()
  let metas: { content: string; setAttribute(k: string, v: string): void }[]
  const meta = () => ({ content: '', setAttribute(_: string, v: string) { this.content = v } })
  /** Цвет строки сверху: оба мета-тега theme-color несут одно значение. */
  const bar = () => [...new Set(metas.map((m) => m.content))].join('|')

  /** Телефон переключил системную тему. */
  function flipSystem(dark: boolean) {
    system.matches = dark
    system.listeners.forEach((fn) => fn())
  }

  beforeEach(() => {
    storage.clear()
    props.clear()
    classes = new Set()
    metas = [meta(), meta()]
    system = { matches: false, listeners: [] }
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
    })
    vi.stubGlobal('document', {
      documentElement: {
        classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
        style: { setProperty: (k: string, v: string) => props.set(k, v) },
      },
      querySelectorAll: () => metas,
    })
    // --canvas «вычисляется» по классу dark — так строка сверху видна в тестах темы (B2C-53).
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (k: string) => (k === '--canvas' ? (classes.has('dark') ? 'canvas-dark' : 'canvas-light') : ''),
    }))
    vi.stubGlobal('window', {
      matchMedia: () => ({
        get matches() {
          return system.matches
        },
        addEventListener: (_: string, fn: () => void) => system.listeners.push(fn),
        removeEventListener: (_: string, fn: () => void) => {
          system.listeners = system.listeners.filter((x) => x !== fn)
        },
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    isDark.value = false
  })

  it('«Тёмная» → класс dark и isDark; «Светлая» при тёмном телефоне — нет; «Авто» при тёмном — есть', () => {
    storage.set('ff_theme', 'dark')
    applyCurrentPalette()
    expect(classes.has('dark')).toBe(true)
    expect(isDark.value).toBe(true)

    system.matches = true
    storage.set('ff_theme', 'light')
    applyCurrentPalette()
    expect(classes.has('dark')).toBe(false)
    expect(isDark.value).toBe(false)

    storage.set('ff_theme', 'auto')
    applyCurrentPalette()
    expect(classes.has('dark')).toBe(true)
    expect(isDark.value).toBe(true)
  })

  it('B2C-12: акцента больше нет — старый ff_accent не трогает --brand; цвета разделов (--d*) больше не пишутся', () => {
    storage.set('ff_accent', 'cobalt')
    applyCurrentPalette()
    expect(props.has('--brand')).toBe(false)

    setThemeChoice('dark')
    expect(storage.get('ff_theme')).toBe('dark')
    expect(props.has('--brand')).toBe(false)
    // «Цвета разделов» (PV-22) сняты в клинапе Блока 9: их красил только «Бюджет» (Р-33).
    storage.set('ff_category_hues', JSON.stringify({ d1: 'plum' }))
    applyCurrentPalette()
    expect(props.size).toBe(0)
  })

  it('системная смена под «Авто» переключает класс, isDark и строку сверху в обе стороны, под «Светлой» — нет', () => {
    const stop = watchSystemTheme()
    applyCurrentPalette()
    expect(classes.has('dark')).toBe(false)

    expect(bar()).toBe('canvas-light')

    flipSystem(true)
    expect(classes.has('dark')).toBe(true)
    expect(isDark.value).toBe(true)
    expect(bar()).toBe('canvas-dark')
    flipSystem(false)
    expect(classes.has('dark')).toBe(false)
    expect(isDark.value).toBe(false)
    expect(bar()).toBe('canvas-light')

    setThemeChoice('light')
    flipSystem(true)
    expect(classes.has('dark')).toBe(false)
    expect(isDark.value).toBe(false)
    expect(bar()).toBe('canvas-light')

    stop()
    expect(system.listeners).toEqual([])
  })

  it('сломанный localStorage (бросает) — дефолт «Авто», без исключения', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(readThemeChoice()).toBe('auto')
    expect(() => setThemeChoice('dark')).not.toThrow()
    expect(() => applyCurrentPalette()).not.toThrow()
  })

  it('мусор в хранилище — дефолт', () => {
    storage.set('ff_theme', 'sepia')
    expect(readThemeChoice()).toBe('auto')
    // Имена из прототипа объекта — тоже мусор (критик).
    for (const junk of ['toString', 'constructor', '__proto__']) {
      storage.set('ff_theme', junk)
      expect(readThemeChoice()).toBe('auto')
    }
  })
})
