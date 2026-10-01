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
describe('PV-22: «Оформление» — имя без отката (Б-19)', () => {
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

  it('имя — из people[slot], подпись — одна строка (правило 12), подписи секций — type-section', async () => {
    const html = await renderScreen(AppearancePanel, '/', { section: 'look' })
    expect(html).toMatch(/<input[^>]*value="Ильяс"/)
    expect(html).not.toMatch(/value="ilyas"/)
    expect(html).toContain('<p class="mt-1 type-meta">Так вас видит партнёр</p>')
    expect(html).not.toContain('По умолчанию подставляется')
    for (const label of ['Ваше имя', 'Тема']) {
      expect(html.replace(/\s+/g, ' ')).toContain(`<div class="mb-1.5 type-section"> ${label} </div>`)
    }
  })

  it('viewer: поля «Ваше имя» нет — имя пишется в общий документ, а его запись сервер не примет', async () => {
    setActivePinia(createPinia())
    signIn('c', 'viewer')
    const html = await renderScreen(AppearancePanel, '/', { section: 'look' })
    expect(html).not.toContain('Ваше имя')
    expect(html).not.toContain('placeholder="Имя"')
    // Остальное «Оформление» — дело устройства, viewer его видит.
    expect(html).toContain('Тема')
  })

  it('клинап Б9 (Н-1): «Цвета разделов» нет — их красил только «Бюджет» (Р-33)', async () => {
    const html = await renderScreen(AppearancePanel, '/', { section: 'look' })
    expect(html).not.toContain('Цвета разделов')
    expect(html).not.toContain('role="group"')
    expect(html).not.toContain('<details')
  })

  it('saveName: пустое — прежнее имя в поле, запись не идёт; то же имя — не пишется; новое — setPerson', async () => {
    const store = useFinanceStore()
    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('saveName' in this.$.setupState) vm = this.$.setupState } }
    await renderScreen(AppearancePanel, '/', { section: 'look' }, [grab])
    const setPerson = vi.spyOn(store, 'setPerson')

    vm.userName = '   '
    vm.saveName()
    expect(vm.userName).toBe('Ильяс')
    vm.userName = ' Ильяс '
    vm.saveName()
    expect(setPerson).not.toHaveBeenCalled()

    vm.userName = 'Ильяс М.'
    vm.saveName()
    expect(setPerson).toHaveBeenCalledWith('a', { name: 'Ильяс М.' })
    expect(store.people[0].name).toBe('Ильяс М.')
  })
})
