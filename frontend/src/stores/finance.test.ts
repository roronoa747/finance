import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc, DEMO_HOUSEHOLD } from './finance'
import { useAuthStore } from './auth'
import { ApiClient, ApiError, apiClient } from '@/api/client'
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
  const authData = (token: string, householdId: string) => ({
    token,
    user: { id: `u-${token}`, email: `${token}@example.com`, created_at: '2026-09-24T00:00:00Z' },
    household: { id: householdId, name: 'Казна', created_by: `u-${token}`, created_at: '2026-09-24T00:00:00Z' },
    member: {
      household_id: householdId,
      user_id: `u-${token}`,
      slot: 'a' as PersonId,
      display_name: 'Ильяс',
      role: 'member' as const,
      joined_at: '2026-09-24T00:00:00Z',
    },
  })

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
    // RP-04: запрос не дошёл до сервера — «нет сети», а не «не сошлось».
    expect(store.status).toBe('offline')
    expect(store.unsent).toBe(true)
    expect(store.people.map((p) => p.name)).toEqual(['Ильяс'])
  })

  it('RP-04: без связи с сервером (fetch упал) — «нет сети»; ответ сервера с ошибкой — «не сошлось»', async () => {
    const store = useFinanceStore()
    const failFetch = { getHouseholdDoc: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) } as unknown as ApiClient
    await store.pullHousehold(failFetch)
    expect(store.status).toBe('offline')
    await store.syncHousehold(failFetch)
    expect(store.status).toBe('offline')

    const serverSaysNo = { getHouseholdDoc: vi.fn().mockRejectedValue(new ApiError('internal', 500)) } as unknown as ApiClient
    await store.syncHousehold(serverSaysNo)
    expect(store.status).toBe('error')
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

  describe('RP-04: неотправленное, выход и повторный вход', () => {
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
    // Фейковый сервер одной семьи: ревизии, 409 и «вход истёк» (401) по флагу.
    function fakeServer(data: SyncDoc) {
      const server = { rev: 1, data: clone(data), deny: false }
      const client = {
        getHouseholdDoc: vi.fn(async () => {
          if (server.deny) throw new ApiError('unauthorized', 401)
          return serverResponse(server.rev, clone(server.data))
        }),
        pushHouseholdDoc: vi.fn(async (rev: number, doc: SyncDoc) => {
          if (server.deny) throw new ApiError('unauthorized', 401)
          if (rev !== server.rev) {
            throw new ApiError('conflict', 409, { error: 'conflict', server_doc: serverResponse(server.rev, clone(server.data)) })
          }
          server.rev++
          server.data = clone(doc)
          return serverResponse(server.rev, clone(doc))
        }),
      } as unknown as ApiClient
      return { server, client }
    }
    const d4 = (doc: SyncDoc) => doc.categories.find((c) => c.key === 'd4')?.amount

    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('Н-6: правка → 401 → вход заново → правка цела и уходит на сервер', async () => {
      const { server, client } = fakeServer({
        ...defaultSyncDoc(),
        people: [person('a', 'Ильяс')],
        categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '2026-09-20T10:00:00Z' }],
      })
      const store = useFinanceStore()
      store.claimFor('h-1')
      await store.pullHousehold(client)
      expect(store.status).toBe('idle')

      server.deny = true
      store.setCategoryAmount('d4', 200_000)
      await store.syncHousehold(client)
      expect(store.status).toBe('error')
      expect(store.unsent).toBe(true)

      // Пока вход истёк, партнёр поправил своё.
      server.data.people[0] = { ...person('a', 'Ильяс К.'), updatedAt: '2030-01-01T00:00:00Z' }
      server.rev++

      // Вход заново в ту же семью: слияние, а не замена серверной копией.
      server.deny = false
      store.claimFor('h-1')
      await store.pullHousehold(client)
      expect(d4(store.householdDoc)).toBe(200_000)
      expect(store.people[0].name).toBe('Ильяс К.')

      await vi.advanceTimersByTimeAsync(1500)
      expect(d4(server.data)).toBe(200_000)
      expect(server.data.people[0].name).toBe('Ильяс К.')
      expect(store.unsent).toBe(false)
      expect(store.status).toBe('idle')
    })

    it('неотправленное переживает перезапуск: статус «ждёт отправки», а не «синхронизировано»', () => {
      useFinanceStore().setPerson('a', { name: 'Ильяс' })
      setActivePinia(createPinia())
      const reopened = useFinanceStore()
      expect(reopened.unsent).toBe(true)
      expect(reopened.status).toBe('dirty')
      expect(reopened.people[0].name).toBe('Ильяс')
    })

    it('выход без неотправленного стирает стор и localStorage', () => {
      const auth = useAuthStore()
      auth.setAuthData(authData('tok-1', 'h-1'))
      const store = useFinanceStore()
      store.claimFor('h-1')
      store.setHouseholdDoc({ ...defaultSyncDoc(), people: [person('a', 'Ильяс')] }, 3)

      expect(auth.logout()).toBe(true)
      expect(auth.token).toBeNull()
      expect(store.people).toEqual([])
      expect(store.householdRev).toBe(0)
      expect(store.docHousehold).toBeNull()
      for (const key of ['ff_household_doc', 'ff_household_rev', 'ff_private_doc', 'ff_unsent', 'ff_doc_household']) {
        expect(mockLocalStorage.getItem(key)).toBeNull()
      }
    })

    it('выход с неотправленным сначала спрашивает; «выйти без них» стирает, «войти заново» оставляет', () => {
      const auth = useAuthStore()
      auth.setAuthData(authData('tok-1', 'h-1'))
      const store = useFinanceStore()
      store.claimFor('h-1')
      store.setPerson('a', { name: 'Ильяс' })

      expect(auth.logout()).toBe(false)
      expect(auth.token).toBe('tok-1')
      expect(store.people).toHaveLength(1)

      expect(auth.logout('keep')).toBe(true)
      expect(auth.token).toBeNull()
      expect(store.people).toHaveLength(1)
      expect(store.unsent).toBe(true)

      auth.setAuthData(authData('tok-2', 'h-1'))
      expect(auth.logout('discard')).toBe(true)
      expect(store.people).toEqual([])
      expect(store.unsent).toBe(false)
    })

    it('вход другой семьи в той же вкладке после выхода — документы не смешаны', async () => {
      const auth = useAuthStore()
      const store = useFinanceStore()
      auth.setAuthData(authData('tok-1', 'h-1'))
      store.claimFor('h-1')
      store.setHouseholdDoc({ ...defaultSyncDoc(), people: [person('a', 'Ильяс')] }, 3)
      auth.logout()

      const other = fakeServer({ ...defaultSyncDoc(), people: [person('a', 'Дана')] })
      auth.setAuthData(authData('tok-3', 'h-2'))
      store.claimFor('h-2')
      await store.pullHousehold(other.client)
      expect(store.people.map((p) => p.name)).toEqual(['Дана'])
    })

    it('«войти заново», но в другую семью: неотправленное прежней семьи стирается, не сливается', async () => {
      const auth = useAuthStore()
      const store = useFinanceStore()
      auth.setAuthData(authData('tok-1', 'h-1'))
      store.claimFor('h-1')
      store.setPerson('a', { name: 'Ильяс' })
      auth.logout('keep')

      const other = fakeServer({ ...defaultSyncDoc(), people: [person('a', 'Дана')] })
      auth.setAuthData(authData('tok-3', 'h-2'))
      store.claimFor('h-2')
      await store.pullHousehold(other.client)
      await vi.advanceTimersByTimeAsync(2000)
      expect(store.people.map((p) => p.name)).toEqual(['Дана'])
      expect(other.server.data.people.map((p) => p.name)).toEqual(['Дана'])
      expect(other.client.pushHouseholdDoc).not.toHaveBeenCalled()
    })

    it('ответ, запрошенный до выхода, не возвращает прежнюю семью в стор', async () => {
      const store = useFinanceStore()
      const get = deferred<HouseholdDocResponse>()
      const client = { getHouseholdDoc: vi.fn().mockReturnValue(get.promise) } as unknown as ApiClient

      const pulling = store.pullHousehold(client)
      store.clearLocal()
      get.resolve(serverResponse(7, { ...defaultSyncDoc(), people: [person('a', 'Ильяс')] }))
      await pulling
      expect(store.people).toEqual([])
      expect(store.householdRev).toBe(0)
    })
  })

  it('RP-05: в демо правки не шлют ни одного запроса и не дают «не сошлось»', async () => {
    vi.useFakeTimers()
    try {
      const calls = { n: 0 }
      const count = () => {
        calls.n++
        return Promise.reject(new ApiError('unauthorized', 401))
      }
      const counter = {
        getHouseholdDoc: vi.fn(count),
        pushHouseholdDoc: vi.fn(count),
        getPrivateDoc: vi.fn(count),
        pushPrivateDoc: vi.fn(count),
      } as unknown as ApiClient
      for (const m of ['getHouseholdDoc', 'pushHouseholdDoc', 'getPrivateDoc', 'pushPrivateDoc'] as const) {
        vi.spyOn(apiClient, m).mockImplementation(count as never)
      }

      const store = useFinanceStore()
      store.startNewFamily(DEMO_HOUSEHOLD)
      expect(store.isDemo).toBe(true)
      store.setCategoryAmount('d4', 280_000)
      store.addAccount({ name: 'Заначка', kind: 'cash', amount: 10_000 }, true)
      store.resetDoc()
      await vi.advanceTimersByTimeAsync(5_000)
      await store.syncHousehold(counter)
      await store.pullHousehold(counter)
      await store.pullPrivateDoc(counter)

      expect(calls.n).toBe(0)
      expect(store.status).not.toBe('error')
      expect(store.status).not.toBe('conflict')
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
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
