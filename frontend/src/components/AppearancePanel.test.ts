import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { renderScreen } from '@/test/screenState'
import type { PersonId } from '@/types/finance'
import AppearancePanel from './AppearancePanel.vue'

const T0 = '2026-09-01T00:00:00.000Z'

function signIn(slot: PersonId = 'a', role: 'member' | 'viewer' = 'member') {
  useAuthStore().setAuthData({
    token: 't',
    user: { id: `u-${slot}`, email: 'ilyas@example.com', created_at: T0 },
    household: { id: 'h-1', name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    // Имя аккаунта нарочно другое: источник — документ, а не аккаунт.
    member: { household_id: 'h-1', user_id: `u-${slot}`, slot, display_name: 'ilyas', role, joined_at: T0 },
  })
}

// «Цвета разделов» (PV-22) сняты в клинапе Блока 9: разделов бюджета на экранах нет — Р-33.
// Имя переехало в «Свой кружок» (PN-01, Р-1 «понятность») — его тесты в `views/MyCircle.dom.test.ts`.
describe('PV-22: «Оформление» — тема; имени здесь нет (PN-01)', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
    signIn()
    useFinanceStore().householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }]
  })

  it('тема — подпись секции type-section; поля имени нет ни у участника, ни у viewer (одно место правки — «Свой кружок»)', async () => {
    const html = await renderScreen(AppearancePanel, '/', { section: 'look' })
    expect(html.replace(/\s+/g, ' ')).toContain('<div class="mb-1.5 type-section"> Тема </div>')
    expect(html).not.toContain('Ваше имя')
    expect(html).not.toContain('placeholder="Имя"')
    expect(html).not.toMatch(/<input[^>]*value="Ильяс"/)
    expect(html).not.toContain('Так вас видит партнёр')

    setActivePinia(createPinia())
    signIn('c', 'viewer')
    const viewer = await renderScreen(AppearancePanel, '/', { section: 'look' })
    expect(viewer).not.toContain('placeholder="Имя"')
    // «Оформление» — дело устройства, viewer его видит.
    expect(viewer).toContain('Тема')
  })

  it('клинап Б9 (Н-1): «Цвета разделов» нет — их красил только «Бюджет» (Р-33)', async () => {
    const html = await renderScreen(AppearancePanel, '/', { section: 'look' })
    expect(html).not.toContain('Цвета разделов')
    expect(html).not.toContain('role="group"')
    expect(html).not.toContain('<details')
  })
})
