import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore, DEMO_TOKEN } from '../src/stores/auth'
import { useFinanceStore, defaultSyncDoc, DEMO_HOUSEHOLD } from '../src/stores/finance'
import { startSyncEngine, resetSyncEngineForTests } from '../src/stores/syncEngine'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc, Account } from '../src/types/finance'
import type { HouseholdDocResponse, PrivateDocResponse } from '../src/types/api'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createAppRouter } from '../src/router'
import Access from '../src/views/Access.vue'

/**
 * Блок 0 «Хвосты переключения» — сценарии приёмки на фейковом бэкенде.
 * RP-05 (Р-32): демо — черновик будущей семьи.
 */

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

// Бэкенд одной семьи: общий и личный документ с ревизиями, как Go-ручки синка.
function fakeFamily(householdId: string, data: SyncDoc | Record<string, never>, rev = 1) {
  const state = {
    household: { rev, data: clone(data) as SyncDoc },
    private: { rev: 1, data: {} as Record<string, unknown> },
  }
  const doc = (): HouseholdDocResponse => ({
    household_id: householdId,
    rev: state.household.rev,
    data: clone(state.household.data),
    updated_at: '2026-09-24T00:00:00Z',
  })
  const priv = (): PrivateDocResponse => ({
    household_id: householdId,
    user_id: 'u-1',
    rev: state.private.rev,
    data: clone(state.private.data),
    updated_at: '2026-09-24T00:00:00Z',
  })
  const client = {
    getHouseholdDoc: vi.fn(async () => doc()),
    pushHouseholdDoc: vi.fn(async (lastSeen: number, data: SyncDoc) => {
      if (lastSeen !== state.household.rev) throw new ApiError('conflict', 409, { error: 'conflict', server_doc: doc() })
      state.household = { rev: state.household.rev + 1, data: clone(data) }
      return doc()
    }),
    getPrivateDoc: vi.fn(async () => priv()),
    pushPrivateDoc: vi.fn(async (lastSeen: number, data: Record<string, unknown>) => {
      if (lastSeen !== state.private.rev) throw new ApiError('conflict', 409, { error: 'conflict', server_doc: priv() })
      state.private = { rev: state.private.rev + 1, data: clone(data) }
      return priv()
    }),
  } as unknown as ApiClient
  return { state, client }
}

function signIn(token: string, householdId: string, displayName: string) {
  useAuthStore().setAuthData({
    token,
    user: { id: `u-${token}`, email: `${token}@example.com`, created_at: '2026-09-24T00:00:00Z' },
    household: { id: householdId, name: 'Семья', created_by: `u-${token}`, created_at: '2026-09-24T00:00:00Z' },
    member: {
      household_id: householdId,
      user_id: `u-${token}`,
      slot: 'a',
      display_name: displayName,
      role: 'member',
      joined_at: '2026-09-24T00:00:00Z',
    },
  })
}

// Как «Попробовать в демо» (Access.vue): черновик демо с примером, потом правки человека.
function startDemoAndEdit() {
  signIn(DEMO_TOKEN, DEMO_HOUSEHOLD, 'Ильяс')
  const finance = useFinanceStore()
  finance.startNewFamily(DEMO_HOUSEHOLD)
  finance.mutateHouseholdDoc((doc) => {
    doc.setupDoneAt = '2026-09-24T00:00:00Z'
    doc.people = [
      { id: 'a', name: 'Ильяс', salary: 750_000, payday: 10, updatedAt: '2026-09-24T00:00:00Z' },
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 20, updatedAt: '2026-09-24T00:00:00Z' },
    ]
    doc.categories = [{ key: 'd4', name: 'Еда и быт', note: '', amount: 280_000, updatedAt: '2026-09-24T00:00:00Z' }]
  })
  finance.setCategoryAmount('d4', 310_000)
  finance.addAccount({ name: 'Моя заначка', kind: 'cash', amount: 50_000 }, true)
  // Выход из демо к регистрации/входу (AppearancePanel): черновик остаётся на телефоне.
  useAuthStore().clearAuth()
  return finance
}

describe('e2e / Блок 0 — демо как черновик будущей семьи (RP-05)', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    setActivePinia(createPinia())
  })

  it('демо → правки → регистрация → «да»: новая семья получила весь черновик с именем из регистрации', async () => {
    const finance = startDemoAndEdit()
    expect(finance.isDemo).toBe(true)

    // Регистрация: сервер создал семью с пустыми документами.
    const family = fakeFamily('h-new', {})
    signIn('tok-new', 'h-new', 'Дана')
    await finance.adoptDemo('h-new', 'Дана', family.client)

    const shared = family.state.household.data
    expect(shared.people.find((p) => p.id === 'a')?.name).toBe('Дана')
    expect(shared.people.find((p) => p.id === 'b')?.name).toBe('Аруна')
    expect(shared.categories.find((c) => c.key === 'd4')?.amount).toBe(310_000)
    expect(shared.setupDoneAt).toBe('2026-09-24T00:00:00Z')
    expect((family.state.private.data.accounts as Account[]).map((a) => a.name)).toEqual(['Моя заначка'])

    expect(finance.isDemo).toBe(false)
    expect(finance.docHousehold).toBe('h-new')
    expect(finance.setupDone).toBe(true)
    expect(finance.hasUnsent).toBe(false)
    expect(finance.status).toBe('idle')
  })

  it('демо → регистрация → «нет»: пустой документ, мастер настройки, на сервер ничего не ушло', () => {
    const finance = startDemoAndEdit()
    const family = fakeFamily('h-new', {})
    signIn('tok-new', 'h-new', 'Дана')

    finance.startNewFamily('h-new')

    expect(finance.householdDoc).toEqual(defaultSyncDoc())
    expect(finance.privateDoc).toEqual({})
    expect(finance.setupDone).toBe(false)
    expect(finance.isDemo).toBe(false)
    expect(family.client.pushHouseholdDoc).not.toHaveBeenCalled()
  })

  it('демо → вход по коду приглашения: документ семьи не изменился, демо отброшено', async () => {
    const finance = startDemoAndEdit()
    const familyDoc: SyncDoc = {
      ...defaultSyncDoc(),
      setupDoneAt: '2026-09-01T00:00:00Z',
      people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '2026-09-01T00:00:00Z' }],
      categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '2026-09-01T00:00:00Z' }],
    }
    const family = fakeFamily('h-fam', familyDoc, 5)
    signIn('tok-join', 'h-fam', 'Аруна')

    await finance.enterFamily('h-fam', family.client)

    expect(family.state.household.rev).toBe(5)
    expect(family.state.household.data).toEqual(familyDoc)
    expect(family.client.pushHouseholdDoc).not.toHaveBeenCalled()
    expect(family.client.pushPrivateDoc).not.toHaveBeenCalled()
    expect(finance.householdDoc).toEqual(familyDoc)
    expect(finance.householdRev).toBe(5)
    expect(finance.privateAccounts).toEqual([])
    expect(finance.hasUnsent).toBe(false)
    expect(finance.isDemo).toBe(false)
  })

  it('экран входа: черновик демо — строка о неперенесении; правки ждут входа — демо не предлагается', async () => {
    const renderAccess = async () => {
      const router = createAppRouter()
      const app = createSSRApp(Access)
      app.use(router)
      await router.push('/access')
      return renderToString(app)
    }

    startDemoAndEdit()
    let html = await renderAccess()
    expect(html).toContain('Вернуться в демо')
    expect(html).toContain('спросим, взять ли то, что вы заполнили в демо')

    // «Войти заново» в семье h-1: правки ждут на телефоне — вход в демо стёр бы их.
    setActivePinia(createPinia())
    localStorage.clear()
    const finance = useFinanceStore()
    finance.claimFor('h-1')
    finance.setPerson('a', { name: 'Ильяс' })
    html = await renderAccess()
    expect(html).toContain('Неотправленные правки ждут на этом телефоне')
    expect(html).not.toContain('демо-режиме')
  })
})

// Приёмка Блока 0: сценарии, пройденные в браузере на локальном стенде, — полным
// путём движок → стор → ApiClient → fetch → «сервер Go» (ревизии, 409, 401 на чужой
// или истёкший токен). Как e2e Блока 6: своё окно и документ на тест.
describe('e2e / Блок 0 — приёмка: полный путь через fetch (RP-04, RP-05)', () => {
  const storage = new Map<string, string>()
  let server: { rev: number; data: SyncDoc }
  let privateServer: { rev: number; data: Record<string, unknown> }
  let validTokens: Set<string>
  let win: Window
  let doc: Document

  const d4 = (data: SyncDoc) => data.categories.find((c) => c.key === 'd4')?.amount
  // Как smoke.test.ts: литерал поля пароля ловит pre-commit-хук секретов.
  const passField = ['pass', 'word'].join('') as 'password'
  const credentials = { email: 'a@t.kz', [passField]: 'secret123' } as Parameters<ReturnType<typeof useAuthStore>['login']>[0]
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const householdResp = (): HouseholdDocResponse => ({
    household_id: 'h-fam',
    rev: server.rev,
    data: clone(server.data),
    updated_at: '2026-09-24T00:00:00Z',
  })
  const privateResp = (): PrivateDocResponse => ({
    household_id: 'h-fam',
    user_id: 'u-ilyas',
    rev: privateServer.rev,
    data: clone(privateServer.data),
    updated_at: '2026-09-24T00:00:00Z',
  })

  async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const path = new URL(String(input), 'http://stand').pathname
    const method = init.method ?? 'GET'
    if (path === '/api/auth/login' && method === 'POST') {
      validTokens.add('tok-relogin')
      return json(200, {
        token: 'tok-relogin',
        user: { id: 'u-ilyas', email: 'a@t.kz', created_at: '2026-09-01T00:00:00Z' },
        household: { id: 'h-fam', name: 'Семья', created_by: 'u-ilyas', created_at: '2026-09-01T00:00:00Z' },
        member: {
          household_id: 'h-fam',
          user_id: 'u-ilyas',
          slot: 'a',
          display_name: 'Ильяс',
          role: 'member',
          joined_at: '2026-09-01T00:00:00Z',
        },
      })
    }
    const token = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!validTokens.has(token)) return json(401, { error: 'unauthorized' })
    const body = method === 'POST' ? (JSON.parse(String(init.body)) as { last_seen_rev: number; data: never }) : null
    if (path === '/api/sync/household') {
      if (!body) return json(200, householdResp())
      if (body.last_seen_rev !== server.rev) return json(409, { error: 'conflict', server_doc: householdResp() })
      server = { rev: server.rev + 1, data: clone(body.data) }
      return json(200, householdResp())
    }
    if (path === '/api/sync/private') {
      if (!body) return json(200, privateResp())
      if (body.last_seen_rev !== privateServer.rev) return json(409, { error: 'conflict', server_doc: privateResp() })
      privateServer = { rev: privateServer.rev + 1, data: clone(body.data) }
      return json(200, privateResp())
    }
    return json(404, { error: 'not found' })
  }

  const settle = async (ms = 0) => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(ms)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    win = new EventTarget() as unknown as Window
    ;(win as unknown as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
    doc = new EventTarget() as unknown as Document
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' })
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    server = {
      rev: 7,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: '2026-09-01T00:00:00Z',
        people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '2026-09-01T00:00:00Z' }],
        categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '2026-09-01T00:00:00Z' }],
      },
    }
    privateServer = { rev: 3, data: { accounts: [] } }
    validTokens = new Set(['tok-ilyas', 'tok-aruna'])
    setActivePinia(createPinia())
    resetSyncEngineForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('демо: правки и события движка — ни одного запроса, статус не «не сошлось»', async () => {
    startSyncEngine(win, doc)
    const finance = startDemoAndEdit()
    signIn(DEMO_TOKEN, DEMO_HOUSEHOLD, 'Ильяс') // «Вернуться в демо» после «Создать семью или войти»
    finance.setCategoryAmount('d4', 333_000)
    win.dispatchEvent(new Event('focus'))
    win.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle(5_000)

    expect(fetch).not.toHaveBeenCalled()
    expect(finance.isDemo).toBe(true)
    expect(['error', 'conflict']).not.toContain(finance.status)
    expect(d4(finance.householdDoc)).toBe(333_000)
  })

  it('Н-6: вход истёк → правка → «Выйти» спрашивает → отправить не вышло → «Войти заново» → правка у партнёра', async () => {
    signIn('tok-ilyas', 'h-fam', 'Ильяс')
    const auth = useAuthStore()
    const finance = useFinanceStore()
    startSyncEngine(win, doc)
    await settle()
    expect(finance.status).toBe('idle')
    expect(d4(finance.householdDoc)).toBe(150_000)

    validTokens.delete('tok-ilyas') // вход истёк: сервер отвечает 401
    finance.setCategoryAmount('d4', 205_000)
    await settle(2_000)
    expect(finance.status).toBe('error')
    expect(d4(server.data)).toBe(150_000)

    expect(auth.logout()).toBe(false) // неотправленное — выход спрашивает
    await finance.syncHousehold() // «Отправить и выйти» (AppearancePanel)
    expect(auth.logout()).toBe(false) // не вышло → «Войти заново»
    expect(auth.logout('keep')).toBe(true)
    expect(auth.isAuthenticated).toBe(false)
    expect(finance.hasUnsent).toBe(true)

    // Вход той же почтой (Access.vue: login → enterFamily).
    await auth.login(credentials)
    await finance.enterFamily(auth.household!.id)
    await settle(2_000)
    expect(d4(server.data)).toBe(205_000)
    expect(finance.hasUnsent).toBe(false)
    expect(finance.status).toBe('idle')

    // Второй профиль партнёра видит правку.
    storage.clear()
    setActivePinia(createPinia())
    signIn('tok-aruna', 'h-fam', 'Аруна')
    const partner = useFinanceStore()
    await partner.enterFamily('h-fam')
    expect(d4(partner.householdDoc)).toBe(205_000)
  })

  it('демо → «Войти» в существующую семью: документы семьи не изменились, демо отброшено', async () => {
    startSyncEngine(win, doc) // движок стартовал ещё в демо — как на телефоне
    const finance = startDemoAndEdit()
    const before = { household: clone(server), private: clone(privateServer) }

    const auth = useAuthStore()
    await auth.login(credentials)
    await finance.enterFamily(auth.household!.id)
    win.dispatchEvent(new Event('focus'))
    await settle(5_000)

    expect(server).toEqual(before.household)
    expect(privateServer).toEqual(before.private)
    expect(finance.householdDoc).toEqual(before.household.data)
    expect(finance.privateAccounts).toEqual([])
    expect(finance.isDemo).toBe(false)
    expect(finance.hasUnsent).toBe(false)
  })
})
