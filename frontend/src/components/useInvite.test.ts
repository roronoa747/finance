import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useInvite } from './useInvite'

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
