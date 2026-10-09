import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Component } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from '@/stores/finance'
import { readDemoPending, writeDemoPending } from '@/lib/storage'
import { apiClient } from '@/api/client'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { AuthResponse } from '@/types/api'
import Access from './Access.vue'
import Who from './Who.vue'
import Settings from './Settings.vue'

/** B2C-25: экраны входа через Google, «с кем» и настройки с участниками и удалением (SSR). */

const T0 = '2026-10-08T00:00:00.000Z'
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ')

const dana = (household: boolean, role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' | 'c' = 'a'): AuthResponse => ({
  token: 'g-token',
  user: { id: 'u-d', email: 'dana@example.com', display_name: 'Дана', created_at: T0 },
  household: household ? { id: 'h-1', name: 'Наша казна', created_by: 'u-d', created_at: T0 } : null,
  member: household ? { household_id: 'h-1', user_id: 'u-d', slot, display_name: 'Дана', role, joined_at: T0 } : null,
})

/** Экран и его состояние: действие зовём сами (SSR не нажимает), потом рендерим итог. */
async function screen(view: Component, path: string, action: string) {
  let vm: Record<string, any> = {}
  const grab = { created(this: any) { if (action in this.$.setupState) vm = this.$.setupState } }
  await renderScreen(view, path, undefined, [grab])
  return vm
}

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

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Access (B2C-25)', () => {
  it('прод-сборка: «Реально.», кнопка Google и «Назад к описанию» — формы почты и пароля нет', async () => {
    vi.stubEnv('DEV', false)
    const html = await renderScreen(Access, '/access')
    expect(html).toContain('Реально.')
    expect(html).toContain('data-testid="google-button"')
    expect(html).toContain('Назад к описанию')
    expect(html).not.toContain('Попробовать')
    expect(html).not.toContain('type="password"')
    expect(html).not.toContain('Вход по почте')
    expect(html).not.toContain('Пароль')
    expect(html).not.toContain('По коду')
  })

  it('вход истёк (401) — строка «Вход истёк, войдите снова»; без него строки нет', async () => {
    expect(await renderScreen(Access, '/access?expired=1')).toContain('Вход истёк, войдите снова')
    expect(await renderScreen(Access, '/access')).not.toContain('Вход истёк')
  })

  it('Google без семьи → «с кем»; с семьёй → её документ с сервера и первый запуск', async () => {
    vi.spyOn(apiClient, 'googleLogin').mockResolvedValue(dana(false))
    let vm = await screen(Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id-token')
    expect(useAuthStore().hasHousehold).toBe(false)

    setActivePinia(createPinia())
    vi.spyOn(apiClient, 'googleLogin').mockResolvedValue(dana(true))
    const pull = vi.spyOn(useFinanceStore(), 'enterFamily').mockResolvedValue()
    vm = await screen(Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id-token')
    expect(pull).toHaveBeenCalledWith('h-1')
  })

  it('пока идёт вход — кнопка Google не нажимается, строка «Минуту…» (ревью frontend Б4 Н-4)', async () => {
    const idle = await renderScreen(Access, '/access')
    expect(idle).not.toContain('Минуту…')
    const html = await renderScreen(Access, '/access', undefined, [screenMixin({ busy: true })])
    expect(html).toMatch(/class="[^"]*pointer-events-none[^"]*"[^>]*data-testid="google-button"/)
    expect(html).toContain('Минуту…')
  })

  it('отказ Google — русским текстом', async () => {
    const { ApiError } = await import('@/api/client')
    vi.spyOn(apiClient, 'googleLogin').mockRejectedValue(new ApiError('invalid google token', 401))
    const vm = await screen(Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('bad')
    expect(vm.errorMessage).toBe('Google не подтвердил вход. Попробуйте ещё раз.')
  })
})

describe('Who — «С кем ведём?» (B2C-25)', () => {
  beforeEach(() => {
    useAuthStore().setAuthData(dana(false))
  })

  it('три пути: один, создать семью, по коду', async () => {
    const html = visible(await renderScreen(Who, '/who'))
    expect(html).toContain('С кем ведём?')
    expect(html).toContain('Один')
    expect(html).toContain('Создать семью')
    expect(html).toContain('По коду')
    expect(html).toContain('Выйти или удалить аккаунт')
  })

  it('«Один» — семья с именем из Google, чистый документ, первый запуск', async () => {
    const create = vi.spyOn(apiClient, 'createHousehold').mockResolvedValue(dana(true))
    const finance = useFinanceStore()
    finance.claimFor('h-old')
    finance.setPerson('a', { name: 'Старое' })
    const vm = await screen(Who, '/who', 'pick')
    await vm.create('alone')
    expect(create).toHaveBeenCalledWith({ display_name: 'Дана' })
    expect(finance.docHousehold).toBe('h-1')
    expect(finance.people).toEqual([])
    expect(useAuthStore().hasHousehold).toBe(true)
  })

  it('«Создать семью» — сразу код для партнёра и «Дальше»', async () => {
    vi.spyOn(apiClient, 'createHousehold').mockResolvedValue(dana(true))
    vi.spyOn(apiClient, 'createInvite').mockResolvedValue({ code: 'AB12CD34', expires_at: T0 })
    const vm = await screen(Who, '/who', 'pick')
    await vm.create('family')
    expect(vm.invite).toBe('AB12CD34')
    const html = visible(await renderScreen(Who, '/who'))
    expect(html).toContain('Код для партнёра')
    expect(html).toContain('AB12CD34')
    expect(html).toContain('Дальше')
  })

  it('из демо: «Создать семью» → «Взять демо?»; перезапуск до ответа; «Да» — демо в семье и код партнёру (критик Блока 4)', async () => {
    vi.spyOn(apiClient, 'createHousehold').mockResolvedValue(dana(true))
    vi.spyOn(apiClient, 'createInvite').mockResolvedValue({ code: 'AB12CD34', expires_at: T0 })
    useFinanceStore().claimFor(DEMO_HOUSEHOLD)
    writeDemoPending(true)
    let vm = await screen(Who, '/who', 'pick')
    await vm.create('family')
    expect(apiClient.createInvite).not.toHaveBeenCalled()
    expect(useFinanceStore().isDemo).toBe(true)
    expect(visible(await renderScreen(Who, '/who'))).toContain('Взять демо?')

    // Приложение закрыли и открыли: вход и черновик — с телефона, выбор «Создать семью» не потерян.
    setActivePinia(createPinia())
    expect(readDemoPending()).toBe(true)
    const adopt = vi.spyOn(useFinanceStore(), 'adoptDemo').mockResolvedValue()
    vm = await screen(Who, '/who', 'answerDemo')
    await vm.answerDemo(true)
    // «Создать семью» — демо-«Партнёр» не переносится (Р-124 п. 2).
    expect(adopt).toHaveBeenCalledWith('h-1', 'Дана', undefined, true)
    expect(readDemoPending()).toBe(false)
    expect(apiClient.createInvite).toHaveBeenCalledTimes(1)
    expect(vm.invite).toBe('AB12CD34')
  })

  it('из демо: «Нет» — чистый лист новой семьи, вопрос снят', async () => {
    vi.spyOn(apiClient, 'createHousehold').mockResolvedValue(dana(true))
    const finance = useFinanceStore()
    finance.claimFor(DEMO_HOUSEHOLD)
    finance.setPerson('a', { name: 'Демо' })
    writeDemoPending(true)
    const vm = await screen(Who, '/who', 'pick')
    await vm.create('alone')
    await vm.answerDemo(false)
    expect(finance.docHousehold).toBe('h-1')
    expect(finance.people).toEqual([])
    expect(readDemoPending()).toBe(false)
  })

  it('«По коду» — вход в семью партнёра, её документ с сервера; ошибка кода — русским текстом', async () => {
    const { ApiError } = await import('@/api/client')
    vi.spyOn(apiClient, 'joinHousehold').mockRejectedValueOnce(new ApiError('invite code not found', 404))
    const vm = await screen(Who, '/who', 'join')
    vm.pick('code')
    vm.code = 'zz99'
    await vm.join()
    expect(vm.error).toBe('Код не найден. Проверьте, нет ли опечатки.')

    vi.spyOn(apiClient, 'joinHousehold').mockResolvedValue({ token: 'joined', member: dana(true, 'member', 'b').member! })
    vi.spyOn(apiClient, 'me').mockResolvedValue({ user: dana(true).user, household: dana(true).household, member: dana(true, 'member', 'b').member })
    const enter = vi.spyOn(useFinanceStore(), 'enterFamily').mockResolvedValue()
    await vm.join()
    expect(apiClient.joinHousehold).toHaveBeenCalledWith({ code: 'ZZ99', display_name: 'Дана' })
    expect(enter).toHaveBeenCalledWith('h-1')
    expect(useAuthStore().slot).toBe('b')
  })
})

describe('Settings — участники с сервера и удаление аккаунта (B2C-25)', () => {
  function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'c' = 'a') {
    useAuthStore().setAuthData(dana(true, role, slot))
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Дана', salary: 500_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Ильяс', salary: 700_000, payday: 20, updatedAt: T0 },
    ]
    useAuthStore().members = [
      { slot: 'a', display_name: 'Дана', role: 'member', joined_at: T0 },
      { slot: 'b', display_name: 'Ильяс', role: 'member', joined_at: T0 },
      { slot: 'c', display_name: 'Гость', role: 'viewer', joined_at: T0 },
    ]
  }

  it('участники — все, с ролями: viewer виден семье; удаление — после выхода', async () => {
    family()
    const html = visible(await renderScreen(Settings, '/settings'))
    expect(html).toContain('Гость')
    expect(html).toContain('только просмотр')
    expect(html).toContain('вы · участник')
    expect(html).toContain('Удалить аккаунт и данные')
    expect(html.indexOf('Выйти из аккаунта')).toBeLessThan(html.indexOf('Удалить аккаунт и данные'))
    // Двое участников по серверу — кода приглашения нет: третий вошёл бы участником.
    expect(html).not.toContain('Пригласить партнёра')
  })

  it('viewer: себя видит «вы · только просмотр», кода приглашения нет, удалить аккаунт может', async () => {
    family('viewer', 'c')
    useFinanceStore().householdDoc.people = useFinanceStore().householdDoc.people.slice(0, 1)
    const html = visible(await renderScreen(Settings, '/settings'))
    expect(html).toContain('вы · только просмотр')
    expect(html).not.toContain('Пригласить партнёра')
    expect(html).toContain('Удалить аккаунт и данные')
  })

  it('без семьи — только выход и удаление', async () => {
    useAuthStore().setAuthData(dana(false))
    const html = visible(await renderScreen(Settings, '/settings'))
    expect(html).not.toContain('Оформление')
    expect(html).not.toContain('С кем')
    expect(html).toContain('Выйти из аккаунта')
    expect(html).toContain('Удалить аккаунт и данные')
  })

  it('удаление: подтверждение вводом слова; после — /access, всё локальное стёрто', async () => {
    family()
    const del = vi.spyOn(apiClient, 'deleteAccount').mockResolvedValue()
    const html = await renderScreen(Settings, '/settings', undefined, [screenMixin({ confirm: true })])
    expect(visible(html)).toContain('Удалить навсегда')
    // Кнопка неактивна, пока слово не введено.
    expect(html).toMatch(/placeholder="Введите «удалить»"/)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Удалить навсегда/)

    const vm = await screen(Settings, '/settings', 'deleteAccount')
    await vm.deleteAccount()
    expect(del).toHaveBeenCalledTimes(1)
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(useFinanceStore().people).toEqual([])
  })

  it('состав с сервера не пришёл, в документе двое — предупреждение «общий бюджет останется» (ревью frontend Б4 Н-3)', async () => {
    family()
    useAuthStore().members = []
    vi.spyOn(apiClient, 'householdMembers').mockRejectedValue(new TypeError('Failed to fetch'))
    const vm = await screen(Settings, '/settings', 'deleteWarning')
    expect(vm.deleteWarning).toContain('Общий бюджет останется у семьи')

    // Один в документе — уйдёт всё.
    useFinanceStore().householdDoc.people = useFinanceStore().householdDoc.people.slice(0, 1)
    const alone = await screen(Settings, '/settings', 'deleteWarning')
    expect(alone.deleteWarning).toContain('бюджет, мечты, операции и фото')
  })

  it('без сети — текст под кнопкой, ничего не стёрто', async () => {
    family()
    vi.spyOn(apiClient, 'deleteAccount').mockRejectedValue(new TypeError('Failed to fetch'))
    const vm = await screen(Settings, '/settings', 'deleteAccount')
    await vm.deleteAccount()
    expect(vm.deleteError).toBe('Не получилось удалить. Проверьте сеть и попробуйте ещё раз.')
    expect(useAuthStore().isAuthenticated).toBe(true)
  })
})
