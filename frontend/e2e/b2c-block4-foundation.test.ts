import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { startSyncEngine, resetSyncEngineForTests } from '../src/stores/syncEngine'
import { landingPath } from '../src/router/landing'
import type { SyncDoc } from '../src/types/finance'
import Access from '../src/views/Access.vue'
import Who from '../src/views/Who.vue'
import Settings from '../src/views/Settings.vue'
import Landing from '../src/views/Landing.vue'
import { DEMO_HOUSEHOLD } from '../src/stores/finance'
import { readDemoPending } from '../src/lib/storage'
import { screen } from './support/family'

/**
 * Приёмка Блока 4 (B2C-25) — «чужая семья» полным путём экран → стор → ApiClient → fetch → «Go».
 * Фальшивый Go держит то, что держит настоящий после B2C-22…24: вход Google (ID-токен
 * `id:<sub>:<email>`), семья по факту базы на каждом запросе (удалённый — 401, без семьи — 409),
 * «с кем», участники, удаление аккаунта.
 */
type User = { id: string; email: string; name: string; household: string | null; slot: string; role: 'member' | 'viewer' }
type Family = { id: string; rev: number; data: SyncDoc; privates: Map<string, { rev: number; data: Record<string, unknown> }> }

let users: Map<string, User>
let tokens: Map<string, string>
let families: Map<string, Family>
let invites: Map<string, string>
let posts: number
let seq: number

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const T = '2026-10-08T00:00:00Z'

function authResponse(u: User) {
  const token = `tok-${++seq}`
  tokens.set(token, u.id)
  const f = u.household ? families.get(u.household) : undefined
  return {
    token,
    user: { id: u.id, email: u.email, display_name: u.name, created_at: T },
    household: f ? { id: f.id, name: 'Наша казна', created_by: u.id, created_at: T } : null,
    member: f ? { household_id: f.id, user_id: u.id, slot: u.slot, display_name: u.name, role: u.role, joined_at: T } : null,
  }
}

function docResp(f: Family) {
  return { household_id: f.id, rev: f.rev, data: structuredClone(f.data), updated_at: T }
}

async function fakeGo(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = new URL(String(input), 'http://stand').pathname
  const method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(String(init.body)) : null

  if (path === '/api/auth/google' && method === 'POST') {
    const [, sub, email] = String(body.id_token).split(':')
    if (!sub || !email) return json(401, { error: 'invalid google token' })
    let u = users.get(sub)
    // Как Go (B2C-22): не нашли по sub — привязка по почте к старому пользователю.
    if (!u) {
      u = [...users.values()].find((o) => o.email === email)
      if (u) users.set(sub, u)
    }
    const created = !u
    if (!u) users.set(sub, (u = { id: sub, email, name: email.split('@')[0][0].toUpperCase() + email.split('@')[0].slice(1), household: null, slot: '', role: 'member' }))
    return json(created ? 201 : 200, authResponse(u))
  }

  // Мидлвар: пользователь и семья — из «базы», не из токена.
  const uid = tokens.get(new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? '')
  const u = uid ? users.get(uid) : undefined
  if (!u) return json(401, { error: 'unauthorized' })

  if (path === '/api/auth/me') return json(200, { ...authResponse(u), token: undefined })
  if (path === '/api/household' && method === 'POST') {
    if (u.household) return json(409, { error: 'already in household' })
    const id = `h-${++seq}`
    families.set(id, { id, rev: 1, data: {} as SyncDoc, privates: new Map([[u.id, { rev: 1, data: {} }]]) })
    Object.assign(u, { household: id, slot: 'a', role: 'member', name: body.display_name })
    return json(201, authResponse(u))
  }
  if (path === '/api/household/join' && method === 'POST') {
    if (u.household) return json(409, { error: 'already in household' })
    const hid = invites.get(String(body.code))
    if (!hid || !families.has(hid)) return json(404, { error: 'invite code not found' })
    invites.delete(String(body.code))
    const fam = families.get(hid)!
    // Как Go (ревью backend Б4 Н-3): полноправных участников не больше двух.
    if ([...users.values()].filter((o) => o.household === hid && o.role === 'member').length >= 2) return json(400, { error: 'household has maximum members' })
    // Как Go (В-1): слот занят участником или записью в `people` документа (ушедший её оставляет).
    const taken = new Set([...[...users.values()].filter((o) => o.household === hid).map((o) => o.slot), ...(fam.data.people ?? []).map((p) => p.id)])
    const slot = ['a', 'b', 'c'].find((s) => !taken.has(s))
    if (!slot) return json(400, { error: 'household has maximum members' })
    fam.privates.set(u.id, { rev: 1, data: {} })
    Object.assign(u, { household: hid, slot, role: 'member', name: body.display_name })
    const r = authResponse(u)
    return json(200, { token: r.token, member: r.member })
  }
  if (path === '/api/account' && method === 'DELETE') {
    const hid = u.household
    users.delete(u.id)
    if (hid && ![...users.values()].some((o) => o.household === hid)) {
      families.delete(hid)
      for (const [code, h] of invites) if (h === hid) invites.delete(code)
    } else if (hid) families.get(hid)!.privates.delete(u.id)
    return new Response(null, { status: 204 })
  }

  const f = u.household ? families.get(u.household) : undefined
  if (!f) return json(409, { error: 'no household' })
  if (path === '/api/household/invites' && method === 'POST') {
    const code = `CODE${++seq}`
    invites.set(code, f.id)
    return json(201, { code, expires_at: T })
  }
  if (path === '/api/household/members') {
    const members = [...users.values()].filter((o) => o.household === f.id).map((o) => ({ slot: o.slot, display_name: o.name, role: o.role, joined_at: T }))
    return json(200, { members })
  }
  if (path === '/api/sync/household') {
    if (method === 'GET') return json(200, docResp(f))
    if (u.role !== 'member') return json(403, { error: 'forbidden' })
    posts++
    if (body.last_seen_rev !== f.rev) return json(409, { error: 'conflict', server_doc: docResp(f) })
    f.rev++
    f.data = structuredClone(body.data)
    return json(200, docResp(f))
  }
  if (path === '/api/sync/private') {
    const p = f.privates.get(u.id) ?? { rev: 1, data: {} }
    const resp = () => ({ household_id: f.id, user_id: u.id, rev: p.rev, data: structuredClone(p.data), updated_at: T })
    if (method === 'GET') return json(200, resp())
    if (body.last_seen_rev !== p.rev) return json(409, { error: 'conflict', server_doc: resp() })
    p.rev++
    p.data = structuredClone(body.data)
    f.privates.set(u.id, p)
    return json(200, resp())
  }
  if (path === '/api/operations') return json(200, { operations: [], next: null })
  if (path === '/api/statements') return json(200, { uploads: [] })
  return json(404, { error: 'not found' })
}

const storages = new Map<Pinia, Map<string, string>>()
let current = new Map<string, string>()
/** Телефон — своя Pinia и своё хранилище (как два браузера). */
function phone(): Pinia {
  const pinia = createPinia()
  storages.set(pinia, new Map())
  on(pinia)
  return pinia
}
function on(pinia: Pinia) {
  current = storages.get(pinia)!
  setActivePinia(pinia)
}

const settle = async (ms = 0) => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

/** Действие экрана в SSR: setupState компонента, где есть `action`. */
async function act(pinia: Pinia, view: object, path: string, action: string) {
  let vm: Record<string, any> = {}
  const grab = { created(this: any) { if (action in this.$.setupState) vm = this.$.setupState } }
  await screen(pinia, view as never, path, undefined, [grab])
  return vm
}

/** Первый запуск пройден (B2C-19): свой участник с `onboardedAt`, семья настроена. */
function finishStart(name: string, slot: 'a' | 'b' | 'c') {
  const finance = useFinanceStore()
  finance.mutateHouseholdDoc((doc) => {
    doc.setupDoneAt ??= T
    doc.people = [...(doc.people ?? []).filter((p) => p.id !== slot), { id: slot, name, salary: 500_000, payday: 10, onboardedAt: T, updatedAt: T }]
  })
}

describe('e2e / B2C Блок 4 — чужая семья: Google → «с кем» → первый запуск; код; 401; удаление (B2C-25)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => current.get(k) ?? null,
      setItem: (k: string, v: string) => current.set(k, String(v)),
      removeItem: (k: string) => current.delete(k),
      clear: () => current.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(fakeGo))
    users = new Map()
    tokens = new Map()
    families = new Map()
    invites = new Map()
    posts = 0
    seq = 0
    resetSyncEngineForTests()
    // Как main.ts: 401 — выход без стирания документа.
    apiClient.onUnauthorized = () => void useAuthStore().expire()
  })

  afterEach(() => {
    apiClient.onUnauthorized = () => {}
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('Дана: Google → «Создать семью» → код → первый запуск; Ильяс: Google → по коду → партнёр', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    expect(useAuthStore().hasHousehold).toBe(false)
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/who')

    vm = await act(dana, Who, '/who', 'create')
    await vm.create('family')
    await settle()
    const code = vm.invite as string
    expect(code).toMatch(/^CODE/)
    expect(useAuthStore().hasHousehold).toBe(true)
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/start')
    finishStart('Дана', 'a')
    await settle(5000)
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/')
    const family = families.get(useAuthStore().household!.id)!
    expect(family.data.people?.map((p) => p.name)).toEqual(['Дана'])

    const ilyas = phone()
    vm = await act(ilyas, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-ilyas:ilyas@example.com')
    vm = await act(ilyas, Who, '/who', 'join')
    vm.pick('code')
    vm.code = code
    await vm.join()
    expect(useAuthStore().slot).toBe('b')
    // Документ семьи — с сервера; партнёр без своей записи — свой короткий первый запуск.
    expect(useFinanceStore().people.map((p) => p.name)).toEqual(['Дана'])
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/start')

    // Настройки: участники с сервера (имя на сервере — из Google), у обоих одинаково.
    await useAuthStore().fetchMembers()
    expect(useAuthStore().members.map((m) => `${m.slot}:${m.display_name}:${m.role}`)).toEqual(['a:Dana:member', 'b:Ilyas:member'])
    on(dana)
    await useAuthStore().fetchMembers()
    expect(useAuthStore().members.map((m) => m.slot)).toEqual(['a', 'b'])
  })

  it('«Я один» → первый запуск; открытие приложения — ревизия на сервере не растёт', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('alone')
    finishStart('Дана', 'a')
    await settle(5000)
    const family = families.get(useAuthStore().household!.id)!
    const rev = family.rev
    const sent = posts

    // «Перезапуск»: новая Pinia на том же хранилище, движок стартует — только pull.
    const again = createPinia()
    storages.set(again, current)
    on(again)
    const win = new EventTarget() as unknown as Window
    ;(win as unknown as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
    const doc = new EventTarget() as unknown as Document
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' })
    startSyncEngine(win, doc)
    await settle(1000)
    win.dispatchEvent(new Event('focus'))
    await settle(1000)
    expect(family.rev).toBe(rev)
    expect(posts).toBe(sent)
    expect(useFinanceStore().status).toBe('idle')
  })

  it('401 (аккаунт удалён на другом телефоне) — экран входа, документ на телефоне цел', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('alone')
    finishStart('Дана', 'a')
    await settle(5000)

    // Сессия умерла на сервере, а на телефоне — правка без сети.
    tokens.clear()
    useFinanceStore().setPerson('a', { name: 'Дана К.' })
    await settle(5000)
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(useFinanceStore().people[0].name).toBe('Дана К.')
    expect(useFinanceStore().unsent).toBe(true)
    expect(current.get('ff_household_doc')).toContain('Дана К.')

    // Вход снова той же почтой — та же семья, правка уходит.
    vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    await settle(5000)
    expect(families.get(useAuthStore().household!.id)!.data.people?.[0].name).toBe('Дана К.')
  })

  it('удаление: партнёр уходит — семья у Даны цела; Дана уходит — семьи нет, телефон чист', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('family')
    const code = vm.invite as string
    finishStart('Дана', 'a')
    await settle(5000)
    const hid = useAuthStore().household!.id

    const ilyas = phone()
    vm = await act(ilyas, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-ilyas:ilyas@example.com')
    vm = await act(ilyas, Who, '/who', 'join')
    vm.code = code
    await vm.join()
    vm = await act(ilyas, Settings, '/settings', 'deleteAccount')
    await vm.deleteAccount()
    expect(useAuthStore().isAuthenticated).toBe(false)
    expect(current.has('ff_household_doc')).toBe(false)
    expect(families.has(hid)).toBe(true)
    expect(users.has('sub-ilyas')).toBe(false)

    on(dana)
    vm = await act(dana, Settings, '/settings', 'deleteAccount')
    await vm.deleteAccount()
    expect(families.has(hid)).toBe(false)
    expect([...current.keys()].filter((k) => k.startsWith('ff_') && !k.startsWith('ff_theme') && !k.endsWith('_view'))).toEqual([])
  })

  it('возврат приёмки В-1: Дана ушла — Бек по коду получает свой слот и проходит свой первый запуск; запись Даны не его', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('family')
    const code = vm.invite as string
    finishStart('Дана', 'a')
    await settle(5000)
    const hid = useAuthStore().household!.id

    const ilyas = phone()
    vm = await act(ilyas, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-ilyas:ilyas@example.com')
    vm = await act(ilyas, Who, '/who', 'join')
    vm.code = code
    await vm.join()
    finishStart('Ильяс', 'b')
    await settle(5000)

    on(dana)
    vm = await act(dana, Settings, '/settings', 'deleteAccount')
    await vm.deleteAccount()
    expect(families.get(hid)!.data.people?.map((p) => `${p.id}:${p.name}`)).toEqual(['a:Дана', 'b:Ильяс'])

    // Р-124 п. 1: запись Даны в документе осталась, а сервер считает одного — у Ильяса снова «Пригласить».
    on(ilyas)
    await useAuthStore().fetchMembers()
    expect((await act(ilyas, Settings, '/settings', 'canInvite')).canInvite).toBe(true)
    const code2 = (await useAuthStore().createInvite()).code
    const bek = phone()
    vm = await act(bek, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-bek:bek@example.com')
    vm = await act(bek, Who, '/who', 'join')
    vm.code = code2
    await vm.join()
    // Слот Даны с её записью (имя, оклад, onboardedAt) не выдан: у Бека свой — и свой первый запуск.
    expect(useAuthStore().slot).toBe('c')
    expect(useFinanceStore().people.find((p) => p.id === 'c')).toBeUndefined()
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/start')
    finishStart('Бек', 'c')
    await settle(5000)
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/')
    expect(families.get(hid)!.data.people?.map((p) => `${p.id}:${p.name}`)).toEqual(['a:Дана', 'b:Ильяс', 'c:Бек'])

    // «С кем» у Ильяса: двое живых с сервера, Даны среди участников нет.
    on(ilyas)
    await useAuthStore().fetchMembers()
    expect(useAuthStore().members.map((m) => `${m.slot}:${m.display_name}`)).toEqual(['b:Ilyas', 'c:Bek'])
    expect((await act(ilyas, Settings, '/settings', 'canInvite')).canInvite).toBe(false)
  })
  it('B2C-27: аноним «/» → «Попробовать» — демо без запросов; демо → Google → «с кем» → закрыли/открыли → «Взять?» → «Да» — документ семьи = демо', async () => {
    const phoneA = phone()
    let vm = await act(phoneA, Landing, '/', 'tryDemo')
    vm.tryDemo()
    await settle()
    expect(useFinanceStore().isDemo).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    const demoGoals = useFinanceStore().householdDoc.goals.map((g) => g.id).sort()
    expect(demoGoals.length).toBeGreaterThan(0)

    // Из демо — на вход (выход из демо оставляет черновик), вход Google без семьи.
    useAuthStore().clearAuth()
    vm = await act(phoneA, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    expect(readDemoPending()).toBe(true)
    vm = await act(phoneA, Who, '/who', 'create')
    await vm.create('alone')
    // Семья создана, вопрос задан, черновик цел — закрыли приложение до ответа.
    expect(useAuthStore().hasHousehold).toBe(true)
    expect(useFinanceStore().docHousehold).toBe(DEMO_HOUSEHOLD)

    const reopened = createPinia()
    storages.set(reopened, current)
    on(reopened)
    const win = new EventTarget() as unknown as Window
    ;(win as unknown as { setInterval: typeof setInterval }).setInterval = (() => 0) as unknown as typeof setInterval
    const doc = new EventTarget() as unknown as Document
    Object.defineProperty(doc, 'visibilityState', { value: 'visible' })
    startSyncEngine(win, doc)
    await settle(1000)
    expect(useFinanceStore().isDemo).toBe(true)
    const html = await screen(reopened, Who, '/who')
    expect(html).toContain('Взять демо?')

    vm = await act(reopened, Who, '/who', 'answerDemo')
    await vm.answerDemo(true)
    await settle(5000)
    const family = families.get(useAuthStore().household!.id)!
    expect((family.data.goals ?? []).map((g) => g.id).sort()).toEqual(demoGoals)
    expect(family.data.people?.find((p) => p.id === 'a')?.name).toBe('Dana')
    expect(readDemoPending()).toBe(false)
  })

  it('Р-124 п. 2: демо → «Создать семью» → «Да» — демо-«Партнёра» нет; партнёр по коду получает b и свой первый запуск', async () => {
    const dana = phone()
    let vm = await act(dana, Landing, '/', 'tryDemo')
    vm.tryDemo()
    await settle()
    expect(useFinanceStore().people.some((p) => p.id === 'b')).toBe(true)
    useAuthStore().clearAuth()
    vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('family')
    vm = await act(dana, Who, '/who', 'answerDemo')
    await vm.answerDemo(true)
    const code = vm.invite as string
    await settle(5000)
    const hid = useAuthStore().household!.id
    expect(families.get(hid)!.data.people?.map((p) => p.id)).toEqual(['a'])
    expect((families.get(hid)!.data.goals ?? []).length).toBeGreaterThan(0)

    const ilyas = phone()
    vm = await act(ilyas, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-ilyas:ilyas@example.com')
    vm = await act(ilyas, Who, '/who', 'join')
    vm.code = code
    await vm.join()
    expect(useAuthStore().slot).toBe('b')
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/start')
  })

  it('B2C-27: из демо по коду — демо не переносится, у семьи свои данные', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('family')
    const code = vm.invite as string
    finishStart('Дана', 'a')
    await settle(5000)

    const ilyas = phone()
    vm = await act(ilyas, Landing, '/', 'tryDemo')
    vm.tryDemo()
    await settle()
    useAuthStore().clearAuth()
    vm = await act(ilyas, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-ilyas:ilyas@example.com')
    vm = await act(ilyas, Who, '/who', 'join')
    vm.pick('code')
    expect(await screen(ilyas, Who, '/who', undefined, [{ created(this: any) { if ('choice' in this.$.setupState) this.$.setupState.choice = 'code' } }])).toContain('Демо сюда не переносится')
    vm.code = code
    await vm.join()
    expect(readDemoPending()).toBe(false)
    expect(useFinanceStore().isDemo).toBe(false)
    expect(useFinanceStore().people.map((p) => p.name)).toEqual(['Дана'])
  })

  // Приёмка Блока 4, часть 2 (стенд Go + PG: старый пользователь `old@…` → Google той же почтой).
  it('приёмка: старый пользователь (почта и пароль) входит Google той же почтой на новом телефоне — та же семья, данные на месте, ревизия не растёт', async () => {
    const dana = phone()
    let vm = await act(dana, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-dana:dana@example.com')
    vm = await act(dana, Who, '/who', 'create')
    await vm.create('alone')
    finishStart('Дана', 'a')
    await settle(5000)
    const family = families.get(useAuthStore().household!.id)!
    // До Блока 4 — вход по почте: у пользователя нет Google, только почта.
    const old = users.get('sub-dana')!
    users.delete('sub-dana')
    old.id = 'old-dana'
    users.set(old.id, old)
    const rev = family.rev
    const sent = posts

    const fresh = phone()
    vm = await act(fresh, Access, '/access', 'onGoogleToken')
    await vm.onGoogleToken('id:sub-google-dana:dana@example.com')
    await settle(1000)
    expect(useAuthStore().household?.id).toBe(family.id)
    expect(users.get('sub-google-dana')).toBe(old)
    startSyncEngine(Object.assign(new EventTarget(), { setInterval: () => 0 }) as unknown as Window, Object.defineProperty(new EventTarget(), 'visibilityState', { value: 'visible' }) as unknown as Document)
    await settle(1000)
    expect(useFinanceStore().people.map((p) => `${p.name}:${p.salary}`)).toEqual(['Дана:500000'])
    expect(landingPath(useAuthStore(), useFinanceStore())).toBe('/')
    expect(family.rev).toBe(rev)
    expect(posts).toBe(sent)
  })
})
