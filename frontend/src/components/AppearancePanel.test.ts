import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { renderScreen, screenMixin } from '@/test/screenState'
import { HUES } from '@/lib/palette'
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

describe('PV-22: «Оформление» — имя без отката, «Цвета разделов» (Б-19)', () => {
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
    const html = await renderScreen(AppearancePanel, '/')
    expect(html).toMatch(/<input[^>]*value="Ильяс"/)
    expect(html).not.toMatch(/value="ilyas"/)
    expect(html).toContain('<p class="mt-1 type-meta">Так вас видит партнёр</p>')
    expect(html).not.toContain('По умолчанию подставляется')
    for (const label of ['Ваше имя', 'Тема', 'Цвета разделов']) {
      expect(html.replace(/\s+/g, ' ')).toContain(`<div class="mb-1.5 type-section"> ${label} </div>`)
    }
  })

  it('viewer: поля «Ваше имя» нет — имя пишется в общий документ, а его запись сервер не примет', async () => {
    setActivePinia(createPinia())
    signIn('c', 'viewer')
    const html = await renderScreen(AppearancePanel, '/')
    expect(html).not.toContain('Ваше имя')
    expect(html).not.toContain('placeholder="Имя"')
    // Остальное «Оформление» — дело устройства, viewer его видит.
    expect(html).toContain('Тема')
    expect(html).toContain('Цвета разделов')
  })

  it('«Цвета разделов»: ряд у всех пяти разделов с именами (заведённое — из документа), выбранный — aria-pressed; без абзаца про HEX', async () => {
    useFinanceStore().householdDoc.categories = [{ key: 'd1', name: 'Квартира', note: '', amount: 0, updatedAt: T0 }]
    storage.set('ff_category_hues', JSON.stringify({ d1: 'plum' }))
    const html = await renderScreen(AppearancePanel, '/')
    expect(html).toContain('Цвета разделов')
    for (const name of ['Квартира', 'Кредиты', 'Цели', 'Еда и быт', 'Свободно']) {
      expect(html).toContain(`role="group" aria-label="${name}"`)
    }
    // В ряду «Квартиры» выбран «plum», у «Кредитов» — дефолт «brick».
    const row = (name: string) => html.slice(html.indexOf(`aria-label="${name}"`)).split('role="group"')[0]
    expect(row('Квартира')).toContain(`aria-label="${HUES.plum.label}" aria-pressed="true"`)
    expect(row('Кредиты')).toContain(`aria-label="${HUES.brick.label}" aria-pressed="true"`)
    // Механика дизайна (пары светлой и тёмной темы, HEX) — не для человека (правило 12).
    expect(html).not.toContain('HEX')
    // Акцента пользователя нет — бренд один (B2C-12, DESIGN.md §3).
    expect(html).not.toContain('Основной цвет')
  })

  it('saveName: пустое — прежнее имя в поле, запись не идёт; то же имя — не пишется; новое — setPerson', async () => {
    const store = useFinanceStore()
    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('saveName' in this.$.setupState) vm = this.$.setupState } }
    await renderScreen(AppearancePanel, '/', undefined, [grab])
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

  it('updateCategoryHue: выбор — в ff_category_hues (устройство), в документ не попадает', async () => {
    const store = useFinanceStore()
    const before = JSON.stringify(store.householdDoc)
    vi.stubGlobal('document', {
      documentElement: { classList: { toggle: () => {} }, style: { setProperty: () => {} } },
    })
    const html = await renderScreen(AppearancePanel, '/', undefined, [
      screenMixin({}, (s) => (s.updateCategoryHue as (k: string, h: string) => void)('d1', 'teal')),
    ])
    expect(JSON.parse(storage.get('ff_category_hues')!)).toMatchObject({ d1: 'teal' })
    expect(JSON.stringify(store.householdDoc)).toBe(before)
    expect(html.slice(html.indexOf('aria-label="Жильё"')).split('role="group"')[0]).toContain(`aria-label="${HUES.teal.label}" aria-pressed="true"`)
    vi.unstubAllGlobals()
  })
})
