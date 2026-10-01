import { afterEach, describe, expect, it, vi } from 'vitest'
import { MONTH_END_KEY, readMonthEnd, writeMonthEnd } from './storage'

// Ответ «остались деньги?» (Р-19): «Мечты» и «Неделя» пишут и читают одним форматом (критик Блока 3).
describe('readMonthEnd / writeMonthEnd', () => {
  const stub = (init: Record<string, string> = {}) => {
    const map = new Map(Object.entries(init))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
    })
    return map
  }
  afterEach(() => vi.unstubAllGlobals())

  it('пишет сырой ключ месяца и читает его же', () => {
    const map = stub()
    expect(readMonthEnd()).toBeNull()
    writeMonthEnd('2026-09')
    expect(map.get(MONTH_END_KEY)).toBe('2026-09')
    expect(readMonthEnd()).toBe('2026-09')
  })

  it('старая запись в JSON-виде («Неделя» до правки) читается как тот же месяц', () => {
    stub({ [MONTH_END_KEY]: '"2026-09"' })
    expect(readMonthEnd()).toBe('2026-09')
  })

  it('хранилища нет или оно бросает — null и без исключений', () => {
    expect(readMonthEnd()).toBeNull()
    expect(() => writeMonthEnd('2026-09')).not.toThrow()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('closed')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(readMonthEnd()).toBeNull()
    expect(() => writeMonthEnd('2026-09')).not.toThrow()
    err.mockRestore()
  })
})
