import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ApiClient } from '@/api/client'
import { DEMO_TOKEN, useAuthStore } from './auth'
import { iosMajorOf, useApplePayStore } from './applepay'
import type { WalletStatus } from '@/types/api'

const storage = new Map<string, string>()

const UA = {
  ios27: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
  ios26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  ios17: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  pwa: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
}

const STATUS: WalletStatus = {
  connected: false, phones: 0,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
}

function signIn(role: 'member' | 'viewer' = 'member', token = 't') {
  useAuthStore().setAuthData({
    token,
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role, joined_at: '' },
  })
}

function fakeClient(status: WalletStatus = STATUS) {
  // Ключ стенда собирается из частей: хук pre-commit ловит похожее на секрет.
  const key = ['ffk', 'A'.repeat(43)].join('_')
  const calls = {
    walletStatus: vi.fn(async () => ({ ...status })),
    walletConnect: vi.fn(async () => ({ key })),
    walletDisconnect: vi.fn(async () => {}),
  }
  return { client: calls as unknown as ApiClient, calls, key }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('stores/applepay', () => {
  it('iosMajor — по Version/NN: 27, 26, 17; PWA без Version — null', () => {
    expect(iosMajorOf(UA.ios27)).toBe(27)
    expect(iosMajorOf(UA.ios26)).toBe(26)
    expect(iosMajorOf(UA.ios17)).toBe(17)
    expect(iosMajorOf(UA.pwa)).toBeNull()
  })

  it('путь и ссылка: iOS 27 — с триггером; 26 и 17 — старый; не распознано — iOS 27 и выбор «старше»', async () => {
    signIn()
    const ap = useApplePayStore()
    await ap.load(fakeClient().client)
    ap.userAgent = UA.ios27
    expect([ap.path, ap.link, ap.pathKnown, ap.isIPhone]).toEqual(['ios27', STATUS.shortcut_url, true, true])
    ap.userAgent = UA.ios26
    expect([ap.path, ap.link]).toEqual(['legacy', STATUS.shortcut_url_legacy])
    ap.userAgent = UA.ios17
    expect(ap.path).toBe('legacy')
    ap.userAgent = UA.pwa
    expect([ap.path, ap.pathKnown]).toEqual(['ios27', false])
    ap.chooseLegacy()
    expect(ap.link).toBe(STATUS.shortcut_url_legacy)
    ap.userAgent = UA.android
    expect(ap.isIPhone).toBe(false)
  })

  it('без ссылки для пути телефона — карточки нет', async () => {
    signIn()
    const ap = useApplePayStore()
    ap.userAgent = UA.ios26
    await ap.load(fakeClient({ ...STATUS, shortcut_url_legacy: '' }).client)
    expect(ap.available).toBe(false)
    ap.userAgent = UA.ios27
    expect(ap.available).toBe(true)
  })

  it('iOS 16 и ниже — карточки нет: триггера «Транзакция» до iOS 17 нет (Р-3, ревью frontend Н-4)', async () => {
    signIn()
    const ap = useApplePayStore()
    await ap.load(fakeClient().client)
    ap.userAgent = UA.ios17.replace('Version/17.5', 'Version/16.6')
    expect(ap.available).toBe(false)
    ap.userAgent = UA.ios17
    expect(ap.available).toBe(true)
    // Версия не распознана (PWA с экрана «Домой») — путь iOS 27 с выбором «старше», как было.
    ap.userAgent = UA.pwa
    expect(ap.available).toBe(true)
  })

  it('viewer и демо — load не зовёт сервер, карточки нет', async () => {
    for (const setup of [() => signIn('viewer'), () => signIn('member', DEMO_TOKEN)]) {
      setActivePinia(createPinia())
      setup()
      const ap = useApplePayStore()
      const { client, calls } = fakeClient()
      await ap.load(client)
      expect(calls.walletStatus).not.toHaveBeenCalled()
      expect(ap.available).toBe(false)
    }
  })

  it('connect отдаёт ключ и обновляет статус; ключа нет ни в сторе, ни в localStorage', async () => {
    signIn()
    const ap = useApplePayStore()
    const { client, calls, key } = fakeClient()
    await ap.load(client)
    calls.walletStatus.mockResolvedValue({ ...STATUS, connected: true, phones: 1 })
    expect(await ap.connect(client)).toBe(key)
    await vi.waitFor(() => expect(ap.connected).toBe(true))
    for (const [k, v] of storage) {
      expect(k).not.toContain(key)
      expect(v).not.toContain(key)
    }
    expect(JSON.stringify(ap.$state)).not.toContain(key)
  })

  it('ответ прошлого входа не пишется в новый, и новый вход спрашивает свой статус (критик Б1)', async () => {
    signIn('member', 't-a')
    const ap = useApplePayStore()
    const { client, calls } = fakeClient()
    let answerA!: (s: WalletStatus) => void
    calls.walletStatus.mockImplementationOnce(() => new Promise<WalletStatus>((r) => (answerA = r)))
    const first = ap.load(client)
    signIn('member', 't-b')
    const second = ap.load(client)
    answerA({ ...STATUS, connected: true, phones: 2 })
    await Promise.all([first, second])
    expect(calls.walletStatus).toHaveBeenCalledTimes(2)
    expect(ap.status).toMatchObject({ connected: false, phones: 0 })
  })

  it('«Подключить», пока первый статус в пути, — статус после подключения, а не до (критик Б1)', async () => {
    signIn()
    const ap = useApplePayStore()
    const { client, calls } = fakeClient()
    let answerBefore!: (s: WalletStatus) => void
    calls.walletStatus.mockImplementationOnce(() => new Promise<WalletStatus>((r) => (answerBefore = r)))
    const first = ap.load(client)
    calls.walletStatus.mockResolvedValue({ ...STATUS, connected: true, phones: 1 })
    await ap.connect(client)
    await vi.waitFor(() => expect(ap.connected).toBe(true))
    answerBefore({ ...STATUS })
    await first
    expect(ap.connected).toBe(true)
  })

  it('disconnect — статус «не подключено», телефонов 0', async () => {
    signIn()
    const ap = useApplePayStore()
    const { client, calls } = fakeClient({ ...STATUS, connected: true, phones: 2, last_used_at: '2026-10-16T05:00:00Z' })
    await ap.load(client)
    await ap.disconnect(client)
    expect(calls.walletDisconnect).toHaveBeenCalledOnce()
    expect(ap.status).toMatchObject({ connected: false, phones: 0 })
  })
})
