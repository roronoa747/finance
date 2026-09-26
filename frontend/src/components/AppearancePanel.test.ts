import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { renderScreen, screenMixin } from '@/test/screenState'
import { ACCENTS, HUES } from '@/lib/palette'
import type { PersonId } from '@/types/finance'
import AppearancePanel from './AppearancePanel.vue'

const T0 = '2026-09-01T00:00:00.000Z'

function signIn(slot: PersonId = 'a') {
  useAuthStore().setAuthData({
    token: 't',
    user: { id: `u-${slot}`, email: 'ilyas@example.com', created_at: T0 },
    household: { id: 'h-1', name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    // Имя аккаунта нарочно другое: источник — документ, а не аккаунт.
    member: { household_id: 'h-1', user_id: `u-${slot}`, slot, display_name: 'ilyas', role: 'member', joined_at: T0 },
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

  it('имя — из people[slot], подпись React', async () => {
    const html = await renderScreen(AppearancePanel, '/')
    expect(html).toMatch(/<input[^>]*value="Ильяс"/)
    expect(html).not.toMatch(/value="ilyas"/)
    expect(html.replace(/\s+/g, ' ')).toContain(
      'Так вас видит партнёр — на полосе доходов, в покупках и во взносах. По умолчанию подставляется начало адреса почты.',
    )
  })

  it('«Цвета разделов»: ряд у всех пяти разделов с именами (заведённое — из документа), выбранный — aria-pressed; примечание дословно', async () => {
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
    expect(html.replace(/\s+/g, ' ')).toContain(
      'Каждый цвет задан парой значений — для светлой и тёмной темы. Свободного выбора HEX нет намеренно: так нельзя получить сочетание, которое станет нечитаемым при смене темы.',
    )
    // Акцент тоже помечает выбранный.
    expect(html).toContain(`aria-label="${ACCENTS.emerald.label}" aria-pressed="true"`)
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
