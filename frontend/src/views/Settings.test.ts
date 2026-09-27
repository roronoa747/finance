import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
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

  it('«Деньги»: входы второго уровня — Бюджет, Капитал, План', async () => {
    const html = await renderScreen(Money, '/money')
    for (const t of ['Бюджет', 'Капитал', 'План «Сначала долги»']) expect(html).toContain(t)
  })
})
