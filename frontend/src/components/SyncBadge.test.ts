import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { Person, PersonId } from '@/types/finance'
import SyncBadge from './SyncBadge.vue'

const T0 = '2026-09-01T00:00:00.000Z'
const person = (id: PersonId, name: string): Person => ({ id, name, salary: 500_000, payday: 10, updatedAt: T0 })

function signIn(role: 'member' | 'viewer', slot: PersonId = 'a') {
  useAuthStore().setAuthData({
    token: role === 'viewer' ? 'tv' : 'tm',
    user: { id: `u-${slot}`, email: `${slot}@example.com`, created_at: T0 },
    household: { id: 'h-1', name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    member: { household_id: 'h-1', user_id: `u-${slot}`, slot, display_name: 'Ильяс', role, joined_at: T0 },
  })
}

/** Шторка открыта (SSR: `Sheet` рисуется на месте). */
const sheet = (more: Record<string, unknown> = {}) =>
  renderScreen(SyncBadge, '/', undefined, [screenMixin({ open: true, ...more })])

describe('PV-21: шторка синка (Б-18)', () => {
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

  it('«Последний обмен» — дата и время, как React toLocaleString', async () => {
    signIn('member')
    const store = useFinanceStore()
    store.lastSyncedAt = '2026-09-26T08:05:00.000Z'
    const html = await sheet()
    expect(html).toContain('Последний обмен')
    expect(html).toContain(new Date('2026-09-26T08:05:00.000Z').toLocaleString('ru-RU'))
    expect(html).toContain('26.09.2026')
  })

  it('«В бюджете» — участники из people, свой отмечен «это вы»; пояснение про офлайн дословно', async () => {
    signIn('member', 'b')
    useFinanceStore().householdDoc.people = [person('a', 'Ильяс'), person('b', 'Аруна')]
    const html = await sheet()
    expect(html).toContain('В бюджете')
    expect(html).toContain('Ильяс')
    expect(html).toMatch(/Аруна\s*<span[^>]*>это вы<\/span>/)
    expect(html).not.toMatch(/Ильяс\s*<span[^>]*>это вы/)
    expect(html).not.toContain('только просмотр')
    expect(html.replace(/\s+/g, ' ')).toContain(
      'Записи сохраняются на устройстве сразу, даже без сети, и уезжают в облако при первой возможности. ' +
        'Если оба правили одно и то же офлайн — взносы и покупки сложатся, а не перезатрут друг друга.',
    )
    // Двое в бюджете — приглашать некого; «Начать заново» у участника есть.
    expect(html).not.toContain('Пригласить второго')
    expect(html).toContain('Начать бюджет заново')
  })

  it('viewer: участники видны, «только просмотр» у себя; ни приглашения, ни «Начать бюджет заново»', async () => {
    signIn('viewer', 'b')
    useFinanceStore().householdDoc.people = [person('b', 'Аруна')]
    const html = await sheet()
    expect(html).toContain('Аруна')
    expect(html).toContain('только просмотр')
    expect(html).not.toContain('Пригласить второго')
    expect(html).not.toContain('Начать бюджет заново')
  })

  it('партнёр-viewer с сервера: «только просмотр» у него, а не у себя (ревью frontend Б4 Н-2)', async () => {
    signIn('member')
    useFinanceStore().householdDoc.people = [person('a', 'Ильяс'), person('b', 'Аруна')]
    useAuthStore().members = [
      { slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: T0 },
      { slot: 'b', display_name: 'Аруна', role: 'viewer', joined_at: T0 },
    ]
    const html = await sheet()
    expect(html).toMatch(/Аруна\s*<span[^>]*>\s*только просмотр\s*<\/span>/)
    expect(html).toMatch(/Ильяс\s*<span[^>]*>это вы<\/span>\s*<\/div>/)
  })

  it('один в бюджете — приглашения в шторке нет: его дом — «С кем» в Настройках (ревью Блока 3, Н-11)', async () => {
    signIn('member')
    useFinanceStore().householdDoc.people = [person('a', 'Ильяс')]
    const html = await sheet()
    expect(html).not.toContain('Пригласить второго')
    expect(html).not.toContain('Создать код')
  })

  it('«Начать бюджет заново»: подтверждение с текстом React, «Стереть всё» — пустой документ с меткой, шторка закрыта', async () => {
    signIn('member')
    const store = useFinanceStore()
    store.householdDoc.people = [person('a', 'Ильяс'), person('b', 'Аруна')]
    const confirm = await sheet({ confirm: true })
    // Хвост PV (B2C-13): личный документ сброс не трогает — текст обещает только общие счета.
    expect(confirm.replace(/\s+/g, ' ')).toContain(
      'Сотрутся общие счета, доходы, цели, покупки и обязательства — у обоих участников и в облаке. Личные счета останутся. Отменить будет нельзя.',
    )
    expect(confirm).toContain('Стереть всё')
    expect(confirm).toContain('Отмена')

    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('startOver' in this.$.setupState) vm = this.$.setupState } }
    vi.spyOn(store, 'syncHousehold').mockResolvedValue()
    await renderScreen(SyncBadge, '/', undefined, [screenMixin({ open: true }), grab])
    vm.startOver()
    expect(vm.open).toBe(false)
    expect(store.householdDoc).toMatchObject({ ...defaultSyncDoc(), resetAt: expect.any(String) })
    expect(store.forceReplace).toBe(true)
    expect(store.syncHousehold).toHaveBeenCalled()
  })

  it('демо: шторка открывается, «живёт только на этом телефоне», сброс — локальный, без «Синхронизировать»', async () => {
    useAuthStore().setAuthData({
      token: DEMO_TOKEN,
      user: { id: 'demo-user-1', email: 'demo@family.local', created_at: T0 },
      household: { id: 'demo-household-1', name: 'Демо Семья', created_by: 'demo-user-1', created_at: T0 },
      member: { household_id: 'demo-household-1', user_id: 'demo-user-1', slot: 'a', display_name: 'Вы', role: 'member', joined_at: T0 },
    })
    const html = await sheet({ confirm: true })
    expect(html).toContain('Демо живёт только на этом телефоне.')
    expect(html).not.toContain('Синхронизировать')
    expect(html).not.toContain('Пригласить второго')
    expect(html).toContain('демо на этом телефоне. Отменить будет нельзя.')
  })
})
