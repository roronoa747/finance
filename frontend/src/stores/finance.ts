import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { mergeDocs, isEmptyDoc } from '@/lib/merge'
import { monthKey } from '@/lib/dates'
import type { SyncDoc, SyncStatus, Person, PersonId, Account, Credit, Goal, Obligation } from '@/types/finance'
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

// Правка, которая ничего не меняет, не пишется: свежий updatedAt без изменения
// выиграл бы слияние по времени у настоящей правки с другого устройства.
function unchanged<T extends object>(cur: T | undefined, patch: Partial<T>): boolean {
  return !!cur && (Object.keys(patch) as (keyof T)[]).every((k) => cur[k] === patch[k])
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
  // Растёт с каждой локальной правкой: ответ сервера, запрошенный до неё, её не затирает.
  let localEdits = 0
  // Растёт с каждым запуском синка: фоновый pull не откатывает его результат.
  let syncRuns = 0

  // Getters
  const people = computed(() => householdDoc.value.people || [])
  const categories = computed(() => householdDoc.value.categories || [])
  const goals = computed(() => householdDoc.value.goals || [])
  const obligations = computed(() => householdDoc.value.obligations || [])
  const householdAccounts = computed(() => householdDoc.value.accounts || [])
  const privateAccounts = computed(() => ((privateDoc.value.accounts as Account[]) || []))
  const accounts = computed(() => [...householdAccounts.value, ...privateAccounts.value])
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
      localEdits++
      status.value = 'dirty'
      scheduleSync()
    }
    saveLocalState()
  }

  function mutateHouseholdDoc(mutator: (doc: SyncDoc) => void) {
    localEdits++
    mutator(householdDoc.value)
    status.value = 'dirty'
    saveLocalState()
    scheduleSync()
  }

  function resetDoc() {
    localEdits++
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
    syncRuns++
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
          const editsBeforePush = localEdits
          const pushRes = await client.pushHouseholdDoc(currentRev, merged)
          if (localEdits !== editsBeforePush) {
            // Правка пришла, пока запрос был в пути: сервер её не видел. Документ
            // оставляем локальным, ревизию берём новую — правка уйдёт следующим кругом.
            householdRev.value = pushRes.rev
            status.value = 'dirty'
            forceReplace.value = false
            saveLocalState()
            scheduleSync(undefined, client)
            return
          }
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
    const editsBefore = localEdits
    const runsBefore = syncRuns
    try {
      const serverDoc = await client.getHouseholdDoc()
      if (serverDoc && serverDoc.data) {
        // Синк шёл или прошёл, пока ждали ответ: его результат новее этого ответа.
        if (isSyncing || syncRuns !== runsBefore) return serverDoc
        if (status.value === 'dirty' || localEdits !== editsBefore) {
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
      // Иначе фоновый pull с истёкшим входом молча показывал бы «синхронизировано»;
      // 'error' заставит следующий круг движка пройти полный синк и показать причину.
      if (status.value === 'idle') status.value = 'error'
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
    if (unchanged(people.value.find((x) => x.id === id), patch)) return
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
    if (unchanged(categories.value.find((c) => c.key === key), { amount })) return
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
    const p0 = people.value.find((x) => x.id === id)
    const cur0 = (p0?.salaryVersions ?? []).filter((v) => v.from <= key).pop()
    if (!p0 || (p0.salary === amount && (!cur0 || cur0.amount === amount))) return
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

  function mutatePrivateDoc(mutator: (data: Record<string, unknown>) => void) {
    mutator(privateDoc.value)
    saveLocalState()
    void pushPrivateDoc(privateDoc.value).catch(() => {})
  }

  function addAccount(
    a: {
      name: string
      note?: string
      amount: number
      kind: 'card' | 'cash' | 'deposit' | 'envelope'
      currency?: 'KZT' | 'USD' | 'EUR' | 'RUB'
      foreignAmount?: number
      rate?: number
      rateAt?: string
      deposit?: {
        annualRate: number
        months: number
        monthlyTopUp: number
        capitalize: boolean
      }
    },
    isPrivate = false,
  ) {
    const id = Math.random().toString(36).slice(2, 10)
    const t = new Date().toISOString()
    const newAccount: Account = {
      id,
      name: a.name,
      note: a.note || '',
      amount: a.amount,
      kind: a.kind,
      currency: a.currency,
      foreignAmount: a.foreignAmount,
      rate: a.rate,
      rateAt: a.rateAt,
      deposit: a.deposit,
      updatedAt: t,
    }

    if (isPrivate) {
      mutatePrivateDoc((doc) => {
        const list = (doc.accounts as Account[]) || []
        doc.accounts = [...list, newAccount]
      })
    } else {
      mutateHouseholdDoc((doc) => {
        if (!doc.accounts) doc.accounts = []
        doc.accounts.push(newAccount)
      })
    }
  }

  function updateAccount(id: string, patch: Partial<Account>) {
    const t = new Date().toISOString()
    const isPriv = ((privateDoc.value.accounts as Account[]) || []).some((x) => x.id === id)
    if (unchanged(accounts.value.find((x) => x.id === id), patch)) return
    if (isPriv) {
      mutatePrivateDoc((doc) => {
        const list = (doc.accounts as Account[]) || []
        doc.accounts = list.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: t } : x))
      })
    } else {
      mutateHouseholdDoc((doc) => {
        const a = (doc.accounts || []).find((x) => x.id === id)
        if (a) Object.assign(a, patch, { updatedAt: t })
      })
    }
  }

  function setAccountAmount(id: string, amount: number) {
    updateAccount(id, { amount })
  }

  function setDeposit(id: string, deposit: Partial<NonNullable<Account['deposit']>>) {
    const t = new Date().toISOString()
    const isPriv = ((privateDoc.value.accounts as Account[]) || []).some((x) => x.id === id)
    if (unchanged(accounts.value.find((x) => x.id === id)?.deposit, deposit)) return
    if (isPriv) {
      mutatePrivateDoc((doc) => {
        const list = (doc.accounts as Account[]) || []
        doc.accounts = list.map((x) => {
          if (x.id !== id) return x
          return {
            ...x,
            deposit: { ...(x.deposit || { annualRate: 0, months: 12, monthlyTopUp: 0, capitalize: true }), ...deposit },
            updatedAt: t,
          }
        })
      })
    } else {
      mutateHouseholdDoc((doc) => {
        const a = (doc.accounts || []).find((x) => x.id === id)
        if (a) {
          a.deposit = {
            ...(a.deposit || { annualRate: 0, months: 12, monthlyTopUp: 0, capitalize: true }),
            ...deposit,
          }
          a.updatedAt = t
        }
      })
    }
  }

  function removeAccount(id: string) {
    const t = new Date().toISOString()
    const isPriv = ((privateDoc.value.accounts as Account[]) || []).some((x) => x.id === id)
    if (isPriv) {
      mutatePrivateDoc((doc) => {
        const list = (doc.accounts as Account[]) || []
        doc.accounts = list.map((x) => (x.id === id ? { ...x, deletedAt: t, updatedAt: t } : x))
      })
    } else {
      mutateHouseholdDoc((doc) => {
        const a = (doc.accounts || []).find((x) => x.id === id)
        if (a) {
          a.deletedAt = t
          a.updatedAt = t
        }
      })
    }
  }

  function updateCredit(id: string, patch: Partial<Credit>) {
    mutateHouseholdDoc((doc) => {
      const c = (doc.credits || []).find((x) => x.id === id)
      if (c) Object.assign(c, patch, { updatedAt: new Date().toISOString() })
    })
  }

  function removeCredit(id: string) {
    mutateHouseholdDoc((doc) => {
      const c = (doc.credits || []).find((x) => x.id === id)
      if (c) {
        c.deletedAt = new Date().toISOString()
        c.updatedAt = c.deletedAt
      }
    })
  }

  function updateObligation(id: string, patch: Partial<Obligation>) {
    mutateHouseholdDoc((doc) => {
      const o = (doc.obligations || []).find((x) => x.id === id)
      if (o) Object.assign(o, patch, { updatedAt: new Date().toISOString() })
    })
  }

  function correctObligation(id: string, amount: number) {
    const t = new Date().toISOString()
    const key = monthKey()
    const o0 = obligations.value.find((x) => x.id === id)
    if (!o0 || (o0.versions ?? []).filter((v) => v.from <= key).pop()?.amount === amount) return
    mutateHouseholdDoc((doc) => {
      const o = (doc.obligations || []).find((x) => x.id === id)
      if (!o) return
      const cur = (o.versions ?? []).filter((v) => v.from <= key).pop()
      if (cur) {
        o.versions = o.versions.map((v) => (v.from === cur.from ? { ...v, amount } : v))
      } else {
        o.versions = [{ from: '2000-01', amount }]
      }
      o.updatedAt = t
    })
  }

  function amendObligation(id: string, from: string, amount: number, reason?: string) {
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      const o = (doc.obligations || []).find((x) => x.id === id)
      if (!o) return
      const base = o.versions?.length ? o.versions : [{ from: '2000-01', amount: 0 }]
      const versions = [...base.filter((v) => v.from !== from), { from, amount, reason }]
        .sort((a, b) => a.from.localeCompare(b.from))
      o.versions = versions
      o.updatedAt = t
    })
  }

  function removeObligation(id: string) {
    mutateHouseholdDoc((doc) => {
      const o = (doc.obligations || []).find((x) => x.id === id)
      if (o) {
        o.deletedAt = new Date().toISOString()
        o.updatedAt = o.deletedAt
      }
    })
  }

  function updateGoal(id: string, patch: Partial<Goal>) {
    mutateHouseholdDoc((doc) => {
      const g = (doc.goals || []).find((x) => x.id === id)
      if (g) Object.assign(g, patch, { updatedAt: new Date().toISOString() })
    })
  }

  function removeGoal(id: string) {
    mutateHouseholdDoc((doc) => {
      const g = (doc.goals || []).find((x) => x.id === id)
      if (g) {
        g.deletedAt = new Date().toISOString()
        g.updatedAt = g.deletedAt
      }
    })
  }

  function contribute(id: string, amount: number, by: PersonId, note?: string) {
    const t = new Date().toISOString()
    const mid = Math.random().toString(36).slice(2, 10)
    mutateHouseholdDoc((doc) => {
      const g = (doc.goals || []).find((x) => x.id === id)
      if (!g) return
      if (!g.movements) g.movements = []
      g.movements.push({ id: mid, date: t, amount, by, note })
      g.have = (g.seed ?? 0) + g.movements.reduce((sum, m) => sum + m.amount, 0)
      g.updatedAt = t
    })
  }

  function withdraw(id: string, amount: number, by: PersonId, note?: string) {
    contribute(id, -Math.abs(amount), by, note)
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
    householdAccounts,
    privateAccounts,
    accounts,
    credits,
    wishlist,
    setupDone,
    saveLocalState,
    setHouseholdDoc,
    mutateHouseholdDoc,
    mutatePrivateDoc,
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
    updateObligation,
    correctObligation,
    amendObligation,
    removeObligation,
    addCredit,
    updateCredit,
    removeCredit,
    addGoal,
    updateGoal,
    removeGoal,
    contribute,
    withdraw,
    addAccount,
    updateAccount,
    setAccountAmount,
    setDeposit,
    removeAccount,
    setCategoryAmount,
    finishSetup,
    adoptMembers,
    resetAll,
  }
})
