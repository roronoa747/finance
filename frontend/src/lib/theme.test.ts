import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HUES } from './palette'
import {
  applyCurrentPalette,
  DEFAULT_CATEGORY_HUES,
  isDark,
  readCategoryHues,
  readThemeChoice,
  setCategoryHue,
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

  it('B2C-12: акцента больше нет — старый ff_accent не трогает --brand; цвета разделов — дефолт по теме', () => {
    storage.set('ff_accent', 'cobalt')
    applyCurrentPalette()
    expect(props.has('--brand')).toBe(false)

    setThemeChoice('dark')
    expect(storage.get('ff_theme')).toBe('dark')
    expect(props.has('--brand')).toBe(false)
    // Цвета разделов — дефолт, пока их не выбирали (PV-22).
    expect(props.get('--d1')).toBe(HUES.blue.dark)
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

  describe('PV-22: «Цвета разделов» — дело устройства (Р-20)', () => {
    it('setCategoryHue(d2, blue) → --d2 светлой пары, в тёмной — тёмной; выбор в ff_category_hues, остальные — дефолт', () => {
      applyCurrentPalette()
      expect(props.get('--d2')).toBe(HUES.brick.light)

      setCategoryHue('d2', 'blue')
      expect(props.get('--d2')).toBe(HUES.blue.light)
      expect(props.get('--d1')).toBe(HUES.blue.light)
      expect(JSON.parse(storage.get('ff_category_hues')!)).toEqual({ ...DEFAULT_CATEGORY_HUES, d2: 'blue' })

      setThemeChoice('dark')
      expect(props.get('--d2')).toBe(HUES.blue.dark)
      // После «перезагрузки» — снова из хранилища.
      props.clear()
      applyCurrentPalette()
      expect(props.get('--d2')).toBe(HUES.blue.dark)
      expect(readCategoryHues()).toEqual({ ...DEFAULT_CATEGORY_HUES, d2: 'blue' })
    })

    it('сломанный localStorage — дефолты, без исключения', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('SecurityError')
        },
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      })
      expect(readCategoryHues()).toEqual(DEFAULT_CATEGORY_HUES)
      expect(() => setCategoryHue('d1', 'plum')).not.toThrow()
      expect(props.get('--d1')).toBe(HUES.blue.light)
    })

    it('мусор в хранилище — дефолт по каждому разделу отдельно', () => {
      storage.set('ff_category_hues', '{not json')
      expect(readCategoryHues()).toEqual(DEFAULT_CATEGORY_HUES)
      storage.set('ff_category_hues', JSON.stringify({ d1: 'plum', d2: 'neon', d3: 'toString', d9: 'blue' }))
      expect(readCategoryHues()).toEqual({ ...DEFAULT_CATEGORY_HUES, d1: 'plum' })
      storage.set('ff_category_hues', '"blue"')
      expect(readCategoryHues()).toEqual(DEFAULT_CATEGORY_HUES)
    })
  })
})
