import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { startSyncEngine, resetSyncEngineForTests } from '../src/stores/syncEngine'
import type { SyncDoc, Goal } from '../src/types/finance'

// Приёмка Блока 6: на репетиции правка партнёра не доходила до открытого Vue
// (MGV-19), а критик нашёл гонку «фоновый pull затирает свою правку». Здесь —
// весь путь без моков стора: движок → стор → ApiClient → fetch → «сервер Go»
// (ревизии и 409 с server_doc, как в handlers/sync.go). Партнёр пишет прямо в
// серверный документ — так выглядит его push со второго устройства.

type ServerDoc = { rev: number; data: SyncDoc; updated_at: string }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

function goal(id: string, name: string): Goal {
  return { id, name, target: 1_000_000, saved: 0, monthly: 50_000 } as unknown as Goal
}

function baseDoc(): SyncDoc {
  return {
    people: [],
    categories: [],
    goals: [goal('g-base', 'Подушка')],
    wishlist: [],
    obligations: [],
    accounts: [],
    credits: [],
    setupDoneAt: '2026-09-07T20:06:48.585Z',
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('e2e / Блок 6 — движок синка на открытом экране', () => {
  const storage = new Map<string, string>()
  let server: ServerDoc
  // Отложенный ответ на следующий GET: держит фоновый pull «в пути».
  let holdNextGet: Promise<void> | null
  // Свои окно и документ на каждый тест: слушатели движка прошлого теста
  // (со старым стором) иначе перехватили бы события и отложенный GET.
  let win: Window
  let doc: Document

  const response = () => ({ household_id: 'h-family', ...clone(server) })

  async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = String(input)
    if (!url.endsWith('/api/sync/household')) return json(404, { error: 'not found' })
    if (new Headers(init.headers).get('Authorization') !== 'Bearer real-token') {
      return json(401, { error: 'unauthorized' })
    }
    if ((init.method ?? 'GET') === 'GET') {
      const snapshot = response() // сервер ответил сейчас, клиент получит позже
      if (holdNextGet) {
        const hold = holdNextGet
        holdNextGet = null
        await hold
      }
      return json(200, snapshot)
    }
    const body = JSON.parse(String(init.body)) as { last_seen_rev: number; data: SyncDoc }
    if (body.last_seen_rev !== server.rev) return json(409, { error: 'conflict', server_doc: response() })
    server = { rev: server.rev + 1, data: clone(body.data), updated_at: new Date().toISOString() }
    return json(200, response())
  }

  function partnerAddsGoal(g: Goal) {
    const data = clone(server.data)
    data.goals = [...data.goals, g]
    server = { rev: server.rev + 1, data, updated_at: new Date().toISOString() }
  }

  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    win = new EventTarget() as unknown as Window
    ;(win as unknown as { setInterval: typeof setInterval }).setInterval = ((() => 0) as unknown) as typeof setInterval
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
    server = { rev: 632, data: baseDoc(), updated_at: '2026-09-24T10:00:00Z' }
    holdNextGet = null
    setActivePinia(createPinia())
    resetSyncEngineForTests()
    useAuthStore().setAuthData({
      token: 'real-token',
      user: { id: 'u-ilyas', email: 'a@b.kz', created_at: '2026-09-07T00:00:00Z' },
      household: { id: 'h-family', name: 'Казна', created_by: 'u-ilyas', created_at: '2026-09-07T00:00:00Z' },
      member: { household_id: 'h-family', user_id: 'u-ilyas', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '2026-09-07T00:00:00Z' },
    })
    startSyncEngine(win, doc) // старт с сессией — полный круг
    await settle()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('старт: забирает документ сервера, «синхронизировано»', () => {
    const finance = useFinanceStore()
    expect(finance.status).toBe('idle')
    expect(finance.goals.map((g) => g.id)).toEqual(['g-base'])
  })

  it('правка партнёра появляется после возврата в приложение — без своей правки и без роста rev', async () => {
    const finance = useFinanceStore()
    const revBefore = server.rev
    partnerAddsGoal(goal('g-aruna', 'Отпуск'))

    win.dispatchEvent(new Event('focus'))
    await settle()

    expect(finance.goals.map((g) => g.id)).toEqual(['g-base', 'g-aruna'])
    expect(finance.status).toBe('idle')
    // Открытый экран только читает: ревизия выросла лишь от правки партнёра.
    expect(server.rev).toBe(revBefore + 1)
  })

  it('своя правка, сделанная пока фоновый pull в пути, не теряется и уходит на сервер вместе с правкой партнёра', async () => {
    const finance = useFinanceStore()
    partnerAddsGoal(goal('g-aruna', 'Отпуск'))

    let release!: () => void
    holdNextGet = new Promise<void>((r) => (release = r))
    doc.dispatchEvent(new Event('visibilitychange')) // фоновый pull ушёл
    await settle()

    finance.mutateHouseholdDoc((d) => {
      d.goals.push(goal('g-ilyas', 'Машина'))
    })
    release() // устаревший ответ сервера (без g-ilyas) пришёл после правки
    await settle()

    expect(finance.goals.map((g) => g.id)).toContain('g-ilyas')
    expect(finance.status).toBe('dirty')

    await vi.advanceTimersByTimeAsync(2000) // отложенный синк правки
    await settle()

    expect(finance.status).toBe('idle')
    expect(server.data.goals.map((g) => g.id).sort()).toEqual(['g-aruna', 'g-base', 'g-ilyas'])
    expect(finance.goals.map((g) => g.id).sort()).toEqual(['g-aruna', 'g-base', 'g-ilyas'])
  })

  it('истёкший вход при фоновом pull — не «синхронизировано», а ошибка', async () => {
    const finance = useFinanceStore()
    localStorage.setItem('ff_auth_token', 'expired')

    win.dispatchEvent(new Event('focus'))
    await settle()

    expect(finance.status).toBe('error')
  })
})
