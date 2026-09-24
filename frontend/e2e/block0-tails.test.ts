import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore, DEMO_TOKEN } from '../src/stores/auth'
import { useFinanceStore, defaultSyncDoc, DEMO_HOUSEHOLD } from '../src/stores/finance'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc, Account } from '../src/types/finance'
import type { HouseholdDocResponse, PrivateDocResponse } from '../src/types/api'

/**
 * Блок 0 «Хвосты переключения» — сценарии приёмки на фейковом бэкенде.
 * RP-05 (Р-32): демо — черновик будущей семьи.
 */

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

// Бэкенд одной семьи: общий и личный документ с ревизиями, как Go-ручки синка.
function fakeFamily(householdId: string, data: SyncDoc | Record<string, never>, rev = 1) {
  const state = {
    household: { rev, data: clone(data) as SyncDoc },
    private: { rev: 1, data: {} as Record<string, unknown> },
  }
  const doc = (): HouseholdDocResponse => ({
    household_id: householdId,
    rev: state.household.rev,
    data: clone(state.household.data),
    updated_at: '2026-09-24T00:00:00Z',
  })
  const priv = (): PrivateDocResponse => ({
    household_id: householdId,
    user_id: 'u-1',
    rev: state.private.rev,
    data: clone(state.private.data),
    updated_at: '2026-09-24T00:00:00Z',
  })
  const client = {
    getHouseholdDoc: vi.fn(async () => doc()),
    pushHouseholdDoc: vi.fn(async (lastSeen: number, data: SyncDoc) => {
      if (lastSeen !== state.household.rev) throw new ApiError('conflict', 409, { error: 'conflict', server_doc: doc() })
      state.household = { rev: state.household.rev + 1, data: clone(data) }
      return doc()
    }),
    getPrivateDoc: vi.fn(async () => priv()),
    pushPrivateDoc: vi.fn(async (lastSeen: number, data: Record<string, unknown>) => {
      if (lastSeen !== state.private.rev) throw new ApiError('conflict', 409, { error: 'conflict', server_doc: priv() })
      state.private = { rev: state.private.rev + 1, data: clone(data) }
      return priv()
    }),
  } as unknown as ApiClient
  return { state, client }
}

function signIn(token: string, householdId: string, displayName: string) {
  useAuthStore().setAuthData({
    token,
    user: { id: `u-${token}`, email: `${token}@example.com`, created_at: '2026-09-24T00:00:00Z' },
    household: { id: householdId, name: 'Семья', created_by: `u-${token}`, created_at: '2026-09-24T00:00:00Z' },
    member: {
      household_id: householdId,
      user_id: `u-${token}`,
      slot: 'a',
      display_name: displayName,
      role: 'member',
      joined_at: '2026-09-24T00:00:00Z',
    },
  })
}

// Как «Попробовать в демо» (Access.vue): черновик демо с примером, потом правки человека.
function startDemoAndEdit() {
  signIn(DEMO_TOKEN, DEMO_HOUSEHOLD, 'Ильяс')
  const finance = useFinanceStore()
  finance.startNewFamily(DEMO_HOUSEHOLD)
  finance.mutateHouseholdDoc((doc) => {
    doc.setupDoneAt = '2026-09-24T00:00:00Z'
    doc.people = [
      { id: 'a', name: 'Ильяс', salary: 750_000, payday: 10, updatedAt: '2026-09-24T00:00:00Z' },
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 20, updatedAt: '2026-09-24T00:00:00Z' },
    ]
    doc.categories = [{ key: 'd4', name: 'Еда и быт', note: '', amount: 280_000, updatedAt: '2026-09-24T00:00:00Z' }]
  })
  finance.setCategoryAmount('d4', 310_000)
  finance.addAccount({ name: 'Моя заначка', kind: 'cash', amount: 50_000 }, true)
  // Выход из демо к регистрации/входу (AppearancePanel): черновик остаётся на телефоне.
  useAuthStore().clearAuth()
  return finance
}

describe('e2e / Блок 0 — демо как черновик будущей семьи (RP-05)', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
  })

  it('демо → правки → регистрация → «да»: новая семья получила весь черновик с именем из регистрации', async () => {
    const finance = startDemoAndEdit()
    expect(finance.isDemo).toBe(true)

    // Регистрация: сервер создал семью с пустыми документами.
    const family = fakeFamily('h-new', {})
    signIn('tok-new', 'h-new', 'Дана')
    await finance.adoptDemo('h-new', 'Дана', family.client)

    const shared = family.state.household.data
    expect(shared.people.find((p) => p.id === 'a')?.name).toBe('Дана')
    expect(shared.people.find((p) => p.id === 'b')?.name).toBe('Аруна')
    expect(shared.categories.find((c) => c.key === 'd4')?.amount).toBe(310_000)
    expect(shared.setupDoneAt).toBe('2026-09-24T00:00:00Z')
    expect((family.state.private.data.accounts as Account[]).map((a) => a.name)).toEqual(['Моя заначка'])

    expect(finance.isDemo).toBe(false)
    expect(finance.docHousehold).toBe('h-new')
    expect(finance.setupDone).toBe(true)
    expect(finance.hasUnsent).toBe(false)
    expect(finance.status).toBe('idle')
  })

  it('демо → регистрация → «нет»: пустой документ, мастер настройки, на сервер ничего не ушло', () => {
    const finance = startDemoAndEdit()
    const family = fakeFamily('h-new', {})
    signIn('tok-new', 'h-new', 'Дана')

    finance.startNewFamily('h-new')

    expect(finance.householdDoc).toEqual(defaultSyncDoc())
    expect(finance.privateDoc).toEqual({})
    expect(finance.setupDone).toBe(false)
    expect(finance.isDemo).toBe(false)
    expect(family.client.pushHouseholdDoc).not.toHaveBeenCalled()
  })

  it('демо → вход по коду приглашения: документ семьи не изменился, демо отброшено', async () => {
    const finance = startDemoAndEdit()
    const familyDoc: SyncDoc = {
      ...defaultSyncDoc(),
      setupDoneAt: '2026-09-01T00:00:00Z',
      people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '2026-09-01T00:00:00Z' }],
      categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '2026-09-01T00:00:00Z' }],
    }
    const family = fakeFamily('h-fam', familyDoc, 5)
    signIn('tok-join', 'h-fam', 'Аруна')

    await finance.enterFamily('h-fam', family.client)

    expect(family.state.household.rev).toBe(5)
    expect(family.state.household.data).toEqual(familyDoc)
    expect(family.client.pushHouseholdDoc).not.toHaveBeenCalled()
    expect(family.client.pushPrivateDoc).not.toHaveBeenCalled()
    expect(finance.householdDoc).toEqual(familyDoc)
    expect(finance.householdRev).toBe(5)
    expect(finance.privateAccounts).toEqual([])
    expect(finance.hasUnsent).toBe(false)
    expect(finance.isDemo).toBe(false)
  })
})
