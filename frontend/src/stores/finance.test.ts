import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from './finance'
import { ApiClient, ApiError } from '@/api/client'
import type { SyncDoc, Goal, Person, PersonId } from '@/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '@/types/api'

describe('stores/finance.ts — Pinia хранилище казны и синхронизация', () => {
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

  it('инициализируется с дефолтным документом и сохраняет правки локально', () => {
    const store = useFinanceStore()
    expect(store.setupDone).toBe(false)
    expect(store.people).toEqual([])

    store.mutateHouseholdDoc((doc) => {
      doc.people.push({
        id: 'a',
        name: 'Ильяс',
        salary: 700_000,
        payday: 10,
        updatedAt: '2026-09-23T12:00:00Z',
      })
    })

    expect(store.status).toBe('dirty')
    expect(store.people).toHaveLength(1)
    expect(store.people[0].name).toBe('Ильяс')
  })

  it('успешный цикл синхронизации (pull -> merge -> push -> idle)', async () => {
    const store = useFinanceStore()

    const initialRemoteDoc: SyncDoc = {
      ...defaultSyncDoc(),
      setupDoneAt: '2026-09-20T10:00:00Z',
      categories: [
        {
          key: 'd1',
          name: 'Жильё',
          note: '',
          amount: 250_000,
          updatedAt: '2026-09-20T10:00:00Z',
        },
      ],
    }

    const mockGetDoc = vi.fn().mockResolvedValue({
      household_id: 'h-1',
      rev: 1,
      data: initialRemoteDoc,
      updated_at: '2026-09-20T10:00:00Z',
    } as HouseholdDocResponse)

    const mockPushDoc = vi.fn().mockImplementation(async (rev: number, data: SyncDoc) => {
      return {
        household_id: 'h-1',
        rev: rev + 1,
        data,
        updated_at: new Date().toISOString(),
      } as HouseholdDocResponse
    })

    const mockClient = {
      getHouseholdDoc: mockGetDoc,
      pushHouseholdDoc: mockPushDoc,
    } as unknown as ApiClient

    await store.syncHousehold(mockClient)

    expect(mockGetDoc).toHaveBeenCalledTimes(1)
    expect(mockPushDoc).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('idle')
    expect(store.householdRev).toBe(2)
    expect(store.categories).toHaveLength(1)
    expect(store.setupDone).toBe(true)
  })

  it('автоматическое разрешение конфликта 409: слияние данных и повторная отправка', async () => {
    const store = useFinanceStore()

    // Локально пользователь добавил взнос от Ильяса в цель
    const goalLocal: Goal = {
      id: 'g-trip',
      name: 'Поездка',
      need: 500_000,
      seed: 0,
      have: 50_000,
      monthly: 50_000,
      hue: 'blue',
      planPct: 0.1,
      updatedAt: '2026-09-23T10:00:00Z',
      movements: [
        {
          id: 'm-ilyas',
          date: '2026-09-23',
          amount: 50_000,
          by: 'a',
          note: 'Ильяс',
        },
      ],
    }
    store.householdDoc.goals = [goalLocal]

    // На сервере на момент pull была старая ревизия 1 (без взносов)
    const remoteDocRev1: SyncDoc = {
      ...defaultSyncDoc(),
      goals: [
        {
          id: 'g-trip',
          name: 'Поездка',
          need: 500_000,
          seed: 0,
          have: 0,
          monthly: 50_000,
          hue: 'blue',
          planPct: 0,
          updatedAt: '2026-09-22T10:00:00Z',
          movements: [],
        },
      ],
    }

    // Пока клиент готовил отправку, партнёр внёс взнос на сервере -> ревизия 2
    const serverConflictDocRev2: SyncDoc = {
      ...defaultSyncDoc(),
      goals: [
        {
          id: 'g-trip',
          name: 'Поездка в горы', // партнёр уточнил название
          need: 500_000,
          seed: 0,
          have: 60_000,
          monthly: 50_000,
          hue: 'blue',
          planPct: 0.12,
          updatedAt: '2026-09-23T10:05:00Z',
          movements: [
            {
              id: 'm-aruna',
              date: '2026-09-23',
              amount: 60_000,
              by: 'b',
              note: 'Аруна',
            },
          ],
        },
      ],
    }

    const mockGetDoc = vi.fn().mockResolvedValue({
      household_id: 'h-1',
      rev: 1,
      data: remoteDocRev1,
      updated_at: '2026-09-22T10:00:00Z',
    } as HouseholdDocResponse)

    let pushCallCount = 0
    const mockPushDoc = vi.fn().mockImplementation(async (lastSeenRev: number, data: SyncDoc) => {
      pushCallCount++
      if (pushCallCount === 1) {
        // Первый push отклоняется с 409 Conflict, сервер сообщает актуальный документ ревизии 2
        const conflictPayload: ConflictResponse<HouseholdDocResponse> = {
          error: 'conflict',
          server_doc: {
            household_id: 'h-1',
            rev: 2,
            data: serverConflictDocRev2,
            updated_at: '2026-09-23T10:05:00Z',
          },
        }
        throw new ApiError('conflict', 409, conflictPayload)
      }

      // Второй push (после автоматического слияния) успешен!
      expect(lastSeenRev).toBe(2)
      return {
        household_id: 'h-1',
        rev: 3,
        data,
        updated_at: '2026-09-23T10:10:00Z',
      } as HouseholdDocResponse
    })

    const mockClient = {
      getHouseholdDoc: mockGetDoc,
      pushHouseholdDoc: mockPushDoc,
    } as unknown as ApiClient

    await store.syncHousehold(mockClient)

    // Должно было быть 2 вызова push: первый упал в 409, второй прошёл успешно
    expect(mockPushDoc).toHaveBeenCalledTimes(2)
    expect(store.status).toBe('idle')
    expect(store.householdRev).toBe(3)

    // Проверяем, что цель объединила оба взноса и пересчитала have
    expect(store.goals).toHaveLength(1)
    const goal = store.goals[0]
    expect(goal.name).toBe('Поездка в горы') // имя от партнёра (более позднее updatedAt)
    expect(goal.movements).toHaveLength(2)
    expect(goal.movements.map((m) => m.id)).toContain('m-ilyas')
    expect(goal.movements.map((m) => m.id)).toContain('m-aruna')
    // 50k + 60k = 110k
    expect(goal.have).toBe(110_000)
  })

  it('pullHousehold обновляет состояние без отправки push', async () => {
    const store = useFinanceStore()
    expect(store.status).toBe('idle')

    const serverDoc: SyncDoc = {
      ...defaultSyncDoc(),
      setupDoneAt: '2026-09-23T12:00:00Z',
      people: [
        { id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: '2026-09-23T10:00:00Z' },
      ],
    }

    const mockClient = {
      getHouseholdDoc: vi.fn().mockResolvedValue({
        household_id: 'h-1',
        rev: 7,
        data: serverDoc,
        updated_at: '2026-09-23T12:00:00Z',
      }),
      pushHouseholdDoc: vi.fn(),
    } as unknown as ApiClient

    const res = await store.pullHousehold(mockClient)
    expect(res?.rev).toBe(7)
    expect(store.people).toHaveLength(1)
    expect(store.people[0].name).toBe('Ильяс')
    expect(store.householdRev).toBe(7)
    expect(store.status).toBe('idle')
    expect(mockClient.pushHouseholdDoc).not.toHaveBeenCalled()
  })

  it('pullPrivateDoc и pushPrivateDoc работают с изолированным личным кошельком', async () => {
    const store = useFinanceStore()
    const mockClient = {
      getPrivateDoc: vi.fn().mockResolvedValue({
        household_id: 'h-1',
        user_id: 'u-1',
        rev: 2,
        data: { secretNotes: 'Личные сбережения', amount: 150_000 },
        updated_at: '2026-09-23T10:00:00Z',
      }),
      pushPrivateDoc: vi.fn().mockImplementation(async (rev: number, data: Record<string, unknown>) => {
        return {
          household_id: 'h-1',
          user_id: 'u-1',
          rev: rev + 1,
          data,
          updated_at: new Date().toISOString(),
        }
      }),
    } as unknown as ApiClient

    await store.pullPrivateDoc(mockClient)
    expect(store.privateRev).toBe(2)
    expect(store.privateDoc.amount).toBe(150_000)

    await store.pushPrivateDoc({ secretNotes: 'Обновлено', amount: 200_000 }, mockClient)
    expect(store.privateRev).toBe(3)
    expect(store.privateDoc.amount).toBe(200_000)
    expect(mockClient.pushPrivateDoc).toHaveBeenCalledWith(2, { secretNotes: 'Обновлено', amount: 200_000 })
  })
  // Критик Блока 6: движок синка (MGV-19) зовёт pullHousehold в фоне — ответ, пришедший
  // после локальной правки или во время синка, не должен её затирать.
  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  const person = (id: PersonId, name: string): Person => ({ id, name, salary: 500_000, payday: 10, updatedAt: '2026-09-24T10:00:00Z' })
  const serverResponse = (rev: number, doc: SyncDoc) =>
    ({ household_id: 'h-1', rev, data: doc, updated_at: '2026-09-24T10:00:00Z' }) as HouseholdDocResponse

  it('pullHousehold: ответ, пришедший после локальной правки, её не затирает', async () => {
    const store = useFinanceStore()
    const get = deferred<HouseholdDocResponse>()
    const client = { getHouseholdDoc: vi.fn().mockReturnValue(get.promise) } as unknown as ApiClient

    const pulling = store.pullHousehold(client)
    store.mutateHouseholdDoc((doc) => {
      doc.people.push(person('a', 'Ильяс'))
    })
    get.resolve(serverResponse(5, defaultSyncDoc()))
    await pulling

    expect(store.people.map((p) => p.name)).toEqual(['Ильяс'])
    expect(store.status).toBe('dirty')
  })

  it('pullHousehold: ответ, пришедший во время синка, документ и ревизию не трогает', async () => {
    const store = useFinanceStore()
    store.mutateHouseholdDoc((doc) => {
      doc.people.push(person('a', 'Ильяс'))
    })
    const pullGet = deferred<HouseholdDocResponse>()
    const push = deferred<HouseholdDocResponse>()
    const client = {
      getHouseholdDoc: vi.fn()
        .mockReturnValueOnce(pullGet.promise)
        .mockResolvedValueOnce(serverResponse(1, defaultSyncDoc())),
      pushHouseholdDoc: vi.fn().mockReturnValue(push.promise),
    } as unknown as ApiClient

    const pulling = store.pullHousehold(client)
    const syncing = store.syncHousehold(client)
    pullGet.resolve(serverResponse(1, defaultSyncDoc()))
    await pulling
    expect(store.people.map((p) => p.name)).toEqual(['Ильяс'])

    push.reject(new Error('network'))
    await syncing
    expect(store.status).toBe('error')
    expect(store.people.map((p) => p.name)).toEqual(['Ильяс'])
  })

  it('правка во время push не теряется: остаётся dirty и уходит следующим кругом', async () => {
    const store = useFinanceStore()
    store.mutateHouseholdDoc((doc) => {
      doc.people.push(person('a', 'Ильяс'))
    })
    const push = deferred<HouseholdDocResponse>()
    const client = {
      getHouseholdDoc: vi.fn().mockResolvedValue(serverResponse(1, defaultSyncDoc())),
      // Тело запроса сериализуется в момент вызова — как JSON.stringify в ApiClient.
      pushHouseholdDoc: vi.fn().mockImplementation((_rev: number, data: SyncDoc) => {
        const sent = JSON.parse(JSON.stringify(data)) as SyncDoc
        return push.promise.then(() => serverResponse(2, sent))
      }),
    } as unknown as ApiClient

    const syncing = store.syncHousehold(client)
    await vi.waitFor(() => expect(client.pushHouseholdDoc).toHaveBeenCalled())
    store.mutateHouseholdDoc((doc) => {
      doc.people.push(person('b', 'Аруна'))
    })
    push.resolve(serverResponse(2, defaultSyncDoc()))
    await syncing

    expect(store.people.map((p) => p.name)).toEqual(['Ильяс', 'Аруна'])
    expect(store.householdRev).toBe(2)
    expect(store.status).toBe('dirty')
  })
  describe('RP-01: правка тем же значением ничего не пишет', () => {
    const T0 = '2026-09-20T10:00:00Z'
    function loadClean(store: ReturnType<typeof useFinanceStore>) {
      store.setHouseholdDoc(
        {
          ...defaultSyncDoc(),
          people: [{ ...person('a', 'Ильяс'), salary: 700_000, updatedAt: T0 }],
          categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: T0 }],
          accounts: [
            {
              id: 'acc', name: 'Kaspi', note: '', amount: 90_000, kind: 'deposit', updatedAt: T0,
              deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 10_000, capitalize: true },
            },
          ],
          obligations: [
            { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
          ],
        },
        3,
      )
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('то же значение: ни updatedAt, ни статуса, ни синка', () => {
      const store = useFinanceStore()
      loadClean(store)

      store.setCategoryAmount('d4', 150_000)
      store.correctSalary('a', 700_000)
      store.setAccountAmount('acc', 90_000)
      store.updateAccount('acc', { name: 'Kaspi', note: '' })
      store.setPerson('a', { name: 'Ильяс', payday: 10 })
      store.setDeposit('acc', { monthlyTopUp: 10_000, months: 12 })
      store.correctObligation('rent', 220_000)

      expect(store.status).toBe('idle')
      expect(vi.getTimerCount()).toBe(0)
      expect(store.categories[0].updatedAt).toBe(T0)
      expect(store.people[0].updatedAt).toBe(T0)
      expect(store.accounts[0].updatedAt).toBe(T0)
      expect(store.obligations[0].updatedAt).toBe(T0)
    })

    it('новое значение пишется как раньше', () => {
      const store = useFinanceStore()
      loadClean(store)

      store.setCategoryAmount('d4', 160_000)
      expect(store.categories[0].amount).toBe(160_000)
      expect(store.categories[0].updatedAt).not.toBe(T0)
      expect(store.status).toBe('dirty')

      store.correctSalary('a', 750_000)
      expect(store.people[0].salary).toBe(750_000)
      expect(store.people[0].updatedAt).not.toBe(T0)

      store.setAccountAmount('acc', 95_000)
      expect(store.accounts[0].amount).toBe(95_000)
      expect(store.accounts[0].updatedAt).not.toBe(T0)
    })
  })

  it('pullHousehold: сбой (истёкший вход) не оставляет «синхронизировано»', async () => {
    const store = useFinanceStore()
    const client = {
      getHouseholdDoc: vi.fn().mockRejectedValue(new ApiError('unauthorized', 401)),
    } as unknown as ApiClient

    expect(await store.pullHousehold(client)).toBeNull()
    expect(store.status).toBe('error')
  })
})
