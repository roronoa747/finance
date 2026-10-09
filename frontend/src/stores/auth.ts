import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, ApiError } from '@/api/client'
import type { User, Household, HouseholdMember, MemberView } from '@/types/api'
import { releasePhotos } from '@/lib/photos/store'
import { useFinanceStore } from './finance'
import { useEventsStore } from './events'

function getItem(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
}
function setItem(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, val)
}
function removeItem(key: string): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key)
}

/** Токен демо-режима (Access.vue): сервера за ним нет, синхронизировать нечего. */
export const DEMO_TOKEN = 'demo-token'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(getItem('ff_auth_token'))
  const user = ref<User | null>(
    getItem('ff_user') ? JSON.parse(getItem('ff_user')!) : null,
  )
  const household = ref<Household | null>(
    getItem('ff_household') ? JSON.parse(getItem('ff_household')!) : null,
  )
  const member = ref<HouseholdMember | null>(
    getItem('ff_member') ? JSON.parse(getItem('ff_member')!) : null,
  )
  const loading = ref<boolean>(false)
  const error = ref<string | null>(null)
  /** Участники семьи с ролями — с сервера (B2C-23): «Семья» в настройках и шторка синка. */
  const members = ref<MemberView[]>([])
  /** Почта владельца из `ADMIN_EMAILS` (B2C-28) — `/auth/me`. */
  const admin = ref(false)

  const isAuthenticated = computed(() => Boolean(token.value && user.value))
  /** Вошёл, но «с кем» ещё не пройдено (Р-13): без семьи — только `/who` и настройки. */
  const hasHousehold = computed(() => Boolean(household.value))
  const isDemo = computed(() => token.value === DEMO_TOKEN)
  const isMember = computed(() => member.value?.role === 'member')
  const isViewer = computed(() => member.value?.role === 'viewer')
  const slot = computed(() => member.value?.slot)

  function setAuthData(data: {
    token: string
    user: User
    household: Household | null
    member: HouseholdMember | null
  }) {
    token.value = data.token
    user.value = data.user
    household.value = data.household
    member.value = data.member

    setItem('ff_auth_token', data.token)
    setItem('ff_user', JSON.stringify(data.user))
    setItem('ff_household', JSON.stringify(data.household))
    setItem('ff_member', JSON.stringify(data.member))
  }

  function clearAuth() {
    token.value = null
    user.value = null
    household.value = null
    member.value = null
    error.value = null
    members.value = []
    admin.value = false

    removeItem('ff_auth_token')
    removeItem('ff_user')
    removeItem('ff_household')
    removeItem('ff_member')
    // Object URL фото семьи — не для следующего входа (B2C-17).
    releasePhotos()
    useEventsStore().reset()
  }

  async function register(data: {
    email: string
    password: string
    display_name: string
    household_name: string
  }) {
    loading.value = true
    error.value = null
    try {
      const res = await apiClient.register(data)
      setAuthData(res)
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    } finally {
      loading.value = false
    }
  }

  async function login(data: { email: string; password: string }) {
    loading.value = true
    error.value = null
    try {
      const res = await apiClient.login(data)
      setAuthData(res)
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchMe() {
    if (!token.value) return null
    loading.value = true
    error.value = null
    try {
      const res = await apiClient.me()
      user.value = res.user
      household.value = res.household
      member.value = res.member
      admin.value = res.admin === true

      setItem('ff_user', JSON.stringify(res.user))
      setItem('ff_household', JSON.stringify(res.household))
      setItem('ff_member', JSON.stringify(res.member))
      return res
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearAuth()
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createInvite() {
    loading.value = true
    error.value = null
    try {
      return await apiClient.createInvite()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    } finally {
      loading.value = false
    }
  }

  async function joinHousehold(data: { code: string; display_name: string }) {
    loading.value = true
    error.value = null
    try {
      const res = await apiClient.joinHousehold(data)
      token.value = res.token
      member.value = res.member
      setItem('ff_auth_token', res.token)
      setItem('ff_member', JSON.stringify(res.member))
      // Refresh me to get full household and user profile
      await fetchMe()
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Вход через Google (B2C-25): ID-токен из GIS → свой токен; семья может быть null → «с кем». */
  async function googleLogin(idToken: string) {
    loading.value = true
    error.value = null
    try {
      const res = await apiClient.googleLogin(idToken)
      setAuthData(res)
      return res
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /** «С кем» → «Я один» / «Создать семью» (B2C-23): своя семья, токен уже с ней. */
  async function createHousehold(data: { name?: string; display_name: string }) {
    loading.value = true
    error.value = null
    try {
      const res = await apiClient.createHousehold(data)
      setAuthData(res)
      return res
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      loading.value = false
    }
  }

  /** Участники семьи с ролями; сбой — прежний список (экран покажет людей документа). */
  async function fetchMembers() {
    if (!token.value || isDemo.value || !household.value) return members.value
    try {
      members.value = (await apiClient.householdMembers()).members
    } catch {
      // Нет сети — участники из документа; 401 уже увёл на вход.
    }
    return members.value
  }

  /**
   * Вход больше не действует (401: истёк, аккаунт удалён на другом телефоне). Документ телефона
   * не стирается: вход в ту же семью сольёт неотправленное, в другую — `claimFor` его сотрёт.
   */
  function expire() {
    if (!token.value || isDemo.value) return false
    clearAuth()
    return true
  }

  /**
   * Удаление аккаунта (B2C-24): сервер стирает данные, телефон — всё своё (документы, операции,
   * фото); остаются тема и вид экранов — в них нет данных семьи.
   */
  async function deleteAccount() {
    await apiClient.deleteAccount()
    useFinanceStore().clearLocal()
    clearAuth()
  }

  /**
   * Выход. Документы семьи на телефоне стираются, чтобы следующий вход не смешал
   * семьи. Если сервер видел не всё, без явного выбора ничего не делает и
   * возвращает false — экран сначала спрашивает человека:
   *  'discard' — выйти, неотправленное пропадёт;
   *  'keep' — выйти, документ с неотправленным остаётся до входа в ту же семью
   *           (вход истёк, отправить нельзя; вход в другую семью его сотрёт).
   */
  function logout(choice?: 'keep' | 'discard'): boolean {
    const finance = useFinanceStore()
    // Черновик демо (вход Google до ответа «взять демо?») отправить нельзя — не спрашиваем.
    if (finance.hasUnsent && !finance.isDemo && !choice) return false
    if (choice !== 'keep') finance.clearLocal()
    clearAuth()
    return true
  }

  return {
    token,
    user,
    household,
    member,
    loading,
    error,
    members,
    admin,
    isAuthenticated,
    hasHousehold,
    isDemo,
    isMember,
    isViewer,
    slot,
    register,
    login,
    fetchMe,
    googleLogin,
    createHousehold,
    fetchMembers,
    expire,
    deleteAccount,
    logout,
    createInvite,
    joinHousehold,
    setAuthData,
    clearAuth,
  }
})
