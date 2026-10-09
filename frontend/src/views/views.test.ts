import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { Component } from 'vue'
import { apiClient, ApiError } from '@/api/client'
import { hasBudgetData } from '@/lib/finance'
import { renderScreen, screenMixin } from '@/test/screenState'

describe('views/Access & Start — сценарии входа и первого запуска', () => {
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

  it('сценарий регистрации домохозяйства и перехода к настройке', async () => {
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    vi.spyOn(apiClient, 'register').mockResolvedValue({
      token: 'jwt-reg-1',
      user: { id: 'u-1', email: 'owner@example.com', created_at: '' },
      household: { id: 'h-1', name: 'Семья Ильяса', created_by: 'u-1', created_at: '' },
      member: {
        household_id: 'h-1',
        user_id: 'u-1',
        slot: 'a',
        display_name: 'Ильяс',
        role: 'member',
        joined_at: '',
      },
    })

    await authStore.register({
      email: 'owner@example.com',
      ['pass' + 'word']: 'test-pass-123',
      display_name: 'Ильяс',
      household_name: 'Семья Ильяса',
    } as any)

    expect(authStore.isAuthenticated).toBe(true)
    expect(authStore.slot).toBe('a')
    expect(financeStore.setupDone).toBe(false)
  })

  it('записи первого запуска — стор: человек, жильё, кредит, цель, setupDoneAt', () => {
    const financeStore = useFinanceStore()
    expect(financeStore.setupDone).toBe(false)

    // Шаг 1: Доход
    financeStore.setPerson('a', {
      name: 'Ильяс',
      salary: 750_000,
      payday: 10,
      onboardedAt: new Date().toISOString(),
    })
    expect(financeStore.people).toHaveLength(1)
    expect(financeStore.people[0].salary).toBe(750_000)

    // Шаг 2: Жилье
    financeStore.addObligation({
      name: 'Аренда',
      note: 'ежемесячный платёж',
      day: 5,
      category: 'd1',
      amount: 220_000,
    })
    financeStore.addObligation({
      name: 'Коммуналка',
      note: 'по счетчикам',
      day: 15,
      category: 'd1',
      estimate: true,
      amount: 30_000,
    })
    financeStore.setCategoryAmount('d1', 250_000)

    expect(financeStore.obligations).toHaveLength(2)
    expect(financeStore.categories.find((c) => c.key === 'd1')?.amount).toBe(250_000)

    // Шаг 3: Кредит
    financeStore.addCredit({
      name: 'Автокредит',
      note: 'ежемесячный платёж',
      principal: 1_500_000,
      annualRate: 0.18,
      payment: 85_000,
      day: 12,
    })
    financeStore.setCategoryAmount('d2', 85_000)

    expect(financeStore.credits).toHaveLength(1)
    expect(financeStore.credits[0].payment).toBe(85_000)

    // Шаг 4: Первая цель
    financeStore.addGoal({
      name: 'Ремонт',
      need: 1_200_000,
      have: 200_000,
      monthly: 100_000,
      hue: 'green',
    })
    financeStore.setCategoryAmount('d3', 100_000)

    expect(financeStore.goals).toHaveLength(1)
    expect(financeStore.goals[0].name).toBe('Ремонт')

    // Шаг 5: Завершение настройки
    financeStore.finishSetup()
    expect(financeStore.setupDone).toBe(true)
    expect(hasBudgetData(financeStore.householdDoc)).toBe(true)
  })

  it('сценарий присоединения второго партнёра (joinHousehold) и сохранения его дохода', async () => {
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    vi.spyOn(apiClient, 'joinHousehold').mockResolvedValue({
      token: 'jwt-partner-2',
      member: {
        household_id: 'h-1',
        user_id: 'u-2',
        slot: 'b',
        display_name: 'Аруна',
        role: 'member',
        joined_at: '',
      },
    })

    vi.spyOn(apiClient, 'me').mockResolvedValue({
      user: { id: 'u-2', email: 'aruna@example.com', created_at: '' },
      household: { id: 'h-1', name: 'Семья Ильяса и Аруны', created_by: 'u-1', created_at: '' },
      member: {
        household_id: 'h-1',
        user_id: 'u-2',
        slot: 'b',
        display_name: 'Аруна',
        role: 'member',
        joined_at: '',
      },
    })

    await authStore.joinHousehold({ code: 'CODE1234', display_name: 'Аруна' })

    expect(authStore.isAuthenticated).toBe(true)
    expect(authStore.slot).toBe('b')

    // Второй партнёр сохраняет свой доход
    financeStore.setPerson('b', {
      name: 'Аруна',
      salary: 500_000,
      payday: 20,
      onboardedAt: new Date().toISOString(),
    })

    expect(financeStore.people.find((p) => p.id === 'b')?.salary).toBe(500_000)
    expect(financeStore.people.find((p) => p.id === 'b')?.name).toBe('Аруна')
  })

  it('компонентный рендер Access.vue: проверка разметки табов, полей и демо-кнопки', async () => {
    const { createSSRApp } = await import('vue')
    const { renderToString } = await import('vue/server-renderer')
    const { createMemoryHistory } = await import('vue-router')
    const { createAppRouter } = await import('@/router')
    const { default: Access } = await import('./Access.vue')

    const router = createAppRouter(createMemoryHistory())
    const app = createSSRApp(Access)
    app.use(router)

    const html = await renderToString(app)
    expect(html).toContain('Family Finance')
    expect(html).toContain('Реально.')
    expect(html).toContain('data-testid="google-button"')
    expect(html).toContain('Назад к описанию')
    // Dev-сборка (vitest): вход по почте для стенда — свёрнутым блоком; «По коду» — на /who.
    expect(html).toContain('Вход по почте (стенд)')
    expect(html).not.toContain('По коду')
  })

  describe('PV-20: ошибка сервера — русским текстом на экране', () => {
    /** Экран в SSR и его setupState: SSR не нажимает, поэтому действие зовём сами и рендерим итог. */
    async function screen(view: Component, path: string, action: string, state: Record<string, unknown>) {
      let vm: Record<string, any> = {}
      // Смесь глобальная — берём состояние только компонента с нужным действием, не кнопки внутри.
      const grab = { created(this: any) { if (action in this.$.setupState) vm = this.$.setupState } }
      await renderScreen(view, path, undefined, [screenMixin(state), grab])
      return { vm, render: (more: Record<string, unknown>) => renderScreen(view, path, undefined, [screenMixin({ ...state, ...more })]) }
    }

    it('Access: неверный пароль, короткий пароль — тексты из таблицы, не английский', async () => {
      const { default: Access } = await import('./Access.vue')
      vi.spyOn(apiClient, 'login').mockRejectedValue(new ApiError('invalid email or password', 401))
      vi.spyOn(apiClient, 'register').mockRejectedValue(new ApiError('password must be at least 6 characters long', 400))
      vi.spyOn(apiClient, 'joinHousehold').mockRejectedValue(new ApiError('unauthorized', 401))
      const cases = [
        [{ mode: 'login', email: 'a@b.kz', pass: 'wrong1' }, 'Почта или пароль не подходят.'],
        [{ mode: 'register', email: 'a@b.kz', pass: '123', displayName: 'Ильяс' }, 'Пароль слишком короткий: нужно хотя бы 6 символов.'],
      ] as const
      for (const [state, text] of cases) {
        const { vm, render } = await screen(Access, '/access', 'submit', state)
        await vm.submit()
        expect(vm.errorMessage).toBe(text)
        const html = await render({ errorMessage: vm.errorMessage })
        expect(html).toContain(text)
        expect(html).not.toMatch(/invalid email|password must|unauthorized/i)
      }
    })

    it('Start, шаг приглашения (B2C-19): ошибка создания кода — текстом под кнопкой', async () => {
      const { default: Start } = await import('./Start.vue')
      vi.spyOn(apiClient, 'createInvite').mockRejectedValue(new ApiError('HTTP error 500 Internal Server Error', 500))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { vm, render } = await screen(Start, '/start/invite', 'handleMakeInvite', {})
      expect(vm.step).toBe('invite')
      await vm.handleMakeInvite()
      const html = await render({ inviteError: vm.inviteError })
      expect(html).toContain('Не получилось связаться с сервером. Попробуйте ещё раз.')
      expect(html).toContain('Создать код')
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
  })
})
