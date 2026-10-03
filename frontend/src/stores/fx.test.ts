import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ApiClient, FxRatesResponse } from '@/api/client'
import { ApiError } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from './auth'
import { FX_RETRIES, useFxStore } from './fx'
import { FX_BOOK_KEY } from '@/lib/storage'

// Книга курсов на фронте (B2C-77): слияние ответов, повтор при partial, кэш, выход, демо.

const storage = new Map<string, string>()

function signIn(token = 't-a') {
  useAuthStore().setAuthData({
    token,
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
}

/** Ручка на заготовленных ответах по очереди; вызовы — в `calls`. */
function fakeClient(...answers: (FxRatesResponse | Error)[]) {
  const fxRates = vi.fn(async (code: string, from: string, to: string) => {
    void code, from, to
    const a = answers.shift()
    if (!a) throw new Error('unexpected fxRates call')
    if (a instanceof Error) throw a
    return a
  })
  return { client: { fxRates } as unknown as ApiClient, calls: fxRates }
}

const res = (rates: Record<string, number>, partial = false): FxRatesResponse => ({ code: 'EUR', rates, partial, source: 'НБ РК' })

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stores/fx — книга курсов', () => {
  it('два ответа сливаются; второй запрос — только недостающие дни', async () => {
    signIn()
    const fx = useFxStore()
    const { client, calls } = fakeClient(res({ '2026-09-25': 513.46, '2026-09-28': 515.1 }), res({ '2026-09-29': 516 }))
    await fx.ensureRates(['EUR'], '2026-09-25', '2026-09-28', client, 0)
    await fx.ensureRates(['EUR', 'KZT'], '2026-09-25', '2026-09-29', client, 0)
    expect(calls.mock.calls).toEqual([
      ['EUR', '2026-09-25', '2026-09-28'],
      ['EUR', '2026-09-29', '2026-09-29'],
    ])
    expect(fx.book.EUR).toEqual({ '2026-09-25': 513.46, '2026-09-28': 515.1, '2026-09-29': 516 })
    // Всё загружено — без запросов.
    await fx.ensureRates(['EUR'], '2026-09-26', '2026-09-29', client, 0)
    expect(calls).toHaveBeenCalledTimes(2)
    // Раньше начала — только левый край.
    const more = fakeClient(res({ '2026-09-24': 512.8 }))
    await fx.ensureRates(['EUR'], '2026-09-20', '2026-09-29', more.client, 0)
    expect(more.calls.mock.calls).toEqual([['EUR', '2026-09-20', '2026-09-24']])
  })

  it('partial — переспрашивает с паузой не больше FX_RETRIES раз; отрезок считается загруженным только полным', async () => {
    signIn()
    const fx = useFxStore()
    const partials = Array.from({ length: FX_RETRIES + 1 }, (_, i) => res({ [`2026-09-${String(10 + i).padStart(2, '0')}`]: 500 + i }, true))
    const { client, calls } = fakeClient(...partials)
    await fx.ensureRates(['EUR'], '2026-09-01', '2026-09-30', client, 0)
    expect(calls).toHaveBeenCalledTimes(FX_RETRIES + 1)
    expect(Object.keys(fx.book.EUR!)).toHaveLength(FX_RETRIES + 1)

    // Следующий вызов спрашивает тот же период снова — и полный ответ закрывает его.
    const again = fakeClient(res({ '2026-09-01': 499 }, true), res({ '2026-09-02': 498 }))
    await fx.ensureRates(['EUR'], '2026-09-01', '2026-09-30', again.client, 0)
    expect(again.calls).toHaveBeenCalledTimes(2)
    const done = fakeClient()
    await fx.ensureRates(['EUR'], '2026-09-01', '2026-09-30', done.client, 0)
    expect(done.calls).not.toHaveBeenCalled()
  })

  it('офлайн и 409 — остаётся то, что есть, без повторов', async () => {
    signIn()
    const fx = useFxStore()
    await fx.ensureRates(['EUR'], '2026-09-25', '2026-09-25', fakeClient(res({ '2026-09-25': 513.46 })).client, 0)
    const { client, calls } = fakeClient(new TypeError('Failed to fetch'), new ApiError('no household', 409))
    await fx.ensureRates(['EUR'], '2026-09-25', '2026-09-30', client, 0)
    await fx.ensureRates(['EUR'], '2026-09-25', '2026-09-30', client, 0)
    expect(calls).toHaveBeenCalledTimes(2)
    expect(fx.book.EUR).toEqual({ '2026-09-25': 513.46 })
  })

  it('кэш переживает перезагрузку стора; выход стирает ключ и память', async () => {
    signIn()
    await useFxStore().ensureRates(['EUR'], '2026-09-25', '2026-09-25', fakeClient(res({ '2026-09-25': 513.46 })).client, 0)
    expect(storage.has(FX_BOOK_KEY)).toBe(true)

    setActivePinia(createPinia())
    signIn()
    const fx = useFxStore()
    expect(fx.book.EUR).toEqual({ '2026-09-25': 513.46 })
    // Отрезок тоже из кэша: повторный запрос не уходит.
    const { client, calls } = fakeClient()
    await fx.ensureRates(['EUR'], '2026-09-25', '2026-09-25', client, 0)
    expect(calls).not.toHaveBeenCalled()

    useAuthStore().logout('discard')
    await nextTick()
    expect(storage.has(FX_BOOK_KEY)).toBe(false)
    expect(fx.book).toEqual({})
  })

  it('демо — синтетическая книга и ни одного запроса', async () => {
    useAuthStore().setAuthData({
      token: DEMO_TOKEN,
      user: { id: 'demo', email: 'demo@demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Демо', role: 'member', joined_at: '' },
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const fx = useFxStore()
    const { client, calls } = fakeClient()
    await fx.ensureRates(['EUR', 'USD'], '2026-09-01', '2026-09-30', client, 0)
    await fx.ensureDocRates(client)
    expect(calls).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(Object.keys(fx.book.EUR!).length).toBeGreaterThan(390)
    expect(Object.keys(fx.book.USD!).length).toBeGreaterThan(390)
  })

  it('без входа — не запрашивает', async () => {
    const { client, calls } = fakeClient()
    await useFxStore().ensureRates(['EUR'], '2026-09-01', '2026-09-30', client, 0)
    expect(calls).not.toHaveBeenCalled()
  })
})
