import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { renderScreen } from '@/test/screenState'
import AppShell from './AppShell.vue'

/** PV-23 п. 8: заголовок экрана одной записи — «Цель» и «Вклад», как React `AppShell.tsx:36-38`. */
describe('AppShell: заголовки маршрутов (SSR)', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
  })

  const title = async (path: string) => {
    const html = await renderScreen(AppShell, path)
    return html.match(/truncate font-display text-\[16px\][^>]*>\s*([^<]*?)\s*</)?.[1]
  }

  it.each([
    ['/goals', 'Цели и покупки'],
    ['/goals/x', 'Цель'],
    ['/capital', 'Капитал'],
    ['/capital/x', 'Вклад'],
    ['/budget', 'Бюджет'],
    ['/plan', 'План'],
  ])('%s → «%s»', async (path, expected) => {
    expect(await title(path)).toBe(expected)
  })
})
