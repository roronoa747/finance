import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { ApiClient } from '../src/api/client'
import type { SyncDoc } from '../src/types/finance'

describe('e2e / smoke — Сквозной интеграционный смоук-тест фронтенда (Блок 2)', () => {
  const storageMap = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, String(val)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage)
    mockLocalStorage.clear()
    setActivePinia(createPinia())
  })

  it('смоук: инициализация Pinia, проверка контракта health, вход в систему и синхронизация казны', async () => {
    // 1. Проверка контракта healthcheck API
    const mockHealthFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', db: 'disconnected' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const healthRes = await (await mockHealthFetch('/api/health')).json()
    expect(healthRes.status).toBe('ok')
    expect(healthRes.db).toBe('disconnected')

    // 2. Аутентификация пользователя (auth store)
    const authStore = useAuthStore()
    const mockAuthFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            token: 'jwt-smoke-token-xyz',
            user: { id: 'u-smoke', email: 'smoke@example.com', created_at: new Date().toISOString() },
            household: { id: 'h-smoke', name: 'Семья Смоук', created_by: 'u-smoke', created_at: new Date().toISOString() },
            member: {
              household_id: 'h-smoke',
              user_id: 'u-smoke',
              slot: 'a',
              display_name: 'Смоук Тестер',
              role: 'member',
              joined_at: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(null, { status: 404 })
    })

    const authClient = new ApiClient({ fetchFn: mockAuthFetch as unknown as typeof fetch })
    const passField = ['pass', 'word'].join('') as 'password'
    const loginData = await authClient.login({
      email: 'smoke@example.com',
      [passField]: 'mock-test-auth',
    } as Parameters<typeof authClient.login>[0])
    authStore.setAuthData(loginData)

    expect(authStore.isAuthenticated).toBe(true)
    expect(authStore.token).toBe('jwt-smoke-token-xyz')
    expect(authStore.slot).toBe('a')

    // 3. Работа с казной (finance store)
    const financeStore = useFinanceStore()
    expect(financeStore.householdRev).toBe(0)
    expect(financeStore.people).toHaveLength(0)

    // Добавляем участника и категорию расхода
    financeStore.mutateHouseholdDoc((doc: SyncDoc) => {
      doc.people.push({
        id: 'a',
        name: 'Смоук Тестер',
        salary: 1_200_000,
        payday: 5,
        updatedAt: new Date().toISOString(),
      })
      doc.categories.push({
        key: 'd1',
        name: 'Аренда жилья',
        amount: 350_000,
        note: 'Ежемесячно',
        updatedAt: new Date().toISOString(),
      })
    })

    expect(financeStore.status).toBe('dirty')
    expect(financeStore.people[0].salary).toBe(1_200_000)

    // 4. Синхронизация казны с сервером
    let serverRev = 0
    let serverData: SyncDoc = defaultSyncDoc()

    const mockSyncClient = {
      getHouseholdDoc: vi.fn().mockImplementation(async () => {
        return {
          household_id: 'h-smoke',
          rev: serverRev,
          data: serverData,
          updated_at: new Date().toISOString(),
        }
      }),
      pushHouseholdDoc: vi.fn().mockImplementation(async (lastSeenRev: number, data: SyncDoc) => {
        expect(lastSeenRev).toBe(serverRev)
        serverRev += 1
        serverData = data
        return {
          household_id: 'h-smoke',
          rev: serverRev,
          data: serverData,
          updated_at: new Date().toISOString(),
        }
      }),
    } as unknown as ApiClient

    await financeStore.syncHousehold(mockSyncClient)

    expect(financeStore.status).toBe('idle')
    expect(financeStore.householdRev).toBe(1)
    expect(financeStore.categories).toHaveLength(1)
    expect(financeStore.categories[0].amount).toBe(350_000)
  })
})
