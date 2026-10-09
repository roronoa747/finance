import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useInvite, useMembers } from './useInvite'

const T0 = '2026-09-01T00:00:00.000Z'

function signIn(household: string, role: 'member' | 'viewer' = 'member') {
  useAuthStore().setAuthData({
    token: 't',
    user: { id: 'u-a', email: 'a@example.com', created_at: T0 },
    household: { id: household, name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    member: { household_id: household, user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role, joined_at: T0 },
  })
}

describe('useInvite — один код на сессию и семью (ревью Блока 3, Н-11)', () => {
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

  it('код, созданный в одном месте, виден в другом — второй не создаётся; другая семья его не видит', async () => {
    signIn('h-invite-1')
    const create = vi.spyOn(useAuthStore(), 'createInvite').mockResolvedValue({ code: 'K7M2QX' } as never)
    const settings = useInvite()
    const firstRun = useInvite()
    await settings.make()
    expect(create).toHaveBeenCalledTimes(1)
    expect(settings.code.value).toBe('K7M2QX')
    expect(firstRun.code.value).toBe('K7M2QX')

    // Выход и вход в другую семью на этом телефоне — прежний код не показывается.
    setActivePinia(createPinia())
    signIn('h-invite-2')
    expect(useInvite().code.value).toBeNull()
  })

  it('canInvite: одиночка-участник — да; семья из двух, viewer — нет', () => {
    signIn('h-invite-3')
    const store = useFinanceStore()
    store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }]
    expect(useInvite().canInvite.value).toBe(true)
    // Удалённый участник — не участник.
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: T0, deletedAt: T0 },
    ]
    expect(useInvite().canInvite.value).toBe(true)
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: T0 },
    ]
    expect(useInvite().canInvite.value).toBe(false)

    setActivePinia(createPinia())
    signIn('h-invite-3', 'viewer')
    useFinanceStore().householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }]
    expect(useInvite().canInvite.value).toBe(false)
  })
})

describe('useMembers — состав семьи одним местом (ревью frontend Б4 Н-2, Р-124 п. 1)', () => {
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

  const member = (slot: 'a' | 'b' | 'c', name: string, role: 'member' | 'viewer' = 'member') => ({ slot, display_name: name, role, joined_at: T0 })

  it('партнёр ушёл: запись Даны осталась в документе, сервер считает одного — «Пригласить» снова есть', () => {
    signIn('h-members-1')
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: T0 },
    ]
    const auth = useAuthStore()
    auth.members = [member('a', 'Ильяс')]
    expect(useMembers().rows.value.map((r) => r.name)).toEqual(['Ильяс'])
    expect(useInvite().canInvite.value).toBe(true)

    // Новый партнёр вошёл — двое участников по серверу, кода нет; viewer участником не считается.
    auth.members = [member('a', 'Ильяс'), member('c', 'Бек')]
    expect(useInvite().canInvite.value).toBe(false)
    auth.members = [member('a', 'Ильяс'), member('c', 'Гость', 'viewer')]
    expect(useInvite().canInvite.value).toBe(true)
    expect(useMembers().rows.value.find((r) => r.id === 'c')?.role).toBe('viewer')
  })
})
