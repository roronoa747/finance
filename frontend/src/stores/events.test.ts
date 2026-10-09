import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ApiError, type ApiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from './auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from './finance'
import { useEventsStore } from './events'
import { renderScreen, screenMixin } from '@/test/screenState'
import Admin from '@/views/Admin.vue'
import Settings from '@/views/Settings.vue'

const map = new Map<string, string>()
beforeEach(() => {
  map.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
  })
  vi.stubGlobal('navigator', { onLine: true })
  setActivePinia(createPinia())
})

const signIn = (token = 't') =>
  useAuthStore().setAuthData({
    token,
    user: { id: 'u', email: 'a@b.kz', created_at: '' },
    household: { id: 'h', name: 'Наша казна', created_by: 'u', created_at: '' },
    member: { household_id: 'h', user_id: 'u', slot: 'a', display_name: 'Дана', role: 'member', joined_at: '' },
  })

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('B2C-28: события удержания — очередь на устройстве', () => {
  it('track кладёт в очередь и досылает по одному; app_open — раз в день; только вид и время', async () => {
    signIn()
    const sent: [string, string][] = []
    const client = { sendEvent: vi.fn(async (k: string, at: string) => void sent.push([k, at])) } as unknown as ApiClient
    const events = useEventsStore()
    events.track('app_open', client)
    events.track('app_open', client)
    events.track('first_run_goal', client)
    await settle()
    await events.flush(client)
    expect(sent.map(([k]) => k)).toEqual(['app_open', 'first_run_goal'])
    expect(sent[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(events.queue).toEqual([])
    expect(map.get('ff_events_queue')).toBe('[]')
  })

  it('без сети — копится и уходит позже; 4xx — событие выбрасывается, 5xx — ждёт', async () => {
    signIn()
    const events = useEventsStore()
    const down = { sendEvent: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) } as unknown as ApiClient
    events.track('week_done', down)
    events.track('first_run_done', down)
    await settle()
    expect(events.queue.map((e) => e.kind)).toEqual(['week_done', 'first_run_done'])
    // Перезапуск: очередь из хранилища.
    setActivePinia(createPinia())
    signIn()
    const again = useEventsStore()
    expect(again.queue.length).toBe(2)
    const flaky = {
      sendEvent: vi.fn()
        .mockRejectedValueOnce(new ApiError('unknown event kind', 400))
        .mockRejectedValueOnce(new ApiError('boom', 500))
        .mockResolvedValue(undefined),
    } as unknown as ApiClient
    await again.flush(flaky)
    expect(again.queue.map((e) => e.kind)).toEqual(['first_run_done'])
    await again.flush(flaky)
    expect(again.queue).toEqual([])
  })

  it('демо и без входа — ничего не пишется и не шлётся', async () => {
    const client = { sendEvent: vi.fn(async () => {}) } as unknown as ApiClient
    useEventsStore().track('app_open', client)
    useAuthStore().setAuthData({ token: DEMO_TOKEN, user: { id: 'd', email: 'd', created_at: '' }, household: { id: 'demo-household-1', name: '', created_by: 'd', created_at: '' }, member: null })
    useFinanceStore().claimFor(DEMO_HOUSEHOLD)
    useEventsStore().track('week_done', client)
    await settle()
    expect(client.sendEvent).not.toHaveBeenCalled()
    expect(useEventsStore().queue).toEqual([])
  })

  it('вход истёк — очередь прежнего не уходит от имени следующего, app_open дня снова пишется (критик Блока 4)', async () => {
    signIn()
    const events = useEventsStore()
    const down = { sendEvent: () => Promise.reject(new TypeError('offline')) } as unknown as ApiClient
    events.track('app_open', down)
    events.track('week_done', down)
    await settle()
    expect(useAuthStore().expire()).toBe(true)
    expect(events.queue).toEqual([])
    expect(map.has('ff_events_queue')).toBe(false)

    signIn('t2')
    const sent: string[] = []
    const client = { sendEvent: vi.fn(async (k: string) => void sent.push(k)) } as unknown as ApiClient
    events.track('app_open', client)
    await settle()
    await events.flush(client)
    expect(sent).toEqual(['app_open'])
  })

  it('пока шёл запрос, очередь упёрлась в лимит — уходит из очереди именно отправленное (критик Блока 4)', async () => {
    signIn()
    const events = useEventsStore()
    const down = { sendEvent: () => Promise.reject(new TypeError('offline')) } as unknown as ApiClient
    for (let i = 0; i < 50; i++) events.track('week_done', down)
    await settle()
    const head = events.queue[0]
    let release!: () => void
    let calls = 0
    // Первый запрос висит до release; дальше сети нет — flush останавливается.
    const slow = {
      sendEvent: vi.fn(() => (calls++ === 0 ? new Promise<void>((r) => (release = r)) : Promise.reject(new TypeError('offline')))),
    } as unknown as ApiClient
    const done = events.flush(slow)
    await settle()
    events.track('first_run_done', down) // вытесняет голову, которая сейчас в запросе
    expect(events.queue).not.toContain(head)
    release()
    await done
    expect(events.queue.at(-1)?.kind).toBe('first_run_done')
    expect(events.queue).toHaveLength(50) // `slice(1)` выбросил бы неотправленное — 49
  })

  it('выход стирает очередь (LOCAL_KEYS)', () => {
    signIn()
    useEventsStore().track('week_done', { sendEvent: () => Promise.reject(new TypeError('offline')) } as unknown as ApiClient)
    expect(map.has('ff_events_queue')).toBe(true)
    useAuthStore().logout('discard')
    expect(map.has('ff_events_queue')).toBe(false)
  })
})

describe('B2C-28: /admin и пункт настроек', () => {
  const metrics = {
    users: 7, households: 4, households_with_upload: 3,
    second_upload_14d: { eligible: 2, retained: 1 },
    active_7d: 2, active_28d: 5,
    funnel_28d: { created: 4, uploaded: 3, goal: 2, done: 1 },
    weeks: [{ week: '2026-10-05', new_households: 1, uploads: 2, week_done: 1 }],
  }

  it('таблицы цифр: вторая выписка 50 %, всего, воронка с долями, недели', async () => {
    signIn()
    const html = (await renderScreen(Admin, '/admin', undefined, [screenMixin({ metrics, state: 'ok' })])).replace(/<[^>]*>/g, ' ')
    expect(html).toContain('Вторая выписка за 14 дней')
    expect(html).toContain('50 %')
    expect(html).toContain('1 из 2 семей')
    expect(html).toContain('Активные за 28 дней')
    expect(html).toContain('Прошли первый запуск')
    expect(html).toContain('25 %')
    expect(html).toContain('2026-10-05')
  })

  it('не владелец (404) — «Нет такой страницы»', async () => {
    signIn()
    const html = await renderScreen(Admin, '/admin', undefined, [screenMixin({ state: 'none' })])
    expect(html).toContain('Нет такой страницы.')
  })

  it('пункт «Цифры» в настройках — только при admin из /auth/me', async () => {
    signIn()
    expect(await renderScreen(Settings, '/settings')).not.toContain('href="/admin"')
    useAuthStore().admin = true
    expect(await renderScreen(Settings, '/settings')).toContain('href="/admin"')
  })
})
