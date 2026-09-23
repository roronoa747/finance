import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from './index'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'

describe('router/index.ts — Навигационные гарды и защита маршрутов', () => {
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

  it('неавторизованный пользователь перенаправляется на /access', async () => {
    const router = createAppRouter(createMemoryHistory())
    const authStore = useAuthStore()
    expect(authStore.isAuthenticated).toBe(false)

    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/access')

    await router.push('/budget')
    expect(router.currentRoute.value.path).toBe('/access')

    await router.push('/setup')
    expect(router.currentRoute.value.path).toBe('/access')
  })

  it('неавторизованный пользователь свободно заходит на /access', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/access')
  })

  it('авторизованный пользователь без завершённой настройки перенаправляется на /setup', async () => {
    const router = createAppRouter(createMemoryHistory())
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    authStore.setAuthData({
      token: 'tok-123',
      user: { id: 'u1', email: 'test@example.com', created_at: '' },
      household: { id: 'h1', name: 'Family', created_by: 'u1', created_at: '' },
      member: {
        household_id: 'h1',
        user_id: 'u1',
        slot: 'a',
        display_name: 'Ильяс',
        role: 'member',
        joined_at: '',
      },
    })
    expect(authStore.isAuthenticated).toBe(true)
    expect(financeStore.setupDone).toBe(false)

    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/setup')

    await router.push('/budget')
    expect(router.currentRoute.value.path).toBe('/setup')
  })

  it('авторизованный пользователь при попытке зайти на /access отправляется в приложение', async () => {
    const router = createAppRouter(createMemoryHistory())
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    authStore.setAuthData({
      token: 'tok-123',
      user: { id: 'u1', email: 'test@example.com', created_at: '' },
      household: { id: 'h1', name: 'Family', created_by: 'u1', created_at: '' },
      member: {
        household_id: 'h1',
        user_id: 'u1',
        slot: 'a',
        display_name: 'Ильяс',
        role: 'member',
        joined_at: '',
      },
    })

    // 1. Если настройка не завершена -> /setup
    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/setup')

    // 2. Если настройка завершена -> /
    financeStore.finishSetup()
    expect(financeStore.setupDone).toBe(true)

    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('авторизованный пользователь с завершённым бюджетом имеет доступ к / и вкладкам', async () => {
    const router = createAppRouter(createMemoryHistory())
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    authStore.setAuthData({
      token: 'tok-123',
      user: { id: 'u1', email: 'test@example.com', created_at: '' },
      household: { id: 'h1', name: 'Family', created_by: 'u1', created_at: '' },
      member: {
        household_id: 'h1',
        user_id: 'u1',
        slot: 'a',
        display_name: 'Ильяс',
        role: 'member',
        joined_at: '',
      },
    })
    financeStore.finishSetup()

    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')

    await router.push('/budget')
    expect(router.currentRoute.value.path).toBe('/budget')

    await router.push('/goals')
    expect(router.currentRoute.value.path).toBe('/goals')

    await router.push('/capital')
    expect(router.currentRoute.value.path).toBe('/capital')
  })
})
