import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { mergeDocs, isEmptyDoc } from '@/lib/merge'
import { monthKey } from '@/lib/dates'
import {
  accountBalance,
  activePlan as pickActivePlan,
  amountAt,
  costliestCredits,
  creditBalance,
  creditResplit,
  creditSplit,
  endedPlan,
  goalHave,
  lastAccountFor,
  lumpPlan,
  nextCreditDue,
  nextObligationDue,
  paidFor,
  pausedGoals,
  planDraft,
  planForecast,
  planLumpTakes,
  planStep,
  salaryAt,
  settlePlans,
  stepDue,
  shiftedBase,
  type LumpMode,
  type MonthlyKind,
  type PlanState,
  type PlanStep,
  type ScheduledKind,
} from '@/lib/finance'
import type {
  SyncDoc,
  SyncStatus,
  Person,
  PersonId,
  Account,
  Credit,
  DebtPlan,
  Goal,
  Obligation,
  Payment,
  WishItem,
} from '@/types/finance'
import type { MerchantRule } from '@/lib/statements/types'
import { useAuthStore } from '@/stores/auth'
import { DEFAULT_CATEGORY_NAMES, type CategoryKey, type HueKey } from '@/lib/palette'
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
    // Ключ нужен и пустым: сервер хранит ключи, которых нет в push (RP-03), и
    // «Сбросить данные» обнулит отметки на сервере, только если ключ прислан.
    payments: [],
    plans: [],
    spendCategories: [],
    spendTotals: [],
    setupDoneAt: null,
  }
}

/** Семья демо-режима: её документ не уходит на сервер (Р-32). */
export const DEMO_HOUSEHOLD = 'demo-household-1'

const STORAGE_KEY_DOC = 'ff_household_doc'
const STORAGE_KEY_REV = 'ff_household_rev'
const STORAGE_KEY_PRIV_DOC = 'ff_private_doc'
const STORAGE_KEY_PRIV_REV = 'ff_private_rev'
const STORAGE_KEY_UNSENT = 'ff_unsent'
const STORAGE_KEY_DOC_HOUSEHOLD = 'ff_doc_household'
const LOCAL_KEYS = [
  STORAGE_KEY_DOC,
  STORAGE_KEY_REV,
  STORAGE_KEY_PRIV_DOC,
  STORAGE_KEY_PRIV_REV,
  STORAGE_KEY_UNSENT,
  STORAGE_KEY_DOC_HOUSEHOLD,
]

function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

// Запрос не дошёл до сервера (fetch бросил не ApiError) — это «нет сети», а не «не
// сошлось». navigator.onLine на это не годится: после перезагрузки без сети и в сети
// без интернета он бывает true.
function unreachable(err: unknown): boolean {
  return !(err instanceof ApiError)
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

  // Есть правки, которых сервер ещё не видел. Живёт в localStorage, а не в статусе:
  // после сбоя, перезапуска или повторного входа по нему видно, что документ надо
  // слить с серверным, а не заменить им (Н-6), и что выход сотрёт несохранённое.
  const savedUnsent = readStorage<{ household?: boolean; private?: boolean }>(STORAGE_KEY_UNSENT, {})
  const unsent = ref<boolean>(Boolean(savedUnsent.household))
  const privateUnsent = ref<boolean>(Boolean(savedUnsent.private))
  const hasUnsent = computed(() => unsent.value || privateUnsent.value)
  // Семья, которой принадлежит документ на этом телефоне (см. claimFor).
  const docHousehold = ref<string | null>(readStorage<string | null>(STORAGE_KEY_DOC_HOUSEHOLD, null))
  // Демо — черновик будущей семьи: живёт только на телефоне, к серверу не ходит (Р-32).
  const isDemo = computed(() => docHousehold.value === DEMO_HOUSEHOLD)

  const status = ref<SyncStatus>(unsent.value ? 'dirty' : 'idle')
  const lastSyncedAt = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  const forceReplace = ref<boolean>(false)

  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let isSyncing = false
  // Растёт с каждой локальной правкой: ответ сервера, запрошенный до неё, её не затирает.
  let localEdits = 0
  // Растёт с каждым запуском синка: фоновый pull не откатывает его результат.
  let syncRuns = 0
  // Растёт при выходе: ответ, запрошенный до выхода, не пишет прежнюю семью в стор.
  let session = 0

  // Getters
  const people = computed(() => householdDoc.value.people || [])
  const categories = computed(() => householdDoc.value.categories || [])
  const goals = computed(() => householdDoc.value.goals || [])
  const obligations = computed(() => householdDoc.value.obligations || [])
  const payments = computed(() => householdDoc.value.payments ?? [])
  // Остатки счетов и долгов экраны получают уже выведенными из отметок (RP-06):
  // в документе лежит база последней ручной сверки. Личный счёт тоже считается по
  // отметкам общего документа — у партнёра такого id просто нет.
  const withBalance = (a: Account): Account => ({ ...a, amount: accountBalance(a, payments.value) })
  const householdAccounts = computed(() => (householdDoc.value.accounts || []).map(withBalance))
  const privateAccounts = computed(() => ((privateDoc.value.accounts as Account[]) || []).map(withBalance))
  const accounts = computed(() => [...householdAccounts.value, ...privateAccounts.value])
  // Память «продавец → раздел» — в личном документе (Р-22): переводы людям не видны партнёру.
  const merchantRules = computed(() =>
    ((privateDoc.value.merchantRules as MerchantRule[] | undefined) ?? []).filter((r) => !r.deletedAt),
  )
  const derivedCredits = (list: Credit[], pays: Payment[]) => list.map((c) => ({ ...c, principal: creditBalance(c, pays) }))
  const credits = computed(() => derivedCredits(householdDoc.value.credits || [], payments.value))
  const wishlist = computed(() => householdDoc.value.wishlist || [])
  const setupDone = computed(() => Boolean(householdDoc.value.setupDoneAt))
  // Планы «Сначала долги» (PV-14): старые документы приходят без ключа.
  const plans = computed(() => householdDoc.value.plans ?? [])
  const activePlan = computed(() => pickActivePlan(plans.value))
  /** Всё, от чего считается шаг и прогноз плана: кредиты — производные. */
  const planState = (): PlanState => ({
    goals: goals.value,
    credits: credits.value,
    obligations: obligations.value,
    payments: payments.value,
  })
  /**
   * Шаг активного плана в этом месяце — одно место для экранов и `applyPlanStep`. Функция,
   * а не computed: месяц берётся из часов при каждом вызове (смена месяца при открытом
   * приложении, `vi.setSystemTime` в тестах), а экраны зовут её внутри своих computed.
   */
  const planStepNow = (): PlanStep | null =>
    activePlan.value ? planStep(activePlan.value, planState(), monthKey()) : null
  /** Цели на паузе ради плана (Р-9): выводятся из плана — одно место для экранов. */
  const pausedGoalIds = computed(
    () => new Set(activePlan.value ? pausedGoals(activePlan.value, goals.value).map((g) => g.id) : []),
  )

  function saveLocalState() {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(STORAGE_KEY_DOC, JSON.stringify(householdDoc.value))
      localStorage.setItem(STORAGE_KEY_REV, JSON.stringify(householdRev.value))
      localStorage.setItem(STORAGE_KEY_PRIV_DOC, JSON.stringify(privateDoc.value))
      localStorage.setItem(STORAGE_KEY_PRIV_REV, JSON.stringify(privateRev.value))
      localStorage.setItem(
        STORAGE_KEY_UNSENT,
        JSON.stringify({ household: unsent.value, private: privateUnsent.value }),
      )
      localStorage.setItem(STORAGE_KEY_DOC_HOUSEHOLD, JSON.stringify(docHousehold.value))
    } catch (e) {
      console.error('Ошибка записи локального состояния:', e)
    }
  }

  /**
   * Стирает документы этого телефона — выход из аккаунта. Иначе следующий вход,
   * в том числе другим человеком, слил бы прежнюю семью с новой.
   */
  function clearLocal() {
    session++
    localEdits++
    // Синк прежней семьи мог повиснуть в сети: вход в новую не должен его ждать
    // (pull при идущем синке отбрасывает ответ). Вернувшись, тот синк ничего не тронет.
    isSyncing = false
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = null
    householdDoc.value = defaultSyncDoc()
    householdRev.value = 0
    privateDoc.value = {}
    privateRev.value = 0
    unsent.value = false
    privateUnsent.value = false
    docHousehold.value = null
    status.value = 'idle'
    lastSyncedAt.value = null
    lastError.value = null
    forceReplace.value = false
    try {
      if (typeof localStorage !== 'undefined') for (const key of LOCAL_KEYS) localStorage.removeItem(key)
    } catch (e) {
      console.error('Ошибка очистки локального состояния:', e)
    }
  }

  /**
   * Документ на телефоне принадлежит одной семье. Вход в другую семью стирает его
   * вместе с неотправленным — семьи не смешиваются; вход в ту же оставляет, и
   * неотправленное уходит после входа (Н-6: вход истёк, правка не пропала).
   * Документ без хозяина (записан до RP-04) считается документом той семьи, где вошли.
   */
  function claimFor(householdId: string) {
    if (docHousehold.value && docHousehold.value !== householdId) clearLocal()
    docHousehold.value = householdId
    saveLocalState()
  }

  /** Вход в существующую семью (логин, код приглашения): её документы — с сервера. */
  async function enterFamily(householdId: string, client: ApiClient = apiClient) {
    claimFor(householdId)
    await pullHousehold(client)
    await pullPrivateDoc(client)
  }

  /** Новая семья без демо: у неё ещё ничего нет, остатки прежнего документа не переносятся. */
  function startNewFamily(householdId: string) {
    clearLocal()
    claimFor(householdId)
  }

  /**
   * «Да» после регистрации из демо (Р-32): весь демо-документ, общий и личный,
   * становится первым документом новой семьи; участник a — под именем из регистрации.
   * Сервер у новой семьи пуст, поэтому синк заливает документ как есть.
   */
  async function adoptDemo(householdId: string, name: string, client: ApiClient = apiClient) {
    docHousehold.value = householdId
    unsent.value = true
    saveLocalState()
    setPerson('a', { name })
    await syncHousehold(client)
    if (privateUnsent.value) await pullPrivateDoc(client)
  }

  function setHouseholdDoc(doc: SyncDoc, rev?: number) {
    householdDoc.value = doc
    if (typeof rev === 'number') {
      householdRev.value = rev
      unsent.value = false
      status.value = 'idle'
    } else {
      localEdits++
      unsent.value = true
      status.value = 'dirty'
      scheduleSync()
    }
    saveLocalState()
  }

  function mutateHouseholdDoc(mutator: (doc: SyncDoc) => void) {
    localEdits++
    mutator(householdDoc.value)
    unsent.value = true
    status.value = 'dirty'
    saveLocalState()
    scheduleSync()
  }

  function resetDoc() {
    localEdits++
    // Метка сброса: телефон партнёра не сольёт свой старый документ обратно (PV-21).
    householdDoc.value = { ...defaultSyncDoc(), resetAt: new Date().toISOString() }
    forceReplace.value = true
    unsent.value = true
    status.value = 'dirty'
    saveLocalState()
    scheduleSync(100)
  }

  async function syncHousehold(client: ApiClient = apiClient): Promise<void> {
    if (isSyncing || isDemo.value) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      status.value = 'offline'
      return
    }

    isSyncing = true
    syncRuns++
    // Запланированный синк не нужен: этот круг возьмёт все правки, сделанные до него,
    // а правка во время отправки запланирует следующий сама.
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = null
    status.value = 'syncing'
    lastError.value = null
    const s = session

    const MAX_ATTEMPTS = 4

    try {
      let currentServerDoc: HouseholdDocResponse
      try {
        currentServerDoc = await client.getHouseholdDoc()
        if (s !== session) return
      } catch (err) {
        if (s !== session) return
        const msg = err instanceof Error ? err.message : String(err)
        status.value = unreachable(err) ? 'offline' : 'error'
        lastError.value = `Ошибка загрузки бюджета с сервера: ${msg}`
        return
      }

      let currentRev = currentServerDoc.rev
      let currentData = currentServerDoc.data

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const replace = forceReplace.value || isEmptyDoc(currentData)
        const merged = replace ? householdDoc.value : mergeDocs(householdDoc.value, currentData)
        // После слияния планы — по правилам (два активных, долги закрыл партнёр) — прямо
        // в отправляемом документе, без лишнего круга.
        settleIn(merged)

        householdDoc.value = merged
        saveLocalState()

        try {
          const editsBeforePush = localEdits
          const pushRes = await client.pushHouseholdDoc(currentRev, merged)
          if (s !== session) return
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
          unsent.value = false
          status.value = 'idle'
          lastSyncedAt.value = new Date().toISOString()
          lastError.value = null
          forceReplace.value = false
          saveLocalState()
          return
        } catch (pushErr) {
          if (s !== session) return
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
      if (s !== session) return
      const msg = err instanceof Error ? err.message : String(err)
      status.value = unreachable(err) ? 'offline' : 'error'
      lastError.value = msg
    } finally {
      // После выхода флаг принадлежит синку новой сессии.
      if (s === session) isSyncing = false
    }
  }

  async function pullHousehold(client: ApiClient = apiClient): Promise<HouseholdDocResponse | null> {
    if (isDemo.value) return null
    // Без сети не спрашиваем: бейдж говорит «нет сети», а не «не сошлось».
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (!isSyncing) status.value = 'offline'
      return null
    }
    const editsBefore = localEdits
    const runsBefore = syncRuns
    const s = session
    try {
      const serverDoc = await client.getHouseholdDoc()
      if (s !== session) return null
      if (serverDoc && serverDoc.data) {
        // Синк шёл или прошёл, пока ждали ответ: его результат новее этого ответа.
        if (isSyncing || syncRuns !== runsBefore) return serverDoc
        // Заменить серверной копией можно, только если сервер видел всё локальное;
        // иначе — слить (Н-6: правка после сбоя и повторного входа не пропадает).
        if (unsent.value || localEdits !== editsBefore) {
          householdDoc.value = mergeDocs(householdDoc.value, serverDoc.data)
          if (unsent.value) scheduleSync(undefined, client)
        } else {
          householdDoc.value = serverDoc.data
          householdRev.value = serverDoc.rev
          status.value = 'idle'
        }
        saveLocalState()
        settlePlan()
      }
      return serverDoc
    } catch (err) {
      if (s !== session) return null
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      // Иначе фоновый pull с истёкшим входом молча показывал бы «синхронизировано»;
      // 'error' заставит следующий круг движка пройти полный синк и показать причину.
      if (unreachable(err)) {
        if (!isSyncing) status.value = 'offline'
      } else if (status.value === 'idle') status.value = 'error'
      return null
    }
  }

  async function pullPrivateDoc(client: ApiClient = apiClient) {
    if (isDemo.value) return null
    const s = session
    try {
      const res = await client.getPrivateDoc()
      if (s !== session) return null
      if (res && privateUnsent.value) {
        // Личный документ пока не сливается (RP-15): неотправленное с телефона
        // досылается поверх, а не затирается серверной копией.
        privateRev.value = res.rev
        saveLocalState()
        await pushPrivateDoc(privateDoc.value, client).catch(() => {})
      } else if (res) {
        privateDoc.value = res.data ?? {}
        privateRev.value = res.rev
        saveLocalState()
      }
      return res
    } catch (err) {
      if (s !== session) return null
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      return null
    }
  }

  async function pushPrivateDoc(data: Record<string, unknown>, client: ApiClient = apiClient) {
    const s = session
    try {
      const res = await client.pushPrivateDoc(privateRev.value, data)
      if (s !== session) return res
      privateDoc.value = res.data ?? data
      privateRev.value = res.rev
      privateUnsent.value = false
      saveLocalState()
      return res
    } catch (err) {
      if (s !== session) throw err
      const msg = err instanceof Error ? err.message : String(err)
      lastError.value = msg
      throw err
    }
  }

  function scheduleSync(delay = 1500, client: ApiClient = apiClient) {
    if (isDemo.value) return
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
        // Завести — уже решение «оставить»: только что добавленное не спрашиваем (Р-20).
        keptAt: t,
        updatedAt: t,
      });
    });
  }

  /** Группа подписок со свободным названием (Р-20): сама не платёж, суммы нет. */
  function addGroup(name: string, noAsk = false) {
    const id = Math.random().toString(36).slice(2, 10)
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      doc.obligations.push({ id, name, note: '', day: 1, category: 'd4', versions: [], group: true, noAsk, updatedAt: t })
    })
    return id
  }

  /** Положить подписку в группу или вынуть (null). */
  function moveToGroup(id: string, groupId: string | null) {
    updateObligation(id, { parentId: groupId })
  }

  /** Ответ «оставить» на вопрос о подписке — до следующего вопроса по правилам Р-20. */
  function keepSubscription(id: string) {
    updateObligation(id, { keptAt: new Date().toISOString() })
  }

  /** Удалить группу: подписки остаются, просто без группы. */
  function removeGroup(id: string) {
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      for (const o of doc.obligations || []) {
        if (o.id === id) Object.assign(o, { deletedAt: t, updatedAt: t })
        else if (o.parentId === id) Object.assign(o, { parentId: null, updatedAt: t })
      }
    })
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
        principalSetAt: t,
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
          name: DEFAULT_CATEGORY_NAMES[key],
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
    privateUnsent.value = true
    saveLocalState()
    if (!isDemo.value) void pushPrivateDoc(privateDoc.value).catch(() => {})
  }

  /**
   * Правило «продавец / получатель → раздел, внутренний, кому → что». Правило на то же
   * совпадение не множится — правится его запись (LWW по id при слиянии).
   */
  function addMerchantRule(rule: Pick<MerchantRule, 'match' | 'to'>, by: PersonId): MerchantRule {
    const t = new Date().toISOString()
    const same = (r: MerchantRule) =>
      r.match.merchant === rule.match.merchant && r.match.counterparty === rule.match.counterparty
    const existing = merchantRules.value.find(same)
    const record: MerchantRule = existing
      ? { ...existing, to: rule.to, by, updatedAt: t }
      : { id: Math.random().toString(36).slice(2, 10), match: rule.match, to: rule.to, by, updatedAt: t }
    mutatePrivateDoc((doc) => {
      const list = (doc.merchantRules as MerchantRule[] | undefined) ?? []
      doc.merchantRules = existing ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record]
    })
    return record
  }

  function removeMerchantRule(id: string) {
    const t = new Date().toISOString()
    mutatePrivateDoc((doc) => {
      const list = (doc.merchantRules as MerchantRule[] | undefined) ?? []
      doc.merchantRules = list.map((r) => (r.id === id ? { ...r, deletedAt: t, updatedAt: t } : r))
    })
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
      amountSetAt: t,
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

  /**
   * Якорь остатка при записи счёта. Остаток, введённый руками, — новая база:
   * отметки до этого момента в него уже вошли. Без правки остатка якорь пишется
   * прежним, пусть и null: иначе при слиянии победитель без ключа взял бы якорь
   * проигравшего к своей старой базе (RP-02) и потерял бы отметки между ними.
   */
  function amountAnchor(cur: Account, patch: Partial<Account>, t: string) {
    return { amountSetAt: 'amount' in patch ? t : (cur.amountSetAt ?? null) }
  }

  function updateAccount(id: string, patch: Partial<Account>) {
    const t = new Date().toISOString()
    const isPriv = ((privateDoc.value.accounts as Account[]) || []).some((x) => x.id === id)
    // Сравнение — с видимым остатком: тот же остаток не пишет ни базу, ни якорь.
    if (unchanged(accounts.value.find((x) => x.id === id), patch)) return
    if (isPriv) {
      mutatePrivateDoc((doc) => {
        const list = (doc.accounts as Account[]) || []
        doc.accounts = list.map((x) =>
          x.id === id ? { ...x, ...patch, ...amountAnchor(x, patch, t), updatedAt: t } : x,
        )
      })
    } else {
      mutateHouseholdDoc((doc) => {
        const a = (doc.accounts || []).find((x) => x.id === id)
        if (a) Object.assign(a, patch, amountAnchor(a, patch, t), { updatedAt: t })
      })
    }
  }

  /** Ручной ввод остатка — сверка с банком: новая база и якорь (`amountAnchor`). */
  function setAccountAmount(id: string, amount: number) {
    updateAccount(id, { amount })
  }

  /**
   * Сдвинуть остаток на сумму — взнос в цель со счёта, снятие с цели, внеплановый
   * доход. Это не сверка: база сдвигается на ту же дельту, якорь прежний
   * (finance.ts `shiftedBase`). С якорем «сейчас» отметки до этого момента перестали
   * бы двигать остаток: снятая по ошибке не вернула бы деньги, офлайн-отметка
   * партнёра после слияния не списалась бы.
   */
  function shiftAccountAmount(id: string, delta: number) {
    const t = new Date().toISOString()
    const shift = (x: Account) => ({
      amount: shiftedBase(x, payments.value, delta),
      ...amountAnchor(x, {}, t),
      updatedAt: t,
    })
    const priv = ((privateDoc.value.accounts as Account[]) || []).find((x) => x.id === id)
    const raw = priv ?? (householdDoc.value.accounts || []).find((x) => x.id === id)
    if (!raw || shiftedBase(raw, payments.value, delta) === raw.amount) return
    if (priv) {
      mutatePrivateDoc((doc) => {
        doc.accounts = ((doc.accounts as Account[]) || []).map((x) => (x.id === id ? { ...x, ...shift(x) } : x))
      })
    } else {
      mutateHouseholdDoc((doc) => {
        const a = (doc.accounts || []).find((x) => x.id === id)
        if (a) Object.assign(a, shift(a))
      })
    }
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
            ...amountAnchor(x, {}, t),
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
          Object.assign(a, amountAnchor(a, {}, t))
          a.updatedAt = t
        }
      })
    }
  }

  /**
   * Удалить счёт. Цели, чьи накопления лежали на нём, отвязываются (React
   * `removeAccount`): иначе `goalSavings` их больше не считает, а счёта, где они
   * лежали, в капитале уже нет — накопления пропали бы. Цели живут в общем
   * документе, поэтому отвязка — там, и для личного счёта тоже.
   */
  function removeAccount(id: string) {
    const t = new Date().toISOString()
    const isPriv = ((privateDoc.value.accounts as Account[]) || []).some((x) => x.id === id)
    if (isPriv) {
      mutatePrivateDoc((doc) => {
        const list = (doc.accounts as Account[]) || []
        doc.accounts = list.map((x) => (x.id === id ? { ...x, deletedAt: t, updatedAt: t } : x))
      })
    }
    if (!isPriv || goals.value.some((g) => g.accountId === id)) {
      mutateHouseholdDoc((doc) => {
        const a = isPriv ? undefined : (doc.accounts || []).find((x) => x.id === id)
        if (a) Object.assign(a, { deletedAt: t, updatedAt: t })
        for (const g of doc.goals || []) {
          if (g.accountId === id) Object.assign(g, { accountId: null, updatedAt: t })
        }
      })
    }
  }

  function updateCredit(id: string, patch: Partial<Credit>) {
    // Сравнение — с видимым остатком, как у счёта: тот же остаток не пишет ни базу, ни якорь.
    if (unchanged(credits.value.find((x) => x.id === id), patch)) return
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      const c = (doc.credits || []).find((x) => x.id === id)
      // Якорь — как у счёта (amountAnchor): введённый остаток долга — новая база.
      if (c) {
        Object.assign(c, patch, {
          principalSetAt: 'principal' in patch ? t : (c.principalSetAt ?? null),
          updatedAt: t,
        })
      }
    })
    settlePlan()
  }

  /**
   * «Оплатил» (Р-3, Р-5, Р-7): запись об оплате платежа цели за месяц. По
   * умолчанию — ближайший неоплаченный месяц, сумма по графику и счёт прошлой
   * оплаты этой цели (оплат не было — «не списывать»: деньги без выбора счёта не
   * двигаются); всё это можно передать явно. Тело кредита считает finance.ts от
   * остатка на сейчас — в записи снимок. Отмеченный месяц второй записи не получает.
   * Возвращает запись, по которой месяц оплачен, или null, если платить нечего.
   */
  function markPaid(
    kind: ScheduledKind,
    targetId: string,
    by: PersonId,
    opts: { period?: string; amount?: number; accountId?: string | null } = {},
  ): Payment | null {
    let period: string | undefined
    let amount: number
    let principal: number | undefined
    if (kind === 'obligation') {
      // Группа подписок — не платёж (RP-09).
      const o = obligations.value.find((x) => x.id === targetId && !x.deletedAt && !x.group)
      if (!o) return null
      period = opts.period ?? nextObligationDue(o, payments.value)?.period
      if (!period) return null
      amount = opts.amount ?? amountAt(o, period)
    } else {
      const c = credits.value.find((x) => x.id === targetId && !x.deletedAt)
      if (!c) return null
      period = opts.period ?? nextCreditDue(c, payments.value)?.period
      if (!period) return null
      const split = creditSplit(c.principal, c.annualRate, opts.amount ?? c.payment)
      amount = split.amount
      principal = split.body
    }
    const existing = paidFor(payments.value, kind, targetId, period)
    if (existing) return existing

    const record = newPayment(
      { kind, targetId, period, amount, ...(principal === undefined ? {} : { principal }), by },
      opts.accountId,
    )
    mutateHouseholdDoc((doc) => {
      if (!doc.payments) doc.payments = []
      doc.payments.push(record)
    })
    settlePlan()
    return record
  }

  /**
   * «Пришла зарплата» (Р-18): запись-зачисление того же списка, что «Оплатил» (Р-7) —
   * цель — участник, период — месяц её дня (по умолчанию — этот), сумма по умолчанию —
   * оклад месяца (премия — правкой), счёт — тот, куда она пришла в прошлый раз (Р-5).
   * Остаток счёта растёт из записи (finance.ts `accountBalance`). Отмеченный месяц
   * второй записи не получает. Возвращает запись или null, если участника нет.
   */
  function markSalary(
    personId: PersonId,
    opts: { period?: string; amount?: number; accountId?: string | null } = {},
  ): Payment | null {
    const p = people.value.find((x) => x.id === personId && !x.deletedAt)
    if (!p) return null
    const period = opts.period ?? monthKey()
    const existing = paidFor(payments.value, 'salary', personId, period)
    if (existing) return existing
    const record = newPayment(
      { kind: 'salary', targetId: personId, period, amount: opts.amount ?? salaryAt(p, period), by: personId },
      opts.accountId,
    )
    mutateHouseholdDoc((doc) => {
      if (!doc.payments) doc.payments = []
      doc.payments.push(record)
    })
    return record
  }

  /**
   * Новая запись отметки: id, момент и счёт. Счёт по умолчанию — прошлой оплаты
   * этой цели (Р-5); оплат не было — «не списывать»: без выбора деньги не двигаются.
   * `at` — когда оплатили: по умолчанию сейчас, у правки — момент исправляемой.
   */
  function newPayment(
    fields: Omit<Payment, 'id' | 'accountId' | 'at' | 'updatedAt'>,
    accountId: string | null | undefined,
    at?: string,
  ): Payment {
    const t = new Date().toISOString()
    return {
      id: Math.random().toString(36).slice(2, 10),
      ...fields,
      accountId:
        accountId !== undefined ? accountId : (lastAccountFor(payments.value, fields.targetId, accounts.value) ?? null),
      at: at ?? t,
      updatedAt: t,
    }
  }

  /** Та же оплата: цель и месяц. Двойная отметка с другого телефона — та же пара. */
  const samePair = (a: Pick<Payment, 'kind' | 'targetId' | 'period'>) => (p: Payment) =>
    p.kind === a.kind && p.targetId === a.targetId && p.period === a.period

  /** Надгробие на все живые записи пары — и на двойную, иначе та всплыла бы оплатой. */
  function buryPair(doc: SyncDoc, pair: (p: Payment) => boolean, t: string) {
    for (const p of doc.payments ?? []) {
      if (!p.deletedAt && pair(p)) Object.assign(p, { deletedAt: t, updatedAt: t })
    }
  }

  /**
   * Снять отметку (Р-7): записи пары перестают считаться — деньги возвращаются на
   * счёт, долг к прежнему остатку. Кроме записи, которую уже покрыла ручная сверка
   * остатка (до якоря): она и так не двигала остаток.
   */
  function unmarkPaid(kind: MonthlyKind, targetId: string, period: string) {
    if (!paidFor(payments.value, kind, targetId, period)) return
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => buryPair(doc, samePair({ kind, targetId, period }), t))
    settlePlan()
  }

  /**
   * Поправить отметку — другая сумма или счёт. Запись неизменна (Р-7): старая —
   * надгробие, новая — с моментом оплаты `at` исходной, потому что деньги ушли
   * тогда, а не при правке. Иначе запись, которую уже покрыла ручная сверка
   * остатка (до якоря), после правки оказалась бы после якоря и списалась второй
   * раз. Проценты месяца у кредита — из исходной записи (`creditResplit`), а не от
   * остатка, уменьшенного с тех пор отметками следующих месяцев. Ничего не
   * поменяли — ничего не пишется.
   */
  function editPaid(record: Payment, opts: { amount: number; accountId: string | null }): Payment | null {
    if (record.kind === 'prepay') return null
    if (opts.amount === record.amount && opts.accountId === record.accountId) return record
    const pair = samePair(record)
    let amount = opts.amount
    let principal: number | undefined
    if (record.kind === 'credit') {
      const raw = (householdDoc.value.credits || []).find((x) => x.id === record.targetId && !x.deletedAt)
      if (!raw) return null
      const split = creditResplit(record, opts.amount, creditBalance(raw, payments.value.filter((p) => !pair(p))))
      amount = split.amount
      principal = split.body
    }
    const { kind, targetId, period, by } = record
    const next = newPayment(
      { kind, targetId, period, amount, ...(principal === undefined ? {} : { principal }), by },
      opts.accountId,
      record.at,
    )
    mutateHouseholdDoc((doc) => {
      buryPair(doc, pair, next.updatedAt)
      if (!doc.payments) doc.payments = []
      doc.payments.push(next)
    })
    settlePlan()
    return next
  }

  /**
   * Применить разовую досрочку (Р-6): запись того же списка, что «оплатил» — всё
   * в тело, со счёта прошлой оплаты этого кредита (Р-5), со снимком сэкономленных
   * процентов. «Снизить платёж» ещё и меняет платёж кредита; прежний — в записи.
   * `planId` — досрочка по выбранному плану (PV-14).
   */
  function applyPrepayment(
    creditId: string,
    by: PersonId,
    opts: { amount: number; mode: LumpMode; accountId?: string | null; planId?: string },
  ): Payment | null {
    const c = credits.value.find((x) => x.id === creditId && !x.deletedAt)
    if (!c) return null
    const plan = lumpPlan(c.principal, c.annualRate, c.payment, opts.amount, opts.mode)
    if (!plan) return null

    // Взнос, закрывший долг, платёж не переписывает: платить больше нечего и так.
    const lowers = opts.mode === 'payment' && plan.left > 0 && plan.payment !== c.payment
    // «Вложить уже накопленное» (клинап Блока 3): эта часть шага месяца старта снимается с
    // целей на паузе, а на счёт приходит сдвигом (как «снять с цели на счёт») — со счёта
    // уходит только остальное. Цели, досрочка и счёт — одной записью документа.
    const debtPlan = opts.planId ? plans.value.find((p) => p.id === opts.planId && !p.deletedAt) : undefined
    const takes = debtPlan ? planLumpTakes(debtPlan, goals.value, plan.paid, monthKey()) : []
    const took = takes.reduce((a, x) => a + x.amount, 0)
    const record = newPayment(
      {
        kind: 'prepay',
        targetId: c.id,
        period: monthKey(),
        amount: plan.paid,
        principal: plan.paid,
        by,
        saved: plan.saved,
        mode: opts.mode,
        ...(lowers ? { prevPayment: c.payment, newPayment: plan.payment } : {}),
        ...(opts.planId ? { planId: opts.planId } : {}),
      },
      opts.accountId,
    )
    const t = record.updatedAt
    const privateAccount = ((privateDoc.value.accounts as Account[]) || []).some((x) => x.id === record.accountId)
    mutateHouseholdDoc((doc) => {
      if (!doc.payments) doc.payments = []
      doc.payments.push(record)
      const raw = lowers ? doc.credits.find((x) => x.id === c.id) : undefined
      if (raw) Object.assign(raw, { payment: plan.payment, principalSetAt: raw.principalSetAt ?? null, updatedAt: t })
      for (const x of takes) {
        const g = (doc.goals || []).find((y) => y.id === x.goalId)
        if (!g) continue
        const id = Math.random().toString(36).slice(2, 10)
        g.movements = [...(g.movements ?? []), { id, date: t, amount: -x.amount, by, note: 'в долги по плану', planId: debtPlan!.id }]
        g.have = goalHave(g.seed, g.movements)
        g.updatedAt = t
      }
      const acc = took && !privateAccount ? (doc.accounts || []).find((a) => a.id === record.accountId) : undefined
      if (acc) Object.assign(acc, { amount: acc.amount + took, updatedAt: t })
    })
    if (took && privateAccount && record.accountId) shiftAccountAmount(record.accountId, took)
    settlePlan()
    return record
  }

  /**
   * Снять досрочку: надгробие — остаток и счёт возвращаются сами. Платёж
   * «снизить платёж» возвращается к прежнему, только если его с тех пор не
   * меняли: иначе снятие затёрло бы более позднее решение.
   */
  function removePrepayment(id: string) {
    const p = payments.value.find((x) => x.id === id && x.kind === 'prepay' && !x.deletedAt)
    if (!p) return
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      const rec = (doc.payments ?? []).find((x) => x.id === id)
      if (rec) Object.assign(rec, { deletedAt: t, updatedAt: t })
      const c = p.prevPayment !== undefined ? doc.credits.find((x) => x.id === p.targetId) : undefined
      if (c && c.payment === p.newPayment) {
        Object.assign(c, { payment: p.prevPayment, principalSetAt: c.principalSetAt ?? null, updatedAt: t })
      }
    })
    settlePlan()
  }

  function removeCredit(id: string) {
    mutateHouseholdDoc((doc) => {
      const c = (doc.credits || []).find((x) => x.id === id)
      if (c) {
        c.deletedAt = new Date().toISOString()
        c.updatedAt = c.deletedAt
      }
    })
    settlePlan()
  }

  /* ------------------ План «Сначала долги» (PV-14) ------------------ */

  // Viewer не выбирает и не отменяет план (Р-12): сервер и так отверг бы push.
  const viewer = () => useAuthStore().isViewer

  /**
   * Планы по правилам Р-5/Р-9 прямо в документе: два активных — старший отменён,
   * долгов с процентами не осталось — активный завершён. Кредиты — из этого же
   * документа (производные). Возвращает, поменялось ли что-то.
   */
  function settleIn(doc: SyncDoc): boolean {
    if (viewer() || !(doc.plans ?? []).length) return false
    const docPayments = doc.payments ?? []
    const next = settlePlans(doc.plans, derivedCredits(doc.credits || [], docPayments), docPayments, new Date().toISOString())
    if (next) doc.plans = next
    return !!next
  }

  /** То же для документа телефона — после правок долгов и после слияния. */
  function settlePlan() {
    if (viewer() || !activePlan.value) return
    const next = settlePlans(plans.value, credits.value, payments.value, new Date().toISOString())
    if (next) mutateHouseholdDoc((doc) => (doc.plans = next))
  }

  /**
   * «Выбрать этот план» (Р-4): план — запись общего документа с прогнозом на момент
   * выбора; прежний активный отменяется. Долгов с процентами нет — выбирать нечего.
   */
  function choosePlan(
    opts: { keptGoalIds: string[]; cushionGoalId: string | null; months: 12 | 24 | 36; lump: number },
    by: PersonId,
  ): DebtPlan | null {
    if (viewer()) return null
    const costly = costliestCredits(credits.value)
    if (!costly.length) return null
    const t = new Date().toISOString()
    // Та же сборка, что показывает калькулятор под кнопкой: выбранное = записанное.
    const draft = planDraft({ ...opts, id: Math.random().toString(36).slice(2, 10), by, t, credits: credits.value })
    const plan: DebtPlan = { ...draft, forecast: planForecast(draft, planState(), monthKey()) }
    mutateHouseholdDoc((doc) => {
      if (!doc.plans) doc.plans = []
      for (const p of doc.plans) endPlan(p, 'cancelled', t)
      doc.plans.push(plan)
    })
    return plan
  }

  /** Активный план уходит в историю: статус, дата и итог по его досрочкам (`endedPlan`). */
  function endPlan(p: DebtPlan, status: 'done' | 'cancelled', t: string) {
    if (p.deletedAt || p.status !== 'active') return
    Object.assign(p, endedPlan(p, status, payments.value, credits.value, t))
  }

  /** «Отменить план» (Р-5): цели возобновятся сами (пауза выводится из плана), история останется. */
  function cancelPlan() {
    if (viewer() || !activePlan.value) return
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      for (const p of doc.plans ?? []) endPlan(p, 'cancelled', t)
    })
  }

  /**
   * Досрочка по плану одним нажатием (Р-4, Р-10): сумма шага в самый дорогой долг,
   * «сократить срок» по умолчанию. Счёт — прошлой оплаты этого кредита (Р-5 RP);
   * истории нет и счёт не передан — null: счёт надо спросить. Шаг месяца уже внесён
   * или это не досрочка (подушка, долгов нет) — null.
   */
  function applyPlanStep(by: PersonId, opts: { accountId?: string | null; mode?: LumpMode } = {}): Payment | null {
    const plan = activePlan.value
    if (viewer() || !plan) return null
    const step = stepDue(planStepNow())
    if (!step) return null
    const accountId =
      opts.accountId !== undefined ? opts.accountId : lastAccountFor(payments.value, step.creditId, accounts.value)
    if (accountId === undefined) return null
    return applyPrepayment(step.creditId, by, { amount: step.amount, mode: opts.mode ?? 'term', accountId, planId: plan.id })
  }

  function updateObligation(id: string, patch: Partial<Obligation>) {
    if (unchanged(obligations.value.find((x) => x.id === id), patch)) return
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

  /**
   * Правка цели. «Уже накоплено» (`have`) правит seed, а не сумму (React `useStore.ts:245-258`):
   * накопленное складывается из seed и взносов, запись поверх стёрла бы историю пополнений.
   */
  function updateGoal(id: string, patch: Partial<Goal>) {
    const cur = goals.value.find((x) => x.id === id)
    if (!cur) return
    const { have, ...rest } = patch
    let next: Partial<Goal> = rest
    if (have !== undefined) {
      const sum = (cur.movements ?? []).reduce((a, m) => a + m.amount, 0)
      const seed = Math.max(0, have - sum)
      next = { ...rest, seed, have: goalHave(seed, cur.movements) }
    }
    if (unchanged(cur, next)) return
    const t = new Date().toISOString()
    // Якорь ручной правки seed — слияние возьмёт его, а не seed позднего взноса партнёра.
    if (next.seed !== undefined && next.seed !== cur.seed) next = { ...next, seedSetAt: t }
    mutateHouseholdDoc((doc) => {
      const g = (doc.goals || []).find((x) => x.id === id)
      if (g) Object.assign(g, next, { updatedAt: t })
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
      // Снятие сверх накопленного пишется целиком, остаток — не ниже нуля (как в слиянии).
      g.have = goalHave(g.seed, g.movements)
      g.updatedAt = t
    })
  }

  function withdraw(id: string, amount: number, by: PersonId, note?: string) {
    contribute(id, -Math.abs(amount), by, note)
  }

  // Покупки в дом (React `useStore.ts:280-311`). Даты — ISO, а не «сегодня» как в React:
  // показ — `atLabel`; старые строки `dd.mm.yyyy` из прода экран показывает как есть.
  function addWish(w: { name: string; price: number; by: PersonId; url?: string }) {
    const t = new Date().toISOString()
    const item: WishItem = {
      id: Math.random().toString(36).slice(2, 10),
      name: w.name,
      price: w.price,
      by: w.by,
      url: w.url,
      bought: false,
      addedOn: t,
      updatedAt: t,
    }
    mutateHouseholdDoc((doc) => {
      if (!doc.wishlist) doc.wishlist = []
      doc.wishlist.unshift(item)
    })
  }

  function updateWish(id: string, patch: Partial<WishItem>) {
    if (unchanged(wishlist.value.find((x) => x.id === id), patch)) return
    mutateHouseholdDoc((doc) => {
      const w = (doc.wishlist || []).find((x) => x.id === id)
      if (w) Object.assign(w, patch, { updatedAt: new Date().toISOString() })
    })
  }

  function removeWish(id: string) {
    mutateHouseholdDoc((doc) => {
      const w = (doc.wishlist || []).find((x) => x.id === id)
      if (w) {
        w.deletedAt = new Date().toISOString()
        w.updatedAt = w.deletedAt
      }
    })
  }

  function toggleBought(id: string) {
    const t = new Date().toISOString()
    mutateHouseholdDoc((doc) => {
      const w = (doc.wishlist || []).find((x) => x.id === id)
      if (!w) return
      w.bought = !w.bought
      w.boughtOn = w.bought ? t : null
      w.updatedAt = t
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
    unsent,
    privateUnsent,
    hasUnsent,
    docHousehold,
    isDemo,
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
    merchantRules,
    credits,
    payments,
    wishlist,
    setupDone,
    plans,
    activePlan,
    planState,
    planStepNow,
    pausedGoalIds,
    saveLocalState,
    setHouseholdDoc,
    mutateHouseholdDoc,
    mutatePrivateDoc,
    addMerchantRule,
    removeMerchantRule,
    resetDoc,
    clearLocal,
    claimFor,
    enterFamily,
    startNewFamily,
    adoptDemo,
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
    addGroup,
    moveToGroup,
    keepSubscription,
    removeGroup,
    addCredit,
    updateCredit,
    removeCredit,
    markPaid,
    markSalary,
    unmarkPaid,
    editPaid,
    applyPrepayment,
    removePrepayment,
    choosePlan,
    cancelPlan,
    applyPlanStep,
    settlePlan,
    addGoal,
    updateGoal,
    removeGoal,
    contribute,
    withdraw,
    addWish,
    updateWish,
    removeWish,
    toggleBought,
    addAccount,
    updateAccount,
    setAccountAmount,
    shiftAccountAmount,
    setDeposit,
    removeAccount,
    setCategoryAmount,
    finishSetup,
    adoptMembers,
    resetAll,
  }
})
