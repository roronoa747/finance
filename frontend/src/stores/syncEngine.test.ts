import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { apiClient } from '@/api/client'
import { startSyncEngine, resetSyncEngineForTests, BACKGROUND_SYNC_MS } from './syncEngine'

// Окно и документ-заглушки: движок слушает события и таймер окна.
function fakeEnv() {
  const win = new EventTarget() as unknown as Window
  ;(win as unknown as { setInterval: typeof setInterval }).setInterval = setInterval
  const doc = new EventTarget() as unknown as Document & { visibilityState: DocumentVisibilityState }
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', writable: true })
  return { win, doc }
}

function signIn(token = 'real-token') {
  useAuthStore().setAuthData({
    token,
    user: { id: 'u1', email: 'a@b.kz', created_at: '2026-09-24T00:00:00Z' },
    household: { id: 'h1', name: 'Казна', created_by: 'u1', created_at: '2026-09-24T00:00:00Z' },
    member: { household_id: 'h1', user_id: 'u1', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '2026-09-24T00:00:00Z' },
  })
}

describe('startSyncEngine — правки партнёра без собственной правки', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    resetSyncEngineForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function setup(token?: string) {
    if (token !== undefined) signIn(token)
    const finance = useFinanceStore()
    const pull = vi.spyOn(finance, 'pullHousehold').mockResolvedValue(null)
    const sync = vi.spyOn(finance, 'syncHousehold').mockResolvedValue()
    const env = fakeEnv()
    startSyncEngine(env.win, env.doc)
    return { finance, pull, sync, ...env }
  }

  it('старт с сессией — один полный круг (неотправленное перед закрытием не теряется)', () => {
    const { pull, sync } = setup('real-token')
    expect(sync).toHaveBeenCalledTimes(1)
    expect(pull).not.toHaveBeenCalled()
  })

  it('вернулись в приложение при idle — только забираем документ, без записи', () => {
    const { finance, pull, sync, win, doc } = setup('real-token')
    sync.mockClear()
    finance.status = 'idle'

    win.dispatchEvent(new Event('focus'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(pull).toHaveBeenCalledTimes(2)
    expect(sync).not.toHaveBeenCalled()
  })

  it('правка без сети: offline → online — полный круг со слиянием, а не затирание', () => {
    const { finance, pull, sync, win } = setup('real-token')
    sync.mockClear()

    win.dispatchEvent(new Event('offline'))
    expect(finance.status).toBe('offline')

    win.dispatchEvent(new Event('online'))
    expect(sync).toHaveBeenCalledTimes(1)
    expect(pull).not.toHaveBeenCalled()
  })

  it('RP-04: старт без сети — сразу «нет сети»; сеть вернулась — синк', () => {
    signIn('real-token')
    const finance = useFinanceStore()
    const pull = vi.spyOn(finance, 'pullHousehold').mockResolvedValue(null)
    const sync = vi.spyOn(finance, 'syncHousehold').mockResolvedValue()
    const { win, doc } = fakeEnv()
    Object.defineProperty(win, 'navigator', { value: { onLine: false } })

    startSyncEngine(win, doc)
    expect(finance.status).toBe('offline')
    expect(sync).not.toHaveBeenCalled()
    // Документ получил хозяина — семью, в которой вошли.
    expect(finance.docHousehold).toBe('h1')

    win.dispatchEvent(new Event('online'))
    expect(sync).toHaveBeenCalledTimes(1)
    expect(pull).not.toHaveBeenCalled()
  })

  it('раз в минуту — только на видимом экране', () => {
    const { finance, pull, doc } = setup('real-token')
    finance.status = 'idle'

    vi.advanceTimersByTime(BACKGROUND_SYNC_MS)
    expect(pull).toHaveBeenCalledTimes(1)

    doc.visibilityState = 'hidden'
    vi.advanceTimersByTime(BACKGROUND_SYNC_MS * 3)
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('без входа и в демо-режиме — к серверу не ходим', () => {
    for (const token of [undefined, 'demo-token']) {
      setActivePinia(createPinia())
      resetSyncEngineForTests()
      storage.clear()
      const { pull, sync, win } = setup(token)
      win.dispatchEvent(new Event('focus'))
      win.dispatchEvent(new Event('online'))
      vi.advanceTimersByTime(BACKGROUND_SYNC_MS)
      expect(pull).not.toHaveBeenCalled()
      expect(sync).not.toHaveBeenCalled()
    }
  })
})

describe('startSyncEngine — личный документ (B2C-05)', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    resetSyncEngineForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('неудачный push личного (нет сети) досылается следующим кругом движка, а не ждёт правки', async () => {
    signIn()
    const finance = useFinanceStore()
    vi.spyOn(finance, 'pullHousehold').mockResolvedValue(null)
    vi.spyOn(finance, 'syncHousehold').mockResolvedValue()
    const response = (rev: number, data: Record<string, unknown>) =>
      ({ household_id: 'h1', user_id: 'u1', rev, data, updated_at: '2026-09-26T10:00:00Z' })
    vi.spyOn(apiClient, 'getPrivateDoc').mockResolvedValue(response(0, {}))
    const push = vi.spyOn(apiClient, 'pushPrivateDoc')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (rev, data) => response(rev + 1, data))
    const { win, doc } = fakeEnv()
    startSyncEngine(win, doc)
    await vi.advanceTimersByTimeAsync(0)

    finance.addMerchantRule({ match: { merchant: 'magnum' }, to: { categoryId: 'sc_food' } }, 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(push).toHaveBeenCalledTimes(1)
    expect(finance.privateUnsent).toBe(true)

    win.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(push).toHaveBeenCalledTimes(2)
    expect(finance.privateUnsent).toBe(false)
    expect(finance.syncStatus).toBe('idle')
  })

  it('всё отправлено — круг движка забирает личный документ (правило со второго устройства)', async () => {
    signIn()
    const finance = useFinanceStore()
    vi.spyOn(finance, 'pullHousehold').mockResolvedValue(null)
    vi.spyOn(finance, 'syncHousehold').mockResolvedValue()
    const laptopRule = { id: 'r-laptop', match: { merchant: 'wolt' }, to: { categoryId: 'sc_cafe' }, by: 'a', updatedAt: '2026-09-26T09:00:00Z' }
    const get = vi.spyOn(apiClient, 'getPrivateDoc')
      .mockResolvedValueOnce({ household_id: 'h1', user_id: 'u1', rev: 1, data: {}, updated_at: '' })
      .mockResolvedValue({ household_id: 'h1', user_id: 'u1', rev: 2, data: { merchantRules: [laptopRule] }, updated_at: '' })
    const { win, doc } = fakeEnv()
    startSyncEngine(win, doc)
    await vi.advanceTimersByTimeAsync(0)
    expect(finance.merchantRules).toHaveLength(0)

    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(get).toHaveBeenCalledTimes(2)
    expect(finance.merchantRules.map((r) => r.id)).toEqual(['r-laptop'])
  })
})
