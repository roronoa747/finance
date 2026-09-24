import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, ApiError } from '@/api/client'
import type { User, Household, HouseholdMember } from '@/types/api'

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

  const isAuthenticated = computed(() => Boolean(token.value && user.value))
  const isDemo = computed(() => token.value === DEMO_TOKEN)
  const isMember = computed(() => member.value?.role === 'member')
  const isViewer = computed(() => member.value?.role === 'viewer')
  const slot = computed(() => member.value?.slot)

  function setAuthData(data: {
    token: string
    user: User
    household: Household
    member: HouseholdMember
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

    removeItem('ff_auth_token')
    removeItem('ff_user')
    removeItem('ff_household')
    removeItem('ff_member')
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

  function logout() {
    clearAuth()
  }

  return {
    token,
    user,
    household,
    member,
    loading,
    error,
    isAuthenticated,
    isDemo,
    isMember,
    isViewer,
    slot,
    register,
    login,
    fetchMe,
    logout,
    createInvite,
    joinHousehold,
    setAuthData,
    clearAuth,
  }
})
