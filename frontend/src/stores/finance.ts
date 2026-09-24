import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { mergeDocs, isEmptyDoc } from '@/lib/merge'
import { monthKey } from '@/lib/dates'
import type { SyncDoc, SyncStatus, Person, PersonId } from '@/types/finance'
import type { CategoryKey, HueKey } from '@/lib/palette'
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

  async function pullHousehold(client: ApiClient = apiClient): Promise<HouseholdDocResponse | null> {
    try {
      const serverDoc = await client.getHouseholdDoc()
      if (serverDoc && serverDoc.data) {
        if (status.value === 'dirty') {
          householdDoc.value = mergeDocs(householdDoc.value, serverDoc.data)
        } else {
          householdDoc.value = serverDoc.data
          householdRev.value = serverDoc.rev
          status.value = 'idle'
        }
        saveLocalState()
      }
      return serverDoc
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      return null
    }
  }

  async function pullPrivateDoc(client: ApiClient = apiClient) {
    try {
      const res = await client.getPrivateDoc()
      if (res) {
        privateDoc.value = res.data ?? {}
        privateRev.value = res.rev
        saveLocalState()
      }
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      return null
    }
  }

  async function pushPrivateDoc(data: Record<string, unknown>, client: ApiClient = apiClient) {
    try {
      const res = await client.pushPrivateDoc(privateRev.value, data)
      privateDoc.value = res.data ?? data
      privateRev.value = res.rev
      saveLocalState()
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      throw err
    }
  }

  function scheduleSync(delay = 1500, client: ApiClient = apiClient) {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      void syncHousehold(client)
    }, delay)
  }

  

  function setPerson(id: PersonId, patch: Partial<Person>) {
    mutateHouseholdDoc((doc) => {
      let p = doc.people.find((x) => x.id === id);
      if (!p) {
        p = {
          id,
          name: patch.name || 'Участник',
          salary: patch.salary ?? 0,
          payday: patch.payday ?? 10,
          updatedAt: new Date().toISOString(),
          ...patch,
        };
        doc.people.push(p);
      } else {
        Object.assign(p, patch, { updatedAt: new Date().toISOString() });
      }
    });
  }

  function addObligation(o: {
    name: string;
    note?: string;
    day: number;
    category: CategoryKey;
    amount: number;
    estimate?: boolean;
    every?: 'month' | 'year';
    month?: number;
    who?: PersonId | null;
  }) {
    const id = Math.random().toString(36).slice(2, 10);
    const t = new Date().toISOString();
    mutateHouseholdDoc((doc) => {
      doc.obligations.push({
        id,
        name: o.name,
        note: o.note || '',
        day: o.day,
        category: o.category,
        estimate: o.estimate,
        every: o.every,
        month: o.month,
        who: o.who,
        versions: [{ from: '2000-01', amount: o.amount }],
        updatedAt: t,
      });
    });
  }

  function addCredit(c: {
    name: string;
    note?: string;
    principal: number;
    annualRate: number;
    payment: number;
    day: number;
  }) {
    const id = Math.random().toString(36).slice(2, 10);
    const t = new Date().toISOString();
    mutateHouseholdDoc((doc) => {
      doc.credits.push({
        id,
        name: c.name,
        note: c.note || '',
        principal: c.principal,
        annualRate: c.annualRate,
        payment: c.payment,
        day: c.day,
        updatedAt: t,
      });
    });
  }

  function addGoal(g: {
    name: string;
    need: number;
    have?: number;
    monthly: number;
    hue: HueKey;
  }) {
    const id = Math.random().toString(36).slice(2, 10);
    const t = new Date().toISOString();
    const have = g.have ?? 0;
    mutateHouseholdDoc((doc) => {
      doc.goals.push({
        id,
        name: g.name,
        need: g.need,
        seed: have,
        have,
        monthly: g.monthly,
        hue: g.hue,
        planPct: g.need > 0 ? Math.min(1, have / g.need) : 0,
        movements: [],
        updatedAt: t,
      });
    });
  }

  function setCategoryAmount(key: CategoryKey, amount: number) {
    const t = new Date().toISOString();
    mutateHouseholdDoc((doc) => {
      let cat = doc.categories.find((c) => c.key === key);
      if (cat) {
        cat.amount = amount;
        cat.updatedAt = t;
      } else {
        doc.categories.push({
          key,
          name: key === 'd1' ? 'Жильё' : key === 'd2' ? 'Кредиты' : key === 'd3' ? 'Цели' : key === 'd4' ? 'Еда и быт' : 'Свободно',
          note: '',
          amount,
          updatedAt: t,
        });
      }
    });
  }

  function finishSetup() {
    mutateHouseholdDoc((doc) => {
      doc.setupDoneAt = new Date().toISOString();
    });
  }

  function adoptMembers(members: { slot: PersonId; displayName?: string; display_name?: string }[]) {
    const t = new Date().toISOString();
    mutateHouseholdDoc((doc) => {
      for (const m of members) {
        const existing = doc.people.find((p) => p.id === m.slot);
        if (!existing) {
          doc.people.push({
            id: m.slot,
            name: m.displayName || m.display_name || 'Участник',
            salary: 0,
            payday: 10,
            updatedAt: t,
          });
        }
      }
    });
  }

  function amendSalary(id: PersonId, from: string, amount: number, reason?: string) {
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      const p = doc.people.find((x) => x.id === id)
      if (!p) return
      const base = p.salaryVersions?.length
        ? p.salaryVersions
        : [{ from: '2000-01', amount: p.salary }]
      const versions = [...base.filter((v) => v.from !== from), { from, amount, reason }]
        .sort((a, b) => a.from.localeCompare(b.from))
      p.salaryVersions = versions
      p.updatedAt = t
    })
  }

  function correctSalary(id: PersonId, amount: number) {
    const t = new Date().toISOString()
    const key = monthKey()
    mutateHouseholdDoc((doc) => {
      const p = doc.people.find((x) => x.id === id)
      if (!p) return
      const cur = (p.salaryVersions ?? []).filter((v) => v.from <= key).pop()
      p.salary = amount
      if (cur && p.salaryVersions) {
        p.salaryVersions = p.salaryVersions.map((v) => (v.from === cur.from ? { ...v, amount } : v))
      }
      p.updatedAt = t
    })
  }

  function setGoalMonthly(id: string, monthly: number) {
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      const g = doc.goals.find((x) => x.id === id)
      if (g) {
        g.monthly = monthly
        g.updatedAt = t
      }
    })
  }

  function resetAll() {
    resetDoc();
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
    pullHousehold,
    pullPrivateDoc,
    pushPrivateDoc,
    scheduleSync,
    setPerson,
    correctSalary,
    amendSalary,
    setGoalMonthly,
    addObligation,
    addCredit,
    addGoal,
    setCategoryAmount,
    finishSetup,
    adoptMembers,
    resetAll,
  }
})
