import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter, routes } from './index'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'

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

    await router.push('/start')
    expect(router.currentRoute.value.path).toBe('/access')
  })

  it('неавторизованный пользователь свободно заходит на /access', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/access')
  })

  it('авторизованный пользователь без завершённой настройки перенаправляется на /start', async () => {
    const router = createAppRouter(createMemoryHistory())
    signIn()
    const financeStore = useFinanceStore()
    expect(useAuthStore().isAuthenticated).toBe(true)
    expect(financeStore.setupDone).toBe(false)

    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/start')

    await router.push('/money/budget')
    expect(router.currentRoute.value.path).toBe('/start')

    // Старый адрес мастера — на первый запуск.
    await router.push('/setup')
    expect(router.currentRoute.value.path).toBe('/start')
  })

  it('авторизованный пользователь при попытке зайти на /access отправляется в приложение', async () => {
    const router = createAppRouter(createMemoryHistory())
    signIn()
    const financeStore = useFinanceStore()

    // 1. Если настройка не завершена -> /start
    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/start')

    // 2. Если настройка завершена и участник записан -> / (без своей записи был бы /start — партнёр по коду, B2C-19)
    financeStore.finishSetup()
    financeStore.setPerson('a', { name: 'Ильяс', salary: 700_000, payday: 10 })
    expect(financeStore.setupDone).toBe(true)

    await router.push('/access')
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('авторизованный пользователь с завершённым бюджетом имеет доступ к / и вкладкам «Неделя», «Деньги», второму уровню и настройкам', async () => {
    const router = createAppRouter(createMemoryHistory())
    signIn()
    useFinanceStore().finishSetup()

    for (const path of ['/', '/week', '/money', '/money/plan', '/money/history', '/goals/x', '/goals/new', '/wishes', '/people/a', '/settings']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
    }
  })

  it('viewer: экраны-формы (новая мечта) по прямому адресу ведут на главный; старые ссылки раскладки и разбора — план месяца (Блок 14)', async () => {
    useAuthStore().setAuthData(authAs('viewer', 'b'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/week')
    await router.push('/goals/new')
    expect(router.currentRoute.value.fullPath).toBe('/')
    for (const [path, to] of [
      ['/week/salary?from=rest&amount=1&period=2026-09', '/money'],
      ['/ritual?from=salary&person=a&period=2026-09', '/money'],
      ['/week/order?from=salary&person=a&period=2026-09', '/money'],
      ['/week/breakdown?from=salary&person=a&period=2026-09', '/money'],
    ]) {
      await router.push('/week')
      await router.push(path)
      expect(router.currentRoute.value.fullPath).toBe(to)
    }
    // Остальное viewer смотрит как есть.
    for (const path of ['/week', '/money', '/money/plan', '/money/history', '/goals/cushion', '/wishes']) {
      await router.push(path)
      expect(router.currentRoute.value.path).toBe(path)
    }
  })

  describe('B2C-13: старые адреса установленных PWA — редиректы с сохранением параметров', () => {
    it.each([
      // Пивот 3 (Р-31): Бюджет и Капитал — квадрат «Капитал» `/money`, окна — те же ключи query.
      ['/budget', '/money'],
      ['/capital', '/money'],
      ['/capital?credit=loan', '/money?credit=loan'],
      ['/capital?add=debt', '/money?add=debt'],
      ['/capital/acc-depo', '/money?account=acc-depo'],
      ['/money/budget', '/money'],
      ['/money/capital', '/money'],
      ['/money/capital?add=debt', '/money?add=debt'],
      ['/money/capital?income=1', '/money?income=1'],
      ['/money/capital?advice=strategy', '/money/plan'],
      ['/capital?advice=strategy', '/money/plan'],
      ['/money/capital/x', '/money?account=x'],
      ['/money/plan', '/money/plan'],
      ['/money/history', '/money/history'],
      ['/goals', '/'],
      ['/goals/g-japan', '/goals/g-japan'],
      // Раскладка, разбор кольцом и «Ваш порядок» — план месяца «Денег» с любыми параметрами (Блок 14, Р-78).
      ['/ritual', '/money'],
      ['/ritual?from=salary&person=a&period=2026-09', '/money'],
      ['/ritual?from=rest&amount=80000&period=2026-09', '/money'],
      ['/week/salary?from=salary&person=a&period=2026-09', '/money'],
      ['/week/salary?from=rest&amount=80000&period=2026-09', '/money'],
      ['/week/salary?from=freed', '/money'],
      ['/week/salary', '/money'],
      ['/week/salary?from=credit&credit=inst', '/money'],
      ['/week/breakdown', '/money'],
      ['/week/breakdown?from=salary&person=a&period=2026-09', '/money'],
      ['/week/breakdown?from=plan', '/money'],
      ['/week/order', '/money'],
      ['/week/order?from=salary&person=a&period=2026-09', '/money'],
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

    it('квадраты «Денег» — один маршрут и один экран `Money` (ленивый чанк), квадрат — параметр адреса', async () => {
      const router = createAppRouter(createMemoryHistory())
      signIn()
      useFinanceStore().finishSetup()
      const records = new Set<unknown>()
      for (const [path, square] of [['/money', undefined], ['/money/plan', 'plan'], ['/money/history', 'history']] as const) {
        await router.push(path)
        const r = router.currentRoute.value
        expect(r.name).toBe('money')
        expect(r.params.square || undefined).toBe(square)
        records.add(r.matched.at(-1)!.components!.default)
      }
      expect(records.size).toBe(1)
      // Ленивый: в описании маршрута — загрузчик `() => import(...)`, а не сам компонент.
      const shell = routes.find((r) => r.path === '/')!
      expect(typeof shell.children!.find((r) => r.name === 'money')!.component).toBe('function')
    })
  })
})
