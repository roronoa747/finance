import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { renderScreen } from '@/test/screenState'
import type { PersonId } from '@/types/finance'
import Settings from './Settings.vue'
import Money from './Money.vue'

const T0 = '2026-09-01T00:00:00.000Z'

function signIn(role: 'member' | 'viewer' = 'member', slot: PersonId = 'a') {
  useAuthStore().setAuthData({
    token: 't',
    user: { id: `u-${slot}`, email: `${slot}@example.com`, created_at: T0 },
    household: { id: 'h-1', name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    member: { household_id: 'h-1', user_id: `u-${slot}`, slot, display_name: 'Ильяс', role, joined_at: T0 },
  })
}

describe('B2C-13: /settings и /money (SSR)', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
    signIn()
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T0 },
    ]
  })

  it('Настройки: «Оформление» с темой и именем прямо на экране, «С кем» — участники, свой помечен, состояние обмена', async () => {
    const html = await renderScreen(Settings, '/settings')
    expect(html).toContain('Оформление')
    expect(html).toContain('Авто')
    expect(html).toContain('Светлая')
    expect(html).toContain('Тёмная')
    expect(html).toMatch(/<input[^>]*value="Ильяс"/)
    expect(html).toContain('С кем')
    expect(html).toContain('вы · участник')
    expect(html).toContain('Дана')
    expect(html).toContain('Обмен между телефонами')
    expect(html).toContain('синхронизировано')
    expect(html).toContain('Выйти из аккаунта')
    // Напоминание и удаление аккаунта — Блоки 5 и 4: секций нет.
    expect(html).not.toContain('Напоминание')
    expect(html).not.toContain('Удалить аккаунт')
    // Возврат смоука (g7, правило 12): порядок «Оформление» → «С кем» → выход; цвета разделов и разбор
    // выписок — свёрнуты (<details> без open), выход — своей карточкой после «С кем».
    expect(html.indexOf('Оформление')).toBeLessThan(html.indexOf('С кем'))
    expect(html.indexOf('С кем')).toBeLessThan(html.indexOf('Выйти из аккаунта'))
    expect(html).not.toContain('<details open')
    const colors = html.slice(html.lastIndexOf('<details', html.indexOf('Цвета разделов')), html.indexOf('Цвета разделов'))
    expect(colors).toContain('<summary')
    const parse = html.slice(html.lastIndexOf('<details', html.indexOf('Разбор выписок')), html.indexOf('Разбор выписок'))
    expect(parse).toContain('<summary')
  })

  it('viewer: «вы · только просмотр»', async () => {
    setActivePinia(createPinia())
    signIn('viewer', 'b')
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T0 },
    ]
    const html = await renderScreen(Settings, '/settings')
    expect(html).toContain('вы · только просмотр')
  })

  it('возврат приёмки п. 8: одиночке «Пригласить партнёра» прямо в «С кем»; семье из двух и viewer — нет', async () => {
    const solo = () => {
      useFinanceStore().householdDoc.people = [{ id: 'a', name: 'Асель', salary: 400_000, payday: 5, updatedAt: T0 }]
    }
    // Семья из двух (beforeEach) — приглашать некого.
    expect(await renderScreen(Settings, '/settings')).not.toContain('Пригласить партнёра')

    solo()
    const html = await renderScreen(Settings, '/settings')
    const withWhom = html.slice(html.indexOf('С кем'))
    expect(withWhom).toContain('Пригласить партнёра')
    expect(withWhom).toContain('Создать код')

    setActivePinia(createPinia())
    signIn('viewer', 'a')
    solo()
    expect(await renderScreen(Settings, '/settings')).not.toContain('Пригласить партнёра')

    // Демо: сервера нет — код не создаётся (иначе запрос к /api; критик возврата).
    setActivePinia(createPinia())
    useAuthStore().setAuthData({
      token: DEMO_TOKEN,
      user: { id: 'demo-user-1', email: 'demo@family.local', created_at: T0 },
      household: { id: 'demo-household-1', name: 'Демо Семья', created_by: 'demo-user-1', created_at: T0 },
      member: { household_id: 'demo-household-1', user_id: 'demo-user-1', slot: 'a', display_name: 'Вы', role: 'member', joined_at: T0 },
    })
    solo()
    expect(await renderScreen(Settings, '/settings')).not.toContain('Пригласить партнёра')
  })

  it('«Деньги» (пивот 3): три квадрата Капитал · План · История вместо входов второго уровня', async () => {
    const html = await renderScreen(Money, '/money')
    for (const t of ['>Капитал</b>', '>План</b>', '>История</b>']) expect(html).toContain(t)
    expect(html).not.toContain('План «Сначала долги»')
  })
})
