import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useSavedMark } from './useSavedMark'

describe('PV-09: useSavedMark — «Сохранено» по правилу React', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('загорается при смене stamp той же записи и гаснет через 1,8 с', async () => {
    const id = ref<string | undefined>('a')
    const stamp = ref<string | undefined>('t1')
    const scope = effectScope()
    const saved = scope.run(() => useSavedMark(id, stamp))!

    expect(saved.value).toBe(false)
    stamp.value = 't2'
    await nextTick()
    expect(saved.value).toBe(true)
    vi.advanceTimersByTime(1799)
    expect(saved.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(saved.value).toBe(false)
    scope.stop()
  })

  it('смена id — не правка: гаснет сразу и ждёт следующей смены stamp', async () => {
    const id = ref<string | undefined>('a')
    const stamp = ref<string | undefined>('t1')
    const scope = effectScope()
    const saved = scope.run(() => useSavedMark(id, stamp))!

    stamp.value = 't2'
    await nextTick()
    expect(saved.value).toBe(true)

    // Открыли другую запись — у неё свой updatedAt, это не сохранение.
    id.value = 'b'
    stamp.value = 't9'
    await nextTick()
    expect(saved.value).toBe(false)

    stamp.value = 't10'
    await nextTick()
    expect(saved.value).toBe(true)

    // Окно закрыли и открыли ту же запись снова — не загорается.
    id.value = undefined
    stamp.value = undefined
    await nextTick()
    expect(saved.value).toBe(false)
    id.value = 'b'
    stamp.value = 't10'
    await nextTick()
    expect(saved.value).toBe(false)
    scope.stop()
  })

  it('правка другого поля документа без смены stamp не гасит отметку раньше срока', async () => {
    const rec = reactive({ id: 'a', updatedAt: 't1', name: 'Kaspi' })
    const scope = effectScope()
    const saved = scope.run(() => useSavedMark(() => rec.id, () => rec.updatedAt))!

    rec.updatedAt = 't2'
    await nextTick()
    expect(saved.value).toBe(true)
    vi.advanceTimersByTime(1000)
    rec.name = 'Kaspi Gold'
    await nextTick()
    vi.advanceTimersByTime(700)
    expect(saved.value).toBe(true)
    vi.advanceTimersByTime(100)
    expect(saved.value).toBe(false)
    scope.stop()
  })
})
