import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc, DEMO_HOUSEHOLD } from './finance'
import { useAuthStore } from './auth'
import { ApiClient, ApiError, apiClient } from '@/api/client'
import type { SyncDoc, Goal, Person, PersonId } from '@/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '@/types/api'
import { annuityMonths, goalHave, lumpPlan, nextObligationDue, prepaySaved } from '@/lib/finance'
import { mergeDocs } from '@/lib/merge'

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

    it('синк прежней семьи повис при выходе — вход в новую семью всё равно получает её документ', async () => {
      const store = useFinanceStore()
      store.claimFor('h-1')
      store.setPerson('a', { name: 'Ильяс' })
      const hung = deferred<HouseholdDocResponse>()
      const oldClient = { getHouseholdDoc: vi.fn().mockReturnValue(hung.promise) } as unknown as ApiClient
      const oldSync = store.syncHousehold(oldClient)

      store.clearLocal()
      const other = fakeServer({ ...defaultSyncDoc(), setupDoneAt: '2026-09-01T00:00:00Z', people: [person('a', 'Дана')] })
      store.claimFor('h-2')
      await store.pullHousehold(other.client)
      expect(store.people.map((p) => p.name)).toEqual(['Дана'])
      expect(store.setupDone).toBe(true)

      // Новый синк не ждёт повисший запрос прежней семьи, а тот, вернувшись, ничего не трогает.
      store.setPerson('a', { name: 'Дана К.' })
      await store.syncHousehold(other.client)
      expect(other.server.data.people[0].name).toBe('Дана К.')
      hung.resolve(serverResponse(9, { ...defaultSyncDoc(), people: [person('a', 'Ильяс')] }))
      await oldSync
      expect(store.people.map((p) => p.name)).toEqual(['Дана К.'])
      expect(store.status).toBe('idle')
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

describe('RP-06: отметки оплат в сторе', () => {
  const storage = new Map<string, string>()
  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    // Часы подделаны, таймеры тоже: запланированный синк не уходит в сеть.
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z') // 12:00 в Алматы
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function family() {
    const store = useFinanceStore()
    store.addAccount({ name: 'Kaspi', kind: 'card', amount: 1_000_000 })
    store.addAccount({ name: 'Наличные', kind: 'cash', amount: 50_000 })
    store.addObligation({ name: 'Аренда', day: 5, category: 'd1', amount: 220_000 })
    store.addCredit({ name: 'Кредит', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15 })
    at('2026-09-24T08:00:00Z')
    return {
      store,
      card: store.accounts[0].id,
      cash: store.accounts[1].id,
      rent: store.obligations[0].id,
      loan: store.credits[0].id,
    }
  }
  const balance = (store: ReturnType<typeof useFinanceStore>, id: string) =>
    store.accounts.find((a) => a.id === id)!.amount

  it('«оплатил аренду»: запись по графику, карта уменьшилась, следующий — октябрь; повтор не удваивает', () => {
    const { store, card, rent } = family()
    const rec = store.markPaid('obligation', rent, 'a', { accountId: card })!
    expect(rec).toMatchObject({
      kind: 'obligation', targetId: rent, period: '2026-09', amount: 220_000, accountId: card, by: 'a',
    })
    expect(balance(store, card)).toBe(780_000)
    // В документе — база и запись; остаток выводится, а не перезаписывается.
    expect(store.householdDoc.accounts[0].amount).toBe(1_000_000)
    expect(store.householdDoc.payments).toHaveLength(1)
    expect(store.unsent).toBe(true)
    expect(nextObligationDue(store.obligations[0], store.payments)).toMatchObject({ period: '2026-10', day: 5 })

    at('2026-09-24T08:00:05Z')
    expect(store.markPaid('obligation', rent, 'b', { period: '2026-09', accountId: card })!.id).toBe(rec.id)
    expect(store.payments).toHaveLength(1)
    expect(balance(store, card)).toBe(780_000)
  })

  it('снять отметку — деньги вернулись; снова — новая запись; счёт по умолчанию — прошлой оплаты', () => {
    const { store, card, cash, rent } = family()
    const first = store.markPaid('obligation', rent, 'a', { accountId: cash })!
    at('2026-09-24T09:00:00Z')
    store.unmarkPaid('obligation', rent, '2026-09')
    expect(balance(store, cash)).toBe(50_000)
    expect(store.payments[0].deletedAt).toBe('2026-09-24T09:00:00.000Z')

    at('2026-09-24T10:00:00Z')
    const again = store.markPaid('obligation', rent, 'a', { accountId: card })!
    expect(again.id).not.toBe(first.id)
    expect(again.period).toBe('2026-09')
    expect(balance(store, card)).toBe(780_000)

    // Октябрь без выбора счёта — с той же карты (Р-5).
    at('2026-10-05T05:00:00Z')
    const october = store.markPaid('obligation', rent, 'b')!
    expect(october).toMatchObject({ period: '2026-10', accountId: card })
    expect(balance(store, card)).toBe(560_000)
  })

  it('первая оплата без выбора счёта ничего не списывает', () => {
    const { store, card, rent } = family()
    expect(store.markPaid('obligation', rent, 'a')!.accountId).toBeNull()
    expect(balance(store, card)).toBe(1_000_000)
  })

  it('кредит: остаток уменьшается на тело, следующий месяц считает проценты от нового; снятие возвращает', () => {
    const { store, card, loan } = family()
    const sep = store.markPaid('credit', loan, 'a', { accountId: card })!
    // 1 000 000 × 0,33 / 12 = 27 500 процентов, тело 30 500.
    expect(sep).toMatchObject({ period: '2026-09', amount: 58_000, principal: 30_500 })
    expect(store.credits[0].principal).toBe(969_500)
    expect(balance(store, card)).toBe(942_000)

    at('2026-10-15T05:00:00Z')
    const oct = store.markPaid('credit', loan, 'a')!
    // 969 500 × 0,33 / 12 = 26 661,25 → 26 661; тело 31 339.
    expect(oct).toMatchObject({ period: '2026-10', principal: 31_339, accountId: card })
    expect(store.credits[0].principal).toBe(938_161)

    store.unmarkPaid('credit', loan, '2026-10')
    expect(store.credits[0].principal).toBe(969_500)
    expect(balance(store, card)).toBe(942_000)
    // База долга в документе не менялась ни разу.
    expect(store.householdDoc.credits[0].principal).toBe(1_000_000)
  })

  it('сверка руками после отметки: новая база и якорь, прошлая отметка второй раз не вычитается', () => {
    const { store, card, rent, loan } = family()
    store.markPaid('obligation', rent, 'a', { accountId: card })
    expect(balance(store, card)).toBe(780_000)

    at('2026-09-24T09:00:00Z')
    store.setAccountAmount(card, 800_000)
    expect(balance(store, card)).toBe(800_000)
    expect(store.householdDoc.accounts[0]).toMatchObject({ amount: 800_000, amountSetAt: '2026-09-24T09:00:00.000Z' })

    at('2026-09-24T10:00:00Z')
    store.markPaid('credit', loan, 'a', { accountId: card })
    expect(balance(store, card)).toBe(742_000)
    // Аренда уже в сверенной сумме: снятие её отметки остаток не меняет.
    store.unmarkPaid('obligation', rent, '2026-09')
    expect(balance(store, card)).toBe(742_000)

    // Ручной ввод остатка долга — тоже якорь.
    at('2026-09-24T11:00:00Z')
    store.updateCredit(loan, { principal: 950_000 })
    expect(store.credits[0].principal).toBe(950_000)
    expect(store.householdDoc.credits[0].principalSetAt).toBe('2026-09-24T11:00:00.000Z')
  })

  it('тот же видимый остаток не пишет ни базу, ни якорь; переименование якорь не двигает', () => {
    const { store, card, rent } = family()
    store.markPaid('obligation', rent, 'a', { accountId: card })
    const before = JSON.stringify(store.householdDoc.accounts)
    at('2026-09-24T09:00:00Z')
    store.setAccountAmount(card, 780_000)
    expect(JSON.stringify(store.householdDoc.accounts)).toBe(before)

    const anchor = store.householdDoc.accounts[0].amountSetAt
    store.updateAccount(card, { name: 'Kaspi Gold' })
    expect(store.householdDoc.accounts[0]).toMatchObject({ name: 'Kaspi Gold', amount: 1_000_000, amountSetAt: anchor })
    expect(balance(store, card)).toBe(780_000)

    // Счёт до RP-06 без якоря: правка пишет ключ явным null — при слиянии победитель
    // не возьмёт чужой якорь к своей базе.
    store.mutateHouseholdDoc((doc) => {
      doc.accounts.push({ id: 'old', name: 'Старый', note: '', amount: 5_000, kind: 'cash', updatedAt: '2026-01-01T00:00:00Z' })
    })
    store.updateAccount('old', { note: 'в сейфе' })
    const old = store.householdDoc.accounts.find((a) => a.id === 'old')!
    expect('amountSetAt' in old && old.amountSetAt === null).toBe(true)
  })

  it('личный счёт: запись в общем документе, остаток уменьшается у владельца', () => {
    const { store, rent } = family()
    store.addAccount({ name: 'Моя карта', kind: 'card', amount: 300_000 }, true)
    const mine = store.privateAccounts[0].id
    at('2026-09-24T09:00:00Z')
    store.markPaid('obligation', rent, 'a', { accountId: mine })
    expect(store.privateAccounts[0].amount).toBe(80_000)
    expect(store.householdDoc.payments?.[0].accountId).toBe(mine)
    expect((store.privateDoc.accounts as { amount: number }[])[0].amount).toBe(300_000)
  })

  it('старые данные без payments и якорей открываются с теми же цифрами', () => {
    const store = useFinanceStore()
    const old = {
      people: [{ id: 'a' as const, name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '2026-01-01T00:00:00Z' }],
      categories: [],
      goals: [],
      wishlist: [],
      obligations: [],
      accounts: [{ id: 'k', name: 'Kaspi', note: '', amount: 400_000, kind: 'card' as const, updatedAt: '2026-01-01T00:00:00Z' }],
      credits: [{ id: 'c', name: 'Кредит', note: '', principal: 500_000, annualRate: 0.2, payment: 30_000, day: 5, updatedAt: '2026-01-01T00:00:00Z' }],
      setupDoneAt: '2026-01-01T00:00:00Z',
    } satisfies SyncDoc
    store.setHouseholdDoc(old, 3)
    expect(store.payments).toEqual([])
    expect(store.accounts[0].amount).toBe(400_000)
    expect(store.credits[0].principal).toBe(500_000)
    expect(defaultSyncDoc().payments).toEqual([])
  })

  it('RP-08: досрочка «сократить срок» — остаток и срок меньше, карта уменьшилась; снятие возвращает всё', () => {
    const { store, card, loan } = family()
    const monthsBefore = Math.ceil(annuityMonths(1_000_000, 0.33, 58_000))
    const plan = lumpPlan(1_000_000, 0.33, 58_000, 200_000, 'term')!
    const rec = store.applyPrepayment(loan, 'a', { amount: 200_000, mode: 'term', accountId: card })!
    expect(rec).toMatchObject({ kind: 'prepay', targetId: loan, period: '2026-09', amount: 200_000, principal: 200_000, saved: plan.saved, mode: 'term' })
    expect(rec.prevPayment).toBeUndefined()

    const c = store.credits[0]
    expect(c.principal).toBe(800_000)
    expect(c.payment).toBe(58_000)
    expect(Math.ceil(annuityMonths(c.principal, c.annualRate, c.payment))).toBe(plan.months)
    expect(plan.months).toBeLessThan(monthsBefore)
    expect(balance(store, card)).toBe(800_000)
    expect(prepaySaved(store.payments, store.credits)).toBe(plan.saved)

    at('2026-09-24T09:00:00Z')
    store.removePrepayment(rec.id)
    expect(store.credits[0].principal).toBe(1_000_000)
    expect(balance(store, card)).toBe(1_000_000)
    expect(prepaySaved(store.payments, store.credits)).toBe(0)
  })

  it('RP-08: «снизить платёж» меняет платёж кредита; снятие возвращает и его', () => {
    const { store, card, loan } = family()
    const rec = store.applyPrepayment(loan, 'a', { amount: 200_000, mode: 'payment', accountId: card })!
    expect(rec).toMatchObject({ mode: 'payment', prevPayment: 58_000, newPayment: 46_400 })
    expect(store.credits[0]).toMatchObject({ principal: 800_000, payment: 46_400 })
    // Следующая отметка «оплатил» — уже новым платежом.
    expect(store.markPaid('credit', loan, 'a', { accountId: card })!.amount).toBe(46_400)

    at('2026-09-24T09:00:00Z')
    store.unmarkPaid('credit', loan, '2026-09')
    store.removePrepayment(rec.id)
    expect(store.credits[0]).toMatchObject({ principal: 1_000_000, payment: 58_000 })
    expect(balance(store, card)).toBe(1_000_000)
  })

  it('RP-08: платёж, изменённый после досрочки, снятие не затирает; счёт по умолчанию — прошлой оплаты кредита', () => {
    const { store, cash, loan } = family()
    store.markPaid('credit', loan, 'a', { accountId: cash })
    at('2026-09-24T09:00:00Z')
    const rec = store.applyPrepayment(loan, 'a', { amount: 100_000, mode: 'payment' })!
    expect(rec.accountId).toBe(cash)
    at('2026-09-24T10:00:00Z')
    store.updateCredit(loan, { payment: 40_000 })
    store.removePrepayment(rec.id)
    expect(store.credits[0].payment).toBe(40_000)
  })

  it('удалённое обязательство и закрытый кредит отметить нельзя', () => {
    const { store, rent, loan } = family()
    store.removeObligation(rent)
    expect(store.markPaid('obligation', rent, 'a')).toBeNull()
    store.updateCredit(loan, { principal: 0 })
    expect(store.markPaid('credit', loan, 'a')).toBeNull()
    expect(store.payments).toHaveLength(0)
  })

  it('RP-09: группа — создать, положить, вынуть (null), удалить; подписки остаются; группу не отметить', () => {
    const store = useFinanceStore()
    store.addObligation({ name: 'Netflix', day: 10, category: 'd4', amount: 4_990 })
    store.addObligation({ name: 'Slack', day: 3, category: 'd4', amount: 3_000 })
    // Заведённая подписка уже «оставлена» — сразу не спрашивается.
    expect(store.obligations[0].keptAt).toBe('2026-09-24T07:00:00.000Z')
    const [netflix, slack] = store.obligations.map((o) => o.id)
    const fun = store.addGroup('Досуг')
    const work = store.addGroup('Рабочие', true)
    expect(store.obligations.find((o) => o.id === work)).toMatchObject({ group: true, noAsk: true, versions: [] })

    store.moveToGroup(netflix, fun)
    store.moveToGroup(slack, work)
    expect(store.obligations.find((o) => o.id === netflix)!.parentId).toBe(fun)
    store.moveToGroup(netflix, null)
    // Вынуть — явный null: при слиянии не воскреснет прежняя группа.
    expect(store.obligations.find((o) => o.id === netflix)!.parentId).toBeNull()

    expect(store.markPaid('obligation', work, 'a', { period: '2026-09', accountId: null })).toBeNull()

    at('2026-09-24T09:00:00Z')
    store.removeGroup(work)
    expect(store.obligations.find((o) => o.id === work)!.deletedAt).toBe('2026-09-24T09:00:00.000Z')
    expect(store.obligations.find((o) => o.id === slack)).toMatchObject({ parentId: null })
    expect(store.obligations.find((o) => o.id === slack)!.deletedAt).toBeFalsy()
  })

  it('RP-09: «оставить» пишет keptAt в общий документ', () => {
    const store = useFinanceStore()
    store.addObligation({ name: 'Netflix', day: 10, category: 'd4', amount: 4_990 })
    at('2026-12-01T07:00:00Z')
    store.keepSubscription(store.obligations[0].id)
    expect(store.householdDoc.obligations[0].keptAt).toBe('2026-12-01T07:00:00.000Z')
    expect(store.unsent).toBe(true)
  })

  // Критик Блока 1 (dfc7ab0): сдвиг остатка без якоря и правка отметки с моментом оплаты.
  describe('shiftAccountAmount: сдвиг остатка — не сверка', () => {
    // Микрозадачи мок-ответа pushPrivateDoc; таймеры не крутим — иначе ушёл бы синк в сеть.
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    it('взнос в цель после отметки, затем снятие отметки — деньги вернулись; якорь прежний', () => {
      const { store, card, rent } = family()
      const anchor = store.householdDoc.accounts[0].amountSetAt
      expect(anchor).toBe('2026-09-24T07:00:00.000Z')
      store.markPaid('obligation', rent, 'a', { accountId: card })
      expect(balance(store, card)).toBe(780_000)

      at('2026-09-24T09:00:00Z')
      store.shiftAccountAmount(card, -50_000) // как взнос в цель со счёта
      expect(balance(store, card)).toBe(730_000)
      expect(store.householdDoc.accounts[0]).toMatchObject({
        amount: 950_000, amountSetAt: anchor, updatedAt: '2026-09-24T09:00:00.000Z',
      })

      at('2026-09-24T10:00:00Z')
      store.unmarkPaid('obligation', rent, '2026-09')
      // Со сверкой «сейчас» отметка осталась бы в базе и остаток был бы 730 000.
      expect(balance(store, card)).toBe(950_000)
      expect(store.householdDoc.accounts[0].amountSetAt).toBe(anchor)
    })

    it('шаг вниз ниже нуля видимого остатка обрезается до 0; дальше вниз — ничего не пишется', () => {
      const { store, card, rent } = family()
      store.markPaid('obligation', rent, 'a', { accountId: card })
      at('2026-09-24T09:00:00Z')
      store.shiftAccountAmount(card, -2_000_000)
      expect(balance(store, card)).toBe(0)
      // База сдвинута ровно на видимые 780 000, а не на 2 000 000.
      expect(store.householdDoc.accounts[0].amount).toBe(220_000)

      at('2026-09-24T10:00:00Z')
      const before = JSON.stringify(store.householdDoc)
      store.shiftAccountAmount(card, -10_000)
      expect(JSON.stringify(store.householdDoc)).toBe(before)
      // Шаг вверх от нуля — как доход.
      store.shiftAccountAmount(card, 15_000)
      expect(balance(store, card)).toBe(15_000)
    })

    it('нулевая дельта и чужой id ничего не пишут', () => {
      const { store, card } = family()
      store.setHouseholdDoc(store.householdDoc, 3) // «отправлено»: чистое состояние
      at('2026-09-24T09:00:00Z')
      const before = JSON.stringify(store.householdDoc)
      store.shiftAccountAmount(card, 0)
      store.shiftAccountAmount('нет-такого', 10_000)
      expect(JSON.stringify(store.householdDoc)).toBe(before)
      expect(store.status).toBe('idle')
      expect(store.unsent).toBe(false)
    })

    it('общий счёт: правка помечает общий документ неотправленным', () => {
      const { store, card } = family()
      store.setHouseholdDoc(store.householdDoc, 3)
      store.shiftAccountAmount(card, 30_000)
      expect(balance(store, card)).toBe(1_030_000)
      expect(store.unsent).toBe(true)
      expect(store.status).toBe('dirty')
    })

    it('личный счёт: сдвигается в личном документе, якорь прежний, privateUnsent — как у обычной правки', async () => {
      const push = vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
        household_id: 'h-1', user_id: 'u-1', rev: rev + 1, data, updated_at: '2026-09-24T08:00:00Z',
      }))
      try {
        const { store, rent } = family()
        store.addAccount({ name: 'Моя карта', kind: 'card', amount: 300_000 }, true)
        const mine = store.privateAccounts[0].id
        await flush()
        expect(store.privateUnsent).toBe(false)
        at('2026-09-24T09:00:00Z')
        store.markPaid('obligation', rent, 'a', { accountId: mine })
        expect(store.privateAccounts[0].amount).toBe(80_000)
        store.setHouseholdDoc(store.householdDoc, 3)
        push.mockClear()

        at('2026-09-24T10:00:00Z')
        store.shiftAccountAmount(mine, -50_000)
        expect(store.privateUnsent).toBe(true)
        expect(store.unsent).toBe(false)
        expect(store.privateAccounts[0].amount).toBe(30_000)
        const raw = (store.privateDoc.accounts as { amount: number; amountSetAt: string }[])[0]
        expect(raw).toMatchObject({ amount: 250_000, amountSetAt: '2026-09-24T08:00:00.000Z' })
        // Общий документ личным счётом не тронут.
        expect(store.householdDoc.accounts.map((a) => a.id)).not.toContain(mine)
        expect(push).toHaveBeenCalledTimes(1)
        await flush()
        expect(store.privateUnsent).toBe(false)

        // Ниже нуля — обрезка до 0, как у общего.
        store.shiftAccountAmount(mine, -100_000)
        expect(store.privateAccounts[0].amount).toBe(0)
      } finally {
        push.mockRestore()
      }
    })
  })

  describe('editPaid: правка отметки — новая запись с моментом исходной', () => {
    it('без сверки 220 000 → 225 000: карта −5 000, новая запись с at исходной, старая — надгробие', () => {
      const { store, card, rent } = family()
      const rec = store.markPaid('obligation', rent, 'a', { accountId: card })!
      expect(balance(store, card)).toBe(780_000)

      at('2026-09-24T09:00:00Z')
      const next = store.editPaid(rec, { amount: 225_000, accountId: card })!
      expect(next.id).not.toBe(rec.id)
      expect(next).toMatchObject({
        kind: 'obligation', targetId: rent, period: '2026-09', amount: 225_000, accountId: card, by: 'a',
        at: '2026-09-24T08:00:00.000Z', updatedAt: '2026-09-24T09:00:00.000Z',
      })
      expect(balance(store, card)).toBe(775_000)
      const raw = store.householdDoc.payments!
      expect(raw).toHaveLength(2)
      expect(raw.find((p) => p.id === rec.id)).toMatchObject({
        amount: 220_000, deletedAt: '2026-09-24T09:00:00.000Z', updatedAt: '2026-09-24T09:00:00.000Z',
      })
      expect(raw.find((p) => p.id === next.id)!.deletedAt).toBeUndefined()
    })

    it('после сверки: та же сумма и счёт — ничего не пишет', () => {
      const { store, card, rent } = family()
      const rec = store.markPaid('obligation', rent, 'a', { accountId: card })!
      at('2026-09-24T09:00:00Z')
      store.setAccountAmount(card, 800_000)
      store.setHouseholdDoc(store.householdDoc, 3)
      const before = JSON.stringify(store.householdDoc)

      at('2026-09-24T10:00:00Z')
      expect(store.editPaid(rec, { amount: 220_000, accountId: card })).toBe(rec)
      expect(JSON.stringify(store.householdDoc)).toBe(before)
      expect(store.payments).toHaveLength(1)
      expect(store.status).toBe('idle')
      expect(store.unsent).toBe(false)
      expect(balance(store, card)).toBe(800_000)
    })

    it('после сверки: правка на 210 000 не списывает второй раз — карта равна сверенной', () => {
      const { store, card, rent } = family()
      const rec = store.markPaid('obligation', rent, 'a', { accountId: card })!
      at('2026-09-24T09:00:00Z')
      store.setAccountAmount(card, 800_000)

      at('2026-09-24T10:00:00Z')
      const next = store.editPaid(rec, { amount: 210_000, accountId: card })!
      expect(next.amount).toBe(210_000)
      expect(next.at).toBe('2026-09-24T08:00:00.000Z')
      expect(balance(store, card)).toBe(800_000)
    })

    it('смена счёта без сверки: деньги ушли с нового счёта и вернулись на старый', () => {
      const { store, card, rent } = family()
      store.addAccount({ name: 'Halyk', kind: 'card', amount: 500_000 })
      const halyk = store.accounts[2].id
      const rec = store.markPaid('obligation', rent, 'a', { accountId: card })!
      expect(balance(store, card)).toBe(780_000)

      at('2026-09-24T09:00:00Z')
      const next = store.editPaid(rec, { amount: 220_000, accountId: halyk })!
      expect(next).toMatchObject({ amount: 220_000, accountId: halyk, at: '2026-09-24T08:00:00.000Z' })
      expect(balance(store, card)).toBe(1_000_000)
      expect(balance(store, halyk)).toBe(280_000)
      // Счёт по умолчанию следующей оплаты — уже новый (Р-5).
      at('2026-10-05T05:00:00Z')
      expect(store.markPaid('obligation', rent, 'a')!.accountId).toBe(halyk)
    })

    it('кредит: смена счёта долг не меняет; другая сумма — тело за вычетом процентов сентябрьской записи', () => {
      const { store, card, loan } = family()
      store.addAccount({ name: 'Halyk', kind: 'card', amount: 500_000 })
      const halyk = store.accounts[2].id
      const sep = store.markPaid('credit', loan, 'a', { accountId: card })!
      expect(sep).toMatchObject({ amount: 58_000, principal: 30_500 }) // проценты 27 500
      at('2026-10-15T05:00:00Z')
      const oct = store.markPaid('credit', loan, 'a', { accountId: card })!
      expect(oct).toMatchObject({ amount: 58_000, principal: 31_339 }) // проценты 26 661
      expect(store.credits[0].principal).toBe(938_161)

      // Та же сумма, другой счёт: проценты сентября — из записи (27 500), а не от
      // остатка без сентября (968 661 × 0,33 / 12 = 26 638) — тело то же.
      at('2026-10-16T05:00:00Z')
      const moved = store.editPaid(sep, { amount: 58_000, accountId: halyk })!
      expect(moved).toMatchObject({ period: '2026-09', amount: 58_000, principal: 30_500, accountId: halyk, at: sep.at })
      expect(store.credits[0].principal).toBe(938_161)
      expect(balance(store, card)).toBe(942_000)
      expect(balance(store, halyk)).toBe(442_000)

      // 60 000: тело = 60 000 − 27 500 = 32 500.
      at('2026-10-17T05:00:00Z')
      const more = store.editPaid(moved, { amount: 60_000, accountId: halyk })!
      expect(more).toMatchObject({ amount: 60_000, principal: 32_500 })
      expect(store.credits[0].principal).toBe(1_000_000 - 32_500 - 31_339)
      expect(store.credits[0].principal).toBe(936_161)
      expect(balance(store, halyk)).toBe(440_000)
      // В базе долга по-прежнему исходный миллион, живых записей — две.
      expect(store.householdDoc.credits[0].principal).toBe(1_000_000)
      expect(store.payments.filter((p) => !p.deletedAt)).toHaveLength(2)
    })

    it('досрочку правкой отметки не поправить — null, ничего не пишется', () => {
      const { store, card, loan } = family()
      const rec = store.applyPrepayment(loan, 'a', { amount: 100_000, mode: 'term', accountId: card })!
      const before = JSON.stringify(store.householdDoc)
      at('2026-09-24T09:00:00Z')
      expect(store.editPaid(rec, { amount: 50_000, accountId: card })).toBeNull()
      expect(JSON.stringify(store.householdDoc)).toBe(before)
      expect(store.credits[0].principal).toBe(900_000)
    })
  })

  it('кредит «оплатил» другой суммой (70 000): проценты по графику, остальное в тело', () => {
    const { store, card, loan } = family()
    const rec = store.markPaid('credit', loan, 'a', { amount: 70_000, accountId: card })!
    // 1 000 000 × 0,33 / 12 = 27 500 процентов, тело 42 500.
    expect(rec).toMatchObject({ period: '2026-09', amount: 70_000, principal: 42_500 })
    expect(store.credits[0].principal).toBe(957_500)
    expect(balance(store, card)).toBe(930_000)
    // Платёж кредита по графику не изменился.
    expect(store.credits[0].payment).toBe(58_000)
  })

  it('досрочка больше остатка (1 200 000, «снизить платёж») — списывается ровно долг, платёж не трогается', () => {
    const { store, card, loan } = family()
    const rec = store.applyPrepayment(loan, 'a', { amount: 1_200_000, mode: 'payment', accountId: card })!
    expect(rec).toMatchObject({ kind: 'prepay', amount: 1_000_000, principal: 1_000_000, mode: 'payment' })
    expect(rec.prevPayment).toBeUndefined()
    expect(rec.newPayment).toBeUndefined()
    expect(balance(store, card)).toBe(0)
    expect(store.credits[0]).toMatchObject({ principal: 0, payment: 58_000 })
    // Закрытый долг платежа не ждёт.
    expect(store.markPaid('credit', loan, 'a')).toBeNull()
  })

  describe('граница месяца по Алматы (UTC+5), а не по поясу машины', () => {
    it('30 сентября 19:30Z = 1 октября 00:30 в Алматы: отметка и досрочка — октябрь', () => {
      const { store, card, rent, loan } = family()
      at('2026-09-30T19:30:00Z')
      expect(store.markPaid('obligation', rent, 'a', { accountId: card })!.period).toBe('2026-10')
      expect(store.markPaid('credit', loan, 'a', { accountId: card })!.period).toBe('2026-10')
      expect(store.applyPrepayment(loan, 'a', { amount: 100_000, mode: 'term', accountId: card })!.period).toBe('2026-10')
    })

    it('30 сентября 18:30Z = 23:30 в Алматы: ещё сентябрь', () => {
      const { store, card, rent, loan } = family()
      at('2026-09-30T18:30:00Z')
      expect(store.markPaid('obligation', rent, 'a', { accountId: card })!.period).toBe('2026-09')
      expect(store.markPaid('credit', loan, 'a', { accountId: card })!.period).toBe('2026-09')
      expect(store.applyPrepayment(loan, 'a', { amount: 100_000, mode: 'term', accountId: card })!.period).toBe('2026-09')
    })
  })
})

describe('PV-04: накопленное в цели не уходит в минус', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('снять больше накопленного — 0, движение записано полной суммой; следующий взнос — от seed + Σ, не от 0', () => {
    const store = useFinanceStore()
    store.addGoal({ name: 'Отпуск', need: 1_000_000, have: 100_000, monthly: 50_000, hue: 'teal' })
    const id = store.goals[0].id

    store.withdraw(id, 150_000, 'a')
    expect(store.goals[0].have).toBe(0)
    expect(store.goals[0].movements.map((m) => m.amount)).toEqual([-150_000])

    // 100 000 − 150 000 + 80 000 = 30 000: история не режется, минус не «прощается».
    store.contribute(id, 80_000, 'b')
    expect(store.goals[0].have).toBe(30_000)
    expect(goalHave(store.goals[0].seed, store.goals[0].movements)).toBe(30_000)

    // Слияние с самим собой (как второй телефон после синка) — то же число.
    const merged = mergeDocs(JSON.parse(JSON.stringify(store.householdDoc)), JSON.parse(JSON.stringify(store.householdDoc)))
    expect(merged.goals[0].have).toBe(30_000)
  })
})

describe('PV-10: правка кредита — якорь только у остатка', () => {
  const storage = new Map<string, string>()
  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Кредит 1 000 000 под 33% с отметкой за сентябрь: производный остаток 969 500. */
  function paidLoan() {
    const store = useFinanceStore()
    store.addAccount({ name: 'Kaspi', kind: 'card', amount: 1_000_000 })
    store.addCredit({ name: 'Кредит', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15 })
    const id = store.credits[0].id
    at('2026-09-24T08:00:00Z')
    store.markPaid('credit', id, 'a', { accountId: store.accounts[0].id })
    expect(store.credits[0].principal).toBe(969_500)
    return { store, id, anchor: store.householdDoc.credits[0].principalSetAt }
  }

  it('день, ставка, платёж, название, примечание — не двигают якорь и производный остаток', () => {
    const { store, id, anchor } = paidLoan()
    let t = 9
    for (const patch of [{ day: 20 }, { annualRate: 0.25 }, { payment: 60_000 }, { name: 'Халык' }, { note: 'авто' }]) {
      at(`2026-09-24T${String(t++).padStart(2, '0')}:00:00Z`)
      store.updateCredit(id, patch)
      expect(store.householdDoc.credits[0]).toMatchObject(patch)
      expect(store.householdDoc.credits[0].principalSetAt).toBe(anchor)
      // База прежняя, отметка до якоря по-прежнему вычитается.
      expect(store.householdDoc.credits[0].principal).toBe(1_000_000)
      expect(store.credits[0].principal).toBe(969_500)
    }
  })

  it('остаток — сверка: новая база и якорь, отметки до якоря больше не вычитаются', () => {
    const { store, id, anchor } = paidLoan()
    at('2026-09-25T08:00:00Z')
    store.updateCredit(id, { principal: 950_000 })
    expect(store.householdDoc.credits[0].principalSetAt).toBe('2026-09-25T08:00:00.000Z')
    expect(store.householdDoc.credits[0].principalSetAt).not.toBe(anchor)
    expect(store.credits[0].principal).toBe(950_000)
  })

  it('тот же патч ничего не пишет: updatedAt прежний; тот же видимый остаток — без якоря', () => {
    const { store, id, anchor } = paidLoan()
    at('2026-09-24T09:00:00Z')
    store.updateCredit(id, { day: 20, annualRate: 0.25 })
    const stamp = store.householdDoc.credits[0].updatedAt
    at('2026-09-24T10:00:00Z')
    store.updateCredit(id, { day: 20, annualRate: 0.25 })
    // Видимый остаток 969 500 — не сверка, а тот же остаток.
    store.updateCredit(id, { principal: 969_500 })
    expect(store.householdDoc.credits[0].updatedAt).toBe(stamp)
    expect(store.householdDoc.credits[0].principalSetAt).toBe(anchor)
    expect(store.householdDoc.credits[0].principal).toBe(1_000_000)
  })
})

describe('PV-11: платёж — раздел, оценка, правка обязательства', () => {
  const storage = new Map<string, string>()
  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('раздел и оценка из формы: «Оставить?» спрашивает только о подписке (быт, без оценки)', async () => {
    const { isSubscription, keepQuestions } = await import('@/lib/finance')
    const store = useFinanceStore()
    store.addObligation({ name: 'Интернет', day: 10, category: 'd4', amount: 7_000 })
    store.addObligation({ name: 'Коммуналка', day: 8, category: 'd4', estimate: true, amount: 35_000 })
    store.addObligation({ name: 'Аренда', day: 5, category: 'd1', amount: 220_000 })
    const [internet, util, rent] = store.obligations
    expect(util.estimate).toBe(true)
    expect(rent.category).toBe('d1')
    expect([internet, util, rent].map(isSubscription)).toEqual([true, false, false])

    // Новый квартал — вопрос о подписках, заведённых в прошлом.
    expect(keepQuestions(store.obligations, new Date('2026-10-05T07:00:00Z')).map((o) => o.name)).toEqual(['Интернет'])
  })

  it('«Раз в год» с месяцем — следующий платёж в месяц списания; «Каждый месяц» — снова ежемесячно', () => {
    const store = useFinanceStore()
    store.addObligation({ name: 'Страховка', day: 12, category: 'd4', amount: 60_000 })
    const id = store.obligations[0].id
    expect(nextObligationDue(store.obligations[0], store.payments)).toMatchObject({ period: '2026-09', day: 12 })

    at('2026-09-24T08:00:00Z')
    store.updateObligation(id, { every: 'year', month: 3 })
    expect(nextObligationDue(store.obligations[0], store.payments)).toMatchObject({ period: '2027-03', day: 12 })

    at('2026-09-24T09:00:00Z')
    store.updateObligation(id, { every: 'month' })
    expect(nextObligationDue(store.obligations[0], store.payments)).toMatchObject({ period: '2026-09' })
  })

  it('повторная правка тем же значением ничего не пишет; «Чьё это» — null, не undefined', () => {
    const store = useFinanceStore()
    store.people.push({ id: 'b', name: 'Аруна', salary: 0, payday: 20, updatedAt: '2026-09-01T00:00:00Z' })
    store.addObligation({ name: 'Спортзал', day: 3, category: 'd4', amount: 15_000, who: 'b' })
    const id = store.obligations[0].id

    at('2026-09-24T08:00:00Z')
    store.updateObligation(id, { day: 20, who: null })
    const stamp = store.obligations[0].updatedAt
    expect(store.obligations[0].who).toBeNull()
    // Слияние возьмёт null победителя, а не «b» проигравшего (Р-14 RP, mergeList).
    expect(JSON.parse(JSON.stringify(store.householdDoc)).obligations[0].who).toBeNull()

    at('2026-09-24T09:00:00Z')
    store.updateObligation(id, { day: 20, who: null })
    expect(store.obligations[0].updatedAt).toBe(stamp)
  })
})
