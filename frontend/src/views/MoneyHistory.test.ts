import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen } from '@/test/screenState'
import Money from './Money.vue'
import Settings from './Settings.vue'

/**
 * Второй уровень «Деньги» (B2C-21): вход — список; «История и итоги» — «Впереди», итог месяца и
 * моменты семьи; настройки — «Разбор выписок» (viewer без него).
 */
describe('«Деньги»: квадраты и «История» (B2C-21 → пивот 3, SSR)', () => {
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
  })
  afterEach(() => vi.useRealTimers())

  function family(role: 'member' | 'viewer' = 'member') {
    useAuthStore().setAuthData(authAs(role))
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    return store
  }

  it('«Деньги» (пивот 3, Р-31): квадраты Капитал · План · История вместо меню входов; вклад и платежи — в Капитале; истории на нём нет', async () => {
    const store = family()
    store.addAccount({ name: 'Kaspi Депозит', kind: 'deposit', amount: 1_000_000, deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true } })
    const html = await renderScreen(Money, '/money')
    for (const t of ['>Капитал</b>', '>План</b>', '>История</b>', 'Kaspi Депозит']) expect(html).toContain(t)
    for (const gone of ['Бюджет', 'План «Сначала долги»', 'Вклад · Kaspi Депозит', 'История и итоги', 'Впереди', 'href="/money/budget"']) expect(html).not.toContain(gone)
    for (const t of ['Аренда', 'Кредит', 'Кредитка', 'Рассрочка']) expect(html).toContain(t)
    expect(html).not.toContain('История семьи')
    expect(html).not.toContain('Итог месяца')
  })

  it('/money/history (B2C-44): строка итога — за этот месяц в последние дни, в середине — за прошлый; нет данных — строки нет; «Впереди» здесь нет', async () => {
    const store = family()
    const mid = await renderScreen(Money, '/money/history')
    expect(mid).not.toContain('Впереди')
    expect(mid).not.toContain('итог месяца · поделиться')
    expect(mid).toContain('Пока пусто')

    store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })
    expect(await renderScreen(Money, '/money/history')).not.toContain('итог месяца · поделиться')
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    const end = await renderScreen(Money, '/money/history')
    expect(end).toContain('Наш сентябрь')
    expect(end).toContain('итог месяца · поделиться')
    vi.setSystemTime(new Date('2026-10-15T07:00:00Z'))
    expect(await renderScreen(Money, '/money/history')).toContain('Наш сентябрь')
  })

  it('настройки: «Разбор выписок» — разделы по словарю до первой выписки, правил нет; viewer раздела не видит', async () => {
    family()
    const html = await renderScreen(Settings, '/settings')
    expect(html).toContain('Разбор выписок')
    expect(html).toContain('Появятся после первой выписки — пока разделы по словарю.')
    expect(html).toContain('Правил пока нет.')

    setActivePinia(createPinia())
    family('viewer')
    expect(await renderScreen(Settings, '/settings')).not.toContain('Разбор выписок')
  })
})
