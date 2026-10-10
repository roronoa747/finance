import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useFlash } from './useFlash'

/** Тост одной фразой: гаснет сам, новая фраза перебивает, уход с экрана снимает таймер. */
describe('kit/useFlash', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flash показывает фразу и гасит через заданное время; вторая фраза перебивает первую и живёт своё время', () => {
    const { note, flash } = useFlash(4000)
    expect(note.value).toBeNull()
    flash('Отпуск ближе на 76 дней')
    vi.advanceTimersByTime(3_900)
    expect(note.value).toBe('Отпуск ближе на 76 дней')
    vi.advanceTimersByTime(100)
    expect(note.value).toBeNull()

    flash('Первая')
    vi.advanceTimersByTime(3_000)
    flash('Вторая', 1_000)
    vi.advanceTimersByTime(999)
    expect(note.value).toBe('Вторая')
    vi.advanceTimersByTime(1)
    expect(note.value).toBeNull()
  })

  it('clear гасит сразу; остановка scope снимает таймер — фраза после него не меняется', () => {
    const scope = effectScope()
    const { note, flash, clear } = scope.run(() => useFlash(2400))!
    flash('Загружено 3 операции')
    clear()
    expect(note.value).toBeNull()
    vi.advanceTimersByTime(5_000)
    expect(note.value).toBeNull()

    flash('Отменено', 1600)
    scope.stop()
    note.value = 'после ухода'
    vi.advanceTimersByTime(5_000)
    expect(note.value).toBe('после ухода')
  })
})
