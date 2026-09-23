import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth'
import { apiClient } from '@/api/client'
import type { AuthResponse, MeResponse } from '@/types/api'

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
})
