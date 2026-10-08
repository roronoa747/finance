import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth'
import { apiClient, ApiClient, ApiError } from '@/api/client'
import { useFinanceStore } from './finance'
import { landingPath } from '@/router/landing'
import type { AuthResponse, MeResponse } from '@/types/api'
import { cachedPhotos, photoUrl } from '@/lib/photos/store'

describe('stores/auth.ts — Pinia хранилище авторизации и домохозяйства', () => {
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

  it('login сохраняет сессию в store и localStorage', async () => {
    const mockAuthResponse: AuthResponse = {
      token: 'jwt-token-abc',
      user: { id: 'u-1', email: 'user@example.com', created_at: '2026-09-23T10:00:00Z' },
      household: {
        id: 'h-1',
        name: 'Семья Ильяса',
        created_by: 'u-1',
        created_at: '2026-09-23T10:00:00Z',
      },
      member: {
        household_id: 'h-1',
        user_id: 'u-1',
        slot: 'a',
        display_name: 'Ильяс',
        role: 'member',
        joined_at: '2026-09-23T10:00:00Z',
      },
    }

    vi.spyOn(apiClient, 'login').mockResolvedValue(mockAuthResponse)

    const auth = useAuthStore()
    expect(auth.isAuthenticated).toBe(false)

    await auth.login({ email: 'user@example.com', password: 'mock-pass' })

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.token).toBe('jwt-token-abc')
    expect(auth.user?.email).toBe('user@example.com')
    expect(auth.isMember).toBe(true)
    expect(auth.slot).toBe('a')
    expect(mockLocalStorage.getItem('ff_auth_token')).toBe('jwt-token-abc')
  })

  it('logout очищает состояние и хранилище', () => {
    const auth = useAuthStore()
    auth.setAuthData({
      token: 'tok-1',
      user: { id: 'u1', email: 'a@b.c', created_at: '' },
      household: { id: 'h1', name: 'H', created_by: 'u1', created_at: '' },
      member: {
        household_id: 'h1',
        user_id: 'u1',
        slot: 'b',
        display_name: 'Аруна',
        role: 'viewer',
        joined_at: '',
      },
    })

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isViewer).toBe(true)

    auth.logout()

    expect(auth.isAuthenticated).toBe(false)
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
    expect(mockLocalStorage.getItem('ff_auth_token')).toBeNull()
  })

  // Ревью Блока 3 Н-13: object URL фото семьи не переживают выход (B2C-17) — e2e зовёт releasePhotos руками.
  it('logout освобождает кэш фото: cachedPhotos() === 0', async () => {
    const auth = useAuthStore()
    auth.setAuthData({
      token: 'tok-1',
      user: { id: 'u1', email: 'a@b.c', created_at: '' },
      household: { id: 'h1', name: 'H', created_by: 'u1', created_at: '' },
      member: { household_id: 'h1', user_id: 'u1', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
    })
    const client = { getPhoto: vi.fn(async () => new Blob(['img'], { type: 'image/jpeg' })) } as unknown as typeof apiClient
    await photoUrl('ph-1', client)
    await photoUrl('ph-2', client)
    expect(cachedPhotos()).toBe(2)

    expect(auth.logout()).toBe(true)

    expect(cachedPhotos()).toBe(0)
  })

  it('fetchMe обновляет данные текущего пользователя', async () => {
    const auth = useAuthStore()
    auth.token = 'existing-token'

    const meRes: MeResponse = {
      user: { id: 'u-1', email: 'me@example.com', created_at: '' },
      household: { id: 'h-1', name: 'Наша Семья', created_by: 'u-1', created_at: '' },
      member: {
        household_id: 'h-1',
        user_id: 'u-1',
        slot: 'a',
        display_name: 'Ильяс',
        role: 'member',
        joined_at: '',
      },
    }

    vi.spyOn(apiClient, 'me').mockResolvedValue(meRes)

    await auth.fetchMe()

    expect(auth.user?.email).toBe('me@example.com')
    expect(auth.household?.name).toBe('Наша Семья')
  })

  it('fetchMe при 401 очищает токен и сессию', async () => {
    const auth = useAuthStore()
    auth.token = 'expired-token'
    auth.user = { id: 'u-1', email: 'me@example.com', created_at: '' }

    const { ApiError } = await import('@/api/client')
    vi.spyOn(apiClient, 'me').mockRejectedValue(new ApiError('Unauthorized', 401))

    await expect(auth.fetchMe()).rejects.toThrow('Unauthorized')
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
  })

  it('fetchMe при сетевой ошибке сохраняет локальную сессию', async () => {
    const auth = useAuthStore()
    auth.token = 'valid-token'
    auth.user = { id: 'u-1', email: 'me@example.com', created_at: '' }

    vi.spyOn(apiClient, 'me').mockRejectedValue(new Error('Network error (offline)'))

    await expect(auth.fetchMe()).rejects.toThrow('Network error')
    // Сессия должна остаться, чтобы приложение работало офлайн
    expect(auth.token).toBe('valid-token')
    expect(auth.user?.email).toBe('me@example.com')
    expect(auth.isAuthenticated).toBe(true)
  })

  it('createInvite и joinHousehold', async () => {
    const auth = useAuthStore()
    vi.spyOn(apiClient, 'createInvite').mockResolvedValue({
      code: 'INVITE123',
      expires_at: '2026-09-24T10:00:00Z',
    })

    const inv = await auth.createInvite()
    expect(inv.code).toBe('INVITE123')

    vi.spyOn(apiClient, 'joinHousehold').mockResolvedValue({
      token: 'joined-token',
      member: {
        household_id: 'h-2',
        user_id: 'u-2',
        slot: 'b',
        display_name: 'Аруна',
        role: 'member',
        joined_at: '',
      },
    })
    vi.spyOn(apiClient, 'me').mockResolvedValue({
      user: { id: 'u-2', email: 'aruna@example.com', created_at: '' },
      household: { id: 'h-2', name: 'Семья', created_by: 'u-1', created_at: '' },
      member: {
        household_id: 'h-2',
        user_id: 'u-2',
        slot: 'b',
        display_name: 'Аруна',
        role: 'member',
        joined_at: '',
      },
    })

    const joinRes = await auth.joinHousehold({ code: 'INVITE123', display_name: 'Аруна' })
    expect(joinRes.token).toBe('joined-token')
    expect(auth.token).toBe('joined-token')
    expect(auth.user?.email).toBe('aruna@example.com')
    expect(auth.isMember).toBe(true)
  })
})

describe('B2C-25: вход через Google, «с кем», истёкший вход, удаление аккаунта', () => {
  const storageMap = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, val: string) => storageMap.set(key, String(val)),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
    })
    storageMap.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  const google = (household: boolean): AuthResponse => ({
    token: 'g-token',
    user: { id: 'u-g', email: 'dana@example.com', display_name: 'Дана', created_at: '' },
    household: household ? { id: 'h-g', name: 'Наша казна', created_by: 'u-g', created_at: '' } : null,
    member: household ? { household_id: 'h-g', user_id: 'u-g', slot: 'a', display_name: 'Дана', role: 'member', joined_at: '' } : null,
  })

  it('googleLogin без семьи — сессия есть, семьи нет: дальше «с кем»; createHousehold — токен с семьёй', async () => {
    const login = vi.spyOn(apiClient, 'googleLogin').mockResolvedValue(google(false))
    const auth = useAuthStore()
    await auth.googleLogin('id-token-from-gis')
    expect(login).toHaveBeenCalledWith('id-token-from-gis')
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.hasHousehold).toBe(false)
    expect(landingPath(auth, useFinanceStore())).toBe('/who')
    expect(storageMap.get('ff_household')).toBe('null')

    // Перезапуск приложения: без семьи — всё так же «с кем».
    setActivePinia(createPinia())
    expect(useAuthStore().hasHousehold).toBe(false)

    const create = vi.spyOn(apiClient, 'createHousehold').mockResolvedValue(google(true))
    await useAuthStore().createHousehold({ display_name: 'Дана' })
    expect(create).toHaveBeenCalledWith({ display_name: 'Дана' })
    expect(useAuthStore().hasHousehold).toBe(true)
    expect(useAuthStore().slot).toBe('a')
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/start')
  })

  it('401 любой ручки — выход без стирания документа (вход в ту же семью сольёт его)', async () => {
    useAuthStore().setAuthData(google(true))
    const finance = useFinanceStore()
    finance.claimFor('h-g')
    finance.setPerson('a', { name: 'Дана' })
    const client = new ApiClient({
      fetchFn: async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    })
    const expired = vi.fn(() => useAuthStore().expire())
    client.onUnauthorized = expired
    await expect(client.getHouseholdDoc()).rejects.toBeInstanceOf(ApiError)
    expect(expired).toHaveBeenCalledTimes(1)
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(storageMap.has('ff_auth_token')).toBe(false)
    // Документ и неотправленное — на месте.
    expect(finance.people.find((p) => p.id === 'a')?.name).toBe('Дана')
    expect(finance.unsent).toBe(true)
    expect(storageMap.get('ff_doc_household')).toBe('"h-g"')

    // Без токена (вход Google с плохим ID-токеном) 401 сессию не трогает.
    const anon = new ApiClient({
      getToken: () => null,
      fetchFn: async () => new Response(JSON.stringify({ error: 'invalid google token' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    })
    const hook = vi.fn()
    anon.onUnauthorized = hook
    await expect(anon.googleLogin('bad')).rejects.toBeInstanceOf(ApiError)
    expect(hook).not.toHaveBeenCalled()
  })

  it('удаление аккаунта — DELETE /api/account, затем всё локальное стёрто (тема остаётся)', async () => {
    useAuthStore().setAuthData(google(true))
    const finance = useFinanceStore()
    finance.claimFor('h-g')
    finance.setPerson('a', { name: 'Дана' })
    storageMap.set('ff_theme', 'dark')
    const del = vi.spyOn(apiClient, 'deleteAccount').mockResolvedValue()
    await useAuthStore().deleteAccount()
    expect(del).toHaveBeenCalledTimes(1)
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(finance.people).toEqual([])
    for (const key of ['ff_auth_token', 'ff_household_doc', 'ff_doc_household', 'ff_unsent']) expect(storageMap.has(key), key).toBe(false)
    expect(storageMap.get('ff_theme')).toBe('dark')
  })

  it('удаление не удалось (нет сети) — сессия и данные на месте', async () => {
    useAuthStore().setAuthData(google(true))
    useFinanceStore().claimFor('h-g')
    vi.spyOn(apiClient, 'deleteAccount').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(useAuthStore().deleteAccount()).rejects.toThrow()
    expect(useAuthStore().isAuthenticated).toBe(true)
    expect(storageMap.get('ff_doc_household')).toBe('"h-g"')
  })
})
