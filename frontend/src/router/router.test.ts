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

  function signIn() {
    useAuthStore().setAuthData({
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

    await router.push('/money/budget')
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
    signIn()
    const financeStore = useFinanceStore()
    expect(useAuthStore().isAuthenticated).toBe(true)
    expect(financeStore.setupDone).toBe(false)

    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/setup')

    await router.push('/money/budget')
    expect(router.currentRoute.value.path).toBe('/setup')
  })

  it('авторизованный пользователь при попытке зайти на /access отправляется в приложение', async () => {
    const router = createAppRouter(createMemoryHistory())
    signIn()
    const financeStore = useFinanceStore()

    // 1. Если настройка не завершена -> /setup
    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/setup')

    // 2. Если настройка завершена -> /
    financeStore.finishSetup()
    expect(financeStore.setupDone).toBe(true)

    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('авторизованный пользователь с завершённым бюджетом имеет доступ к / и вкладкам «Неделя», «Деньги», второму уровню и настройкам', async () => {
    const router = createAppRouter(createMemoryHistory())
    signIn()
    useFinanceStore().finishSetup()

    for (const path of ['/', '/week', '/week/salary', '/money', '/money/budget', '/money/capital', '/money/capital/x', '/money/plan', '/goals/x', '/goals/new', '/wishes', '/settings']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
    }
  })

  describe('B2C-13: старые адреса установленных PWA — редиректы с сохранением параметров', () => {
    it.each([
      ['/budget', '/money/budget'],
      ['/capital', '/money/capital'],
      ['/capital?credit=loan', '/money/capital?credit=loan'],
      ['/capital?add=debt', '/money/capital?add=debt'],
      ['/capital/acc-depo', '/money/capital/acc-depo'],
      ['/goals', '/'],
      ['/goals/g-japan', '/goals/g-japan'],
      ['/ritual', '/week'],
      ['/ritual?from=salary&person=a&period=2026-09', '/week/salary?from=salary&person=a&period=2026-09'],
      ['/ritual?from=rest&amount=80000&period=2026-09', '/week/salary?from=rest&amount=80000&period=2026-09'],
      ['/plan', '/money/plan'],
      ['/statements', '/week'],
      ['/nothing-here', '/'],
    ])('%s → %s', async (from, to) => {
      const router = createAppRouter(createMemoryHistory())
      signIn()
      useFinanceStore().finishSetup()
      await router.push(from)
      expect(router.currentRoute.value.fullPath).toBe(to)
    })
  })
})
