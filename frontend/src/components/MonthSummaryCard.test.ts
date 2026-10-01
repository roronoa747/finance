import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import MonthSummaryCard from './MonthSummaryCard.vue'

/** «Утечки» в итоге месяца (B2C-20): строка «Отказались от N подписок» и «Поделиться» без сумм. */
describe('MonthSummaryCard — отказ от подписок', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    useAuthStore().setAuthData(authAs('member'))
  })
  afterEach(() => vi.useRealTimers())

  it('нет отказов — ни строки, ни кнопки; отказались от двух подписок в сентябре — строка с именами и «Поделиться», лист «Карточка месяца» без сумм', async () => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    const none = await renderScreen(MonthSummaryCard, '/money', { month: '2026-09' })
    expect(none).not.toContain('Отказались')
    expect(none).not.toContain('Поделиться')

    store.addObligation({ name: 'Netflix', day: 3, category: 'd4', amount: 3_990 })
    store.addObligation({ name: 'Spotify', day: 7, category: 'd4', amount: 2_500 })
    for (const o of store.obligations.filter((x) => x.category === 'd4')) store.removeObligation(o.id)
    const html = await renderScreen(MonthSummaryCard, '/money', { month: '2026-09' })
    expect(html).toContain('Отказались от 2 подписок')
    expect(html).toContain('«Netflix», «Spotify»')
    expect(html).toContain('Поделиться')
    expect(html).not.toContain('Карточка месяца')

    const open = await renderScreen(MonthSummaryCard, '/money', { month: '2026-09' }, [screenMixin({ storyOpen: true })])
    expect(open).toContain('Карточка месяца')
    expect(open).toContain('Без сумм — только число подписок.')
    // В августе отказов не было.
    expect(await renderScreen(MonthSummaryCard, '/money', { month: '2026-08' })).not.toContain('Отказались')
  })
})
