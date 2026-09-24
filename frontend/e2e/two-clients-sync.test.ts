import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc, Goal, Account } from '../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse, PrivateDocResponse } from '../src/types/api'
import { netWorth, goalMonths, nextChange } from '../src/lib/finance'
import { monthKey } from '../src/lib/dates'
import Overview from '../src/views/Overview.vue'
import Capital from '../src/views/Capital.vue'

describe('e2e / MGV-14 — Сквозная приёмка: совместная работа двух клиентов и синхронизация', () => {
  const storageMapA = new Map<string, string>()
  const storageMapB = new Map<string, string>()

  // Имитация бэкенда (in-memory база данных PostgreSQL)
  let serverHouseholdDoc: {
    rev: number
    data: SyncDoc
    updated_at: string
  }

  const serverPrivateDocs = new Map<
    string,
    {
      rev: number
      data: Record<string, unknown>
      updated_at: string
    }
  >()

  function createMockBackendClient(userId: string) {
    return {
      getHouseholdDoc: vi.fn().mockImplementation(async (): Promise<HouseholdDocResponse> => {
        return {
          household_id: 'h-family',
          rev: serverHouseholdDoc.rev,
          data: JSON.parse(JSON.stringify(serverHouseholdDoc.data)),
          updated_at: serverHouseholdDoc.updated_at,
        }
      }),

      pushHouseholdDoc: vi.fn().mockImplementation(async (lastSeenRev: number, data: SyncDoc): Promise<HouseholdDocResponse> => {
        if (lastSeenRev !== serverHouseholdDoc.rev) {
          const conflict: ConflictResponse<HouseholdDocResponse> = {
            error: 'conflict',
            server_doc: {
              household_id: 'h-family',
              rev: serverHouseholdDoc.rev,
              data: JSON.parse(JSON.stringify(serverHouseholdDoc.data)),
              updated_at: serverHouseholdDoc.updated_at,
            },
          }
          throw new ApiError('conflict', 409, conflict)
        }
        serverHouseholdDoc.rev++
        serverHouseholdDoc.data = JSON.parse(JSON.stringify(data))
        serverHouseholdDoc.updated_at = new Date().toISOString()
        return {
          household_id: 'h-family',
          rev: serverHouseholdDoc.rev,
          data: JSON.parse(JSON.stringify(serverHouseholdDoc.data)),
          updated_at: serverHouseholdDoc.updated_at,
        }
      }),

      getPrivateDoc: vi.fn().mockImplementation(async (): Promise<PrivateDocResponse> => {
        const doc = serverPrivateDocs.get(userId) || {
          rev: 0,
          data: {},
          updated_at: new Date().toISOString(),
        }
        return {
          household_id: 'h-family',
          user_id: userId,
          rev: doc.rev,
          data: JSON.parse(JSON.stringify(doc.data)),
          updated_at: doc.updated_at,
        }
      }),

      pushPrivateDoc: vi.fn().mockImplementation(async (lastSeenRev: number, data: Record<string, unknown>): Promise<PrivateDocResponse> => {
        const cur = serverPrivateDocs.get(userId) || {
          rev: 0,
          data: {},
          updated_at: new Date().toISOString(),
        }
        if (lastSeenRev !== cur.rev) {
          const conflict: ConflictResponse<PrivateDocResponse> = {
            error: 'conflict',
            server_doc: {
              household_id: 'h-family',
              user_id: userId,
              rev: cur.rev,
              data: JSON.parse(JSON.stringify(cur.data)),
              updated_at: cur.updated_at,
            },
          }
          throw new ApiError('conflict', 409, conflict)
        }
        const updated = {
          rev: cur.rev + 1,
          data: JSON.parse(JSON.stringify(data)),
          updated_at: new Date().toISOString(),
        }
        serverPrivateDocs.set(userId, updated)
        return {
          household_id: 'h-family',
          user_id: userId,
          rev: updated.rev,
          data: JSON.parse(JSON.stringify(updated.data)),
          updated_at: updated.updated_at,
        }
      }),
    } as unknown as ApiClient
  }

  beforeEach(() => {
    storageMapA.clear()
    storageMapB.clear()
    serverPrivateDocs.clear()

    // Начальный документ на сервере
    serverHouseholdDoc = {
      rev: 1,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: '2026-09-24T00:00:00Z',
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '2026-09-24T00:00:00Z' },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: '2026-09-24T00:00:00Z' },
        ],
      },
      updated_at: '2026-09-24T00:00:00Z',
    }
  })

  it('полный сквозной цикл двух клиентов: синхронизация казны, изоляция приватных документов, ритуал и цели', async () => {
    // -------------------------------------------------------------------------
    // 1. Инициализация двух независимых клиентов (Клиент A — Ильяс, Клиент B — Аруна)
    // -------------------------------------------------------------------------
    const piniaA = createPinia()
    const piniaB = createPinia()

    // --- Клиент A (Ильяс) ---
    setActivePinia(piniaA)
    const authStoreA = useAuthStore()
    const financeStoreA = useFinanceStore()
    const clientA = createMockBackendClient('u-ilyas')

    authStoreA.setAuthData({
      token: 'jwt-token-ilyas',
      user: { id: 'u-ilyas', email: 'ilyas@example.com', created_at: '2026-09-24T00:00:00Z' },
      household: { id: 'h-family', name: 'Семья Ильяса и Аруны', created_at: '2026-09-24T00:00:00Z' },
      member: {
        id: 'm-ilyas',
        household_id: 'h-family',
        user_id: 'u-ilyas',
        display_name: 'Ильяс',
        role: 'owner',
        slot: 'a',
      },
    })
    await financeStoreA.pullHousehold(clientA)
    expect(financeStoreA.householdRev).toBe(1)
    expect(financeStoreA.people).toHaveLength(2)

    // --- Клиент B (Аруна) ---
    setActivePinia(piniaB)
    const authStoreB = useAuthStore()
    const financeStoreB = useFinanceStore()
    const clientB = createMockBackendClient('u-aruna')

    authStoreB.setAuthData({
      token: 'jwt-token-aruna',
      user: { id: 'u-aruna', email: 'aruna@example.com', created_at: '2026-09-24T00:00:00Z' },
      household: { id: 'h-family', name: 'Семья Ильяса и Аруны', created_at: '2026-09-24T00:00:00Z' },
      member: {
        id: 'm-aruna',
        household_id: 'h-family',
        user_id: 'u-aruna',
        display_name: 'Аруна',
        role: 'member',
        slot: 'b',
      },
    })
    await financeStoreB.pullHousehold(clientB)
    expect(financeStoreB.householdRev).toBe(1)

    // -------------------------------------------------------------------------
    // 2. Клиент A добавляет общий счёт и цель в домохозяйство -> Sync на бэкенд
    // -------------------------------------------------------------------------
    setActivePinia(piniaA)
    financeStoreA.addAccount({
      name: 'Общий Kaspi Депозит',
      kind: 'deposit',
      amount: 1_200_000,
      deposit: {
        annualRate: 0.14,
        months: 12,
        monthlyTopUp: 100_000,
        capitalize: true,
      },
    }, false) // общий счёт

    financeStoreA.addGoal({
      name: 'Семейный отпуск в горах',
      need: 900_000,
      have: 300_000,
      monthly: 100_000,
      hue: 'teal',
    })

    const sharedGoalId = financeStoreA.goals[0].id

    // Синхронизируем состояние Клиента A на бэкенд
    await financeStoreA.syncHousehold(clientA)
    expect(financeStoreA.householdRev).toBe(2)
    expect(serverHouseholdDoc.rev).toBe(2)

    // -------------------------------------------------------------------------
    // 3. Клиент B синхронизируется и видит добавленный счёт и цель
    // -------------------------------------------------------------------------
    setActivePinia(piniaB)
    await financeStoreB.pullHousehold(clientB)
    expect(financeStoreB.householdRev).toBe(2)
    expect(financeStoreB.accounts).toHaveLength(1)
    expect(financeStoreB.accounts[0].name).toBe('Общий Kaspi Депозит')
    expect(financeStoreB.goals).toHaveLength(1)
    expect(financeStoreB.goals[0].name).toBe('Семейный отпуск в горах')
    expect(financeStoreB.goals[0].have).toBe(300_000)

    // -------------------------------------------------------------------------
    // 4. Клиент B делает взнос в цель -> Sync на бэкенд
    // -------------------------------------------------------------------------
    financeStoreB.contribute(sharedGoalId, 100_000, 'b', 'Взнос от Аруны')
    expect(financeStoreB.goals[0].have).toBe(400_000)

    await financeStoreB.syncHousehold(clientB)
    expect(financeStoreB.householdRev).toBe(3)
    expect(serverHouseholdDoc.rev).toBe(3)

    // Клиент A делает pull и видит взнос от Аруны
    setActivePinia(piniaA)
    await financeStoreA.pullHousehold(clientA)
    expect(financeStoreA.householdRev).toBe(3)
    expect(financeStoreA.goals[0].have).toBe(400_000)
    expect(financeStoreA.goals[0].movements).toHaveLength(1)
    expect(financeStoreA.goals[0].movements![0].by).toBe('b')
    expect(financeStoreA.goals[0].movements![0].note).toBe('Взнос от Аруны')

    // -------------------------------------------------------------------------
    // 5. Изоляция приватных документов: личные заначки участников
    // -------------------------------------------------------------------------
    // Клиент A заводит приватный счёт на 500 000 ₸
    financeStoreA.addAccount({
      name: 'Личная заначка Ильяса',
      kind: 'cash',
      amount: 500_000,
    }, true) // private = true

    expect(financeStoreA.privateAccounts).toHaveLength(1)
    expect(financeStoreA.privateAccounts[0].name).toBe('Личная заначка Ильяса')
    // Ильяс в совокупном капитале видит 1 200 000 (депозит) + 400 000 (цель) + 500 000 (заначка) = 2 100 000
    expect(netWorth(financeStoreA.accounts, financeStoreA.credits, financeStoreA.goals)).toBe(2_100_000)

    // Клиент A пушит приватный документ на бэкенд
    await financeStoreA.pushPrivateDoc(financeStoreA.privateDoc, clientA)

    // Клиент B заводит свой собственный приватный счёт на 350 000 ₸
    setActivePinia(piniaB)
    financeStoreB.addAccount({
      name: 'Личный счёт Аруны',
      kind: 'card',
      amount: 350_000,
    }, true) // private = true

    await financeStoreB.pushPrivateDoc(financeStoreB.privateDoc, clientB)

    // ПРОВЕРКА ИЗОЛЯЦИИ:
    // 1) В бэкенде хранятся две РАЗНЫЕ изолированные записи
    const rawIlyasDoc = serverPrivateDocs.get('u-ilyas')
    const rawArunaDoc = serverPrivateDocs.get('u-aruna')
    expect(rawIlyasDoc).toBeDefined()
    expect(rawArunaDoc).toBeDefined()

    const ilyasAccounts = (rawIlyasDoc?.data.accounts as Account[]) || []
    const arunaAccounts = (rawArunaDoc?.data.accounts as Account[]) || []

    expect(ilyasAccounts).toHaveLength(1)
    expect(ilyasAccounts[0].name).toBe('Личная заначка Ильяса')
    expect(arunaAccounts).toHaveLength(1)
    expect(arunaAccounts[0].name).toBe('Личный счёт Аруны')

    // 2) Аруна видит только свои счета и общий счёт, но НЕ счёт Ильяса
    expect(financeStoreB.accounts).toHaveLength(2) // 1 общий + 1 приватный Аруны
    expect(financeStoreB.accounts.map((a) => a.name)).toContain('Общий Kaspi Депозит')
    expect(financeStoreB.accounts.map((a) => a.name)).toContain('Личный счёт Аруны')
    expect(financeStoreB.accounts.map((a) => a.name)).not.toContain('Личная заначка Ильяса')

    // -------------------------------------------------------------------------
    // 6. Сценарий Ритуала: высвобождение средств и ускорение цели
    // -------------------------------------------------------------------------
    setActivePinia(piniaA)
    // Добавляем обязательство с грядущим снижением на 40 000 ₸
    financeStoreA.householdDoc.obligations.push({
      id: 'ob-gym',
      name: 'Фитнес-клуб',
      note: 'годовой абонемент закончится',
      day: 1,
      category: 'd1',
      versions: [
        { from: '2026-01', amount: 60_000 },
        { from: '2026-11', amount: 20_000 }, // снижение на 40 000
      ],
      updatedAt: '2026-09-24T00:00:00Z',
    })

    const key = monthKey()
    const gymChange = nextChange(financeStoreA.householdDoc.obligations[0], key)
    expect(gymChange).not.toBeNull()
    expect(gymChange?.delta).toBe(-40_000)

    // Ильяс перенаправляет 40 000 ₸ в цель «Семейный отпуск»
    const remainingBefore = financeStoreA.goals[0].need - financeStoreA.goals[0].have
    const monthsBefore = goalMonths(remainingBefore, financeStoreA.goals[0].monthly)
    expect(monthsBefore).toBe(5) // (900k - 400k) / 100k = 5 мес.

    financeStoreA.setGoalMonthly(sharedGoalId, financeStoreA.goals[0].monthly + 40_000)
    const monthsAfter = goalMonths(remainingBefore, financeStoreA.goals[0].monthly)
    expect(monthsAfter).toBe(4) // 500k / 140k = 3.57 -> 4 мес.

    // Синхронизируем на бэкенд
    await financeStoreA.syncHousehold(clientA)
    expect(financeStoreA.householdRev).toBe(4)

    // Аруна подтягивает изменения
    setActivePinia(piniaB)
    await financeStoreB.pullHousehold(clientB)
    expect(financeStoreB.householdRev).toBe(4)
    expect(financeStoreB.goals[0].monthly).toBe(140_000)

    // -------------------------------------------------------------------------
    // 7. Проверка визуального рендеринга экранов для обоих клиентов (SSR)
    // -------------------------------------------------------------------------
    const router = createAppRouter()

    // Рендер Capital.vue у Ильяса
    setActivePinia(piniaA)
    const appCapitalA = createSSRApp(Capital)
    appCapitalA.use(router)
    await router.push('/capital')
    const htmlCapitalA = await renderToString(appCapitalA)
    expect(htmlCapitalA).toContain('Чистый капитал')
    expect(htmlCapitalA).toContain('Личная заначка Ильяса')
    expect(htmlCapitalA).toContain('Общий Kaspi Депозит')
    expect(htmlCapitalA).not.toContain('Личный счёт Аруны')

    // Рендер Capital.vue у Аруны
    setActivePinia(piniaB)
    const appCapitalB = createSSRApp(Capital)
    appCapitalB.use(router)
    await router.push('/capital')
    const htmlCapitalB = await renderToString(appCapitalB)
    expect(htmlCapitalB).toContain('Чистый капитал')
    expect(htmlCapitalB).toContain('Личный счёт Аруны')
    expect(htmlCapitalB).toContain('Общий Kaspi Депозит')
    expect(htmlCapitalB).not.toContain('Личная заначка Ильяса')

    // Рендер Overview.vue у обоих
    const appOverviewB = createSSRApp(Overview)
    appOverviewB.use(router)
    await router.push('/')
    const htmlOverviewB = await renderToString(appOverviewB)
    expect(htmlOverviewB).toContain('Капитал')
    expect(htmlOverviewB).toContain('Семейный отпуск в горах')
    expect(htmlOverviewB).toContain('Ильяс')
    expect(htmlOverviewB).toContain('Аруна')
  })
})
