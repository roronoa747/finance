import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { mergeDocs, isEmptyDoc } from '@/lib/merge'
import type { SyncDoc, SyncStatus } from '@/types/finance'
import type { ConflictResponse, HouseholdDocResponse } from '@/types/api'

export function defaultSyncDoc(): SyncDoc {
  return {
    people: [],
    categories: [],
    goals: [],
    wishlist: [],
    obligations: [],
    accounts: [],
    credits: [],
    setupDoneAt: null,
  }
}

const STORAGE_KEY_DOC = 'ff_household_doc'
const STORAGE_KEY_REV = 'ff_household_rev'
const STORAGE_KEY_PRIV_DOC = 'ff_private_doc'
const STORAGE_KEY_PRIV_REV = 'ff_private_rev'

function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export const useFinanceStore = defineStore('finance', () => {
  const householdDoc = ref<SyncDoc>(readStorage<SyncDoc>(STORAGE_KEY_DOC, defaultSyncDoc()))
  const householdRev = ref<number>(readStorage<number>(STORAGE_KEY_REV, 0))

  const privateDoc = ref<Record<string, unknown>>(
    readStorage<Record<string, unknown>>(STORAGE_KEY_PRIV_DOC, {}),
  )
  const privateRev = ref<number>(readStorage<number>(STORAGE_KEY_PRIV_REV, 0))

  const status = ref<SyncStatus>('idle')
  const lastSyncedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const forceReplace = ref<boolean>(false)

  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let isSyncing = false

  // Getters
  const people = computed(() => householdDoc.value.people || [])
  const categories = computed(() => householdDoc.value.categories || [])
  const goals = computed(() => householdDoc.value.goals || [])
  const obligations = computed(() => householdDoc.value.obligations || [])
  const accounts = computed(() => householdDoc.value.accounts || [])
  const credits = computed(() => householdDoc.value.credits || [])
  const wishlist = computed(() => householdDoc.value.wishlist || [])
  const setupDone = computed(() => Boolean(householdDoc.value.setupDoneAt))

  function saveLocalState() {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(STORAGE_KEY_DOC, JSON.stringify(householdDoc.value))
      localStorage.setItem(STORAGE_KEY_REV, JSON.stringify(householdRev.value))
      localStorage.setItem(STORAGE_KEY_PRIV_DOC, JSON.stringify(privateDoc.value))
      localStorage.setItem(STORAGE_KEY_PRIV_REV, JSON.stringify(privateRev.value))
    } catch (e) {
      console.error('Ошибка записи локального состояния:', e)
    }
  }

  function setHouseholdDoc(doc: SyncDoc, rev?: number) {
    householdDoc.value = doc
    if (typeof rev === 'number') {
      householdRev.value = rev
      status.value = 'idle'
    } else {
      status.value = 'dirty'
      scheduleSync()
    }
    saveLocalState()
  }

  function mutateHouseholdDoc(mutator: (doc: SyncDoc) => void) {
    mutator(householdDoc.value)
    status.value = 'dirty'
    saveLocalState()
    scheduleSync()
  }

  function resetDoc() {
    householdDoc.value = defaultSyncDoc()
    forceReplace.value = true
    status.value = 'dirty'
    saveLocalState()
    scheduleSync(100)
  }

  async function syncHousehold(client: ApiClient = apiClient): Promise<void> {
    if (isSyncing) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      status.value = 'offline'
      return
    }

    isSyncing = true
    status.value = 'syncing'
    lastError.value = null

    const MAX_ATTEMPTS = 4

    try {
      let currentServerDoc: HouseholdDocResponse
      try {
        currentServerDoc = await client.getHouseholdDoc()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        status.value = 'error'
        lastError.value = `Ошибка загрузки бюджета с сервера: ${msg}`
        return
      }

      let currentRev = currentServerDoc.rev
      let currentData = currentServerDoc.data

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const replace = forceReplace.value || isEmptyDoc(currentData)
        const merged = replace ? householdDoc.value : mergeDocs(householdDoc.value, currentData)

        householdDoc.value = merged
        saveLocalState()

        try {
          const pushRes = await client.pushHouseholdDoc(currentRev, merged)
          householdDoc.value = pushRes.data ?? merged
          householdRev.value = pushRes.rev
          status.value = 'idle'
          lastSyncedAt.value = new Date().toISOString()
          lastError.value = null
          forceReplace.value = false
          saveLocalState()
          return
        } catch (pushErr) {
          if (pushErr instanceof ApiError && pushErr.status === 409) {
            // Конфликт версий: на сервере обновлён документ
            const conflictData = pushErr.data as ConflictResponse<HouseholdDocResponse> | undefined
            const conflictServerDoc = conflictData?.server_doc
            if (conflictServerDoc && conflictServerDoc.data) {
              // Обновляем текущие серверные данные из ответа 409 и повторяем слияние
              currentRev = conflictServerDoc.rev
              currentData = conflictServerDoc.data
              continue
            }
          }
          throw pushErr
        }
      }

      // Если 4 попытки подряд закончились конфликтом
      status.value = 'conflict'
      lastError.value = 'Не удалось согласовать версии бюджета после нескольких попыток'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      status.value = 'error'
      lastError.value = msg
    } finally {
      isSyncing = false
    }
  }

  function scheduleSync(delay = 1500, client: ApiClient = apiClient) {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      void syncHousehold(client)
    }, delay)
  }

  return {
    householdDoc,
    householdRev,
    privateDoc,
    privateRev,
    status,
    lastSyncedAt,
    lastError,
    forceReplace,
    people,
    categories,
    goals,
    obligations,
    accounts,
    credits,
    wishlist,
    setupDone,
    saveLocalState,
    setHouseholdDoc,
    mutateHouseholdDoc,
    resetDoc,
    syncHousehold,
    scheduleSync,
  }
})
