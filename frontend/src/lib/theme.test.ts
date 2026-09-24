import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ACCENTS } from './palette'
import {
  applyCurrentPalette,
  isDark,
  readAccent,
  readThemeChoice,
  setAccent,
  setThemeChoice,
  watchSystemTheme,
} from './theme'

describe('PV-08: тема на старте и «Авто» следит за телефоном', () => {
  const storage = new Map<string, string>()
  let classes: Set<string>
  let system: { matches: boolean; listeners: (() => void)[] }
  const props = new Map<string, string>()

  /** Телефон переключил системную тему. */
  function flipSystem(dark: boolean) {
    system.matches = dark
    system.listeners.forEach((fn) => fn())
  }

  beforeEach(() => {
    storage.clear()
    props.clear()
    classes = new Set()
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
    })
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

  it('акцент применяется на старте; выбор пишется в localStorage и сразу применяется', () => {
    storage.set('ff_accent', 'cobalt')
    applyCurrentPalette()
    expect(props.get('--brand')).toBe(ACCENTS.cobalt.light)

    setThemeChoice('dark')
    expect(storage.get('ff_theme')).toBe('dark')
    expect(props.get('--brand')).toBe(ACCENTS.cobalt.dark)

    setAccent('plum')
    expect(storage.get('ff_accent')).toBe('plum')
    expect(props.get('--brand')).toBe(ACCENTS.plum.dark)
    // Цвета разделов пока зашиты (PV-22).
    expect(props.has('--d1')).toBe(true)
  })

  it('системная смена под «Авто» переключает класс и isDark в обе стороны, под «Светлой» — нет', () => {
    const stop = watchSystemTheme()
    applyCurrentPalette()
    expect(classes.has('dark')).toBe(false)

    flipSystem(true)
    expect(classes.has('dark')).toBe(true)
    expect(isDark.value).toBe(true)
    flipSystem(false)
    expect(classes.has('dark')).toBe(false)
    expect(isDark.value).toBe(false)

    setThemeChoice('light')
    flipSystem(true)
    expect(classes.has('dark')).toBe(false)
    expect(isDark.value).toBe(false)

    stop()
    expect(system.listeners).toEqual([])
  })

  it('сломанный localStorage (бросает) — дефолт «Авто» и изумрудный, без исключения', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    expect(readThemeChoice()).toBe('auto')
    expect(readAccent()).toBe('emerald')
    expect(() => setThemeChoice('dark')).not.toThrow()
    expect(() => applyCurrentPalette()).not.toThrow()
  })

  it('мусор в хранилище — дефолт', () => {
    storage.set('ff_theme', 'sepia')
    storage.set('ff_accent', 'neon')
    expect(readThemeChoice()).toBe('auto')
    expect(readAccent()).toBe('emerald')
  })
})
