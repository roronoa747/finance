// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '../src/router'
import { apiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import type { WalletStatus } from '../src/types/api'
import Start from '../src/views/Start.vue'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Приёмка бэклога «Хвосты», Блок 4 (TL-10, Р-10) — углы, которых нет в e2e исполнителя: (1) браузер на компьютере —
 * один путь, «Позже» ведёт к партнёру; (2) iPhone, где Apple Pay недоступен (iOS 16, сбой статуса), — один путь, плитки
 * не появляются; (3) iPhone с Apple Pay: плитка Apple Pay → «Подключить Apple Pay» → партнёр → лист подключения.
 */

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const IOS16 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const IOS18 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const WALLET: WalletStatus = { connected: false, phones: 0, waiting: false, shortcut_url: 'https://example.test/shortcut', shortcut_url_legacy: 'https://example.test/legacy' } as WalletStatus

let app: App | null = null
let server: FakeServer

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  at('2025-07-27T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'pushPrivateDoc').mockRejectedValue(new TypeError('fetch failed'))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  server = fakeServer(defaultSyncDoc())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Новая семья: первый участник с user-agent платформы, документ — с Go-мока. */
async function newFamily(userAgent: string): Promise<Pinia> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't-a', user: { id: 'u-a', email: 'a@family.kz', created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: 'u-a', slot: 'a', display_name: 'Алихан', role: 'member', joined_at: '' },
  })
  useApplePayStore().userAgent = userAgent
  const client = backend(server)
  vi.spyOn(apiClient, 'getHouseholdDoc').mockImplementation(client.getHouseholdDoc)
  vi.spyOn(apiClient, 'pushHouseholdDoc').mockImplementation(client.pushHouseholdDoc)
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  finance.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
  return pinia
}

async function open(pinia: Pinia, path: string): Promise<Router> {
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Start)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await settle()
  return router
}

async function settle() {
  for (let i = 0; i < 5; i++) await vi.dynamicImportSettled()
  await nextTick()
  await nextTick()
}
const $ = (sel: string) => document.querySelector<HTMLElement>(sel)
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const brand = () => [...document.querySelectorAll('button.bg-brand')].map((b) => b.textContent?.trim())

function expectOnePath() {
  expect($('[data-start-path]'), 'плиток выбора нет').toBeNull()
  expect($('[data-start-dream]')!.textContent).toContain('Машина')
  expect($('h1')?.textContent?.trim()).toBe('Тратьте как обычно')
  expect(brand()).toEqual(['Загрузить выписку'])
  expect($('[data-start-later]')).not.toBeNull()
  expect(document.body.textContent).toContain('Файл остаётся на телефоне')
}

describe('e2e / приёмка «Хвосты» Блок 4 — шаг трат без выбора из одного (TL-10)', () => {
  it('(1) браузер на компьютере: статус Apple Pay пришёл, но плиток нет; «Позже» → «Пригласите партнёра»', async () => {
    const pinia = await newFamily(DESKTOP)
    vi.spyOn(apiClient, 'walletStatus').mockResolvedValue(WALLET)
    const router = await open(pinia, '/start/spend')
    expect(useApplePayStore().available).toBe(true)
    expectOnePath()
    button('Позже')!.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
  })

  it('(2) iPhone без Apple Pay — iOS 16 и сбой статуса: один путь, плитки не появляются и после ответа', async () => {
    const old = await newFamily(IOS16)
    vi.spyOn(apiClient, 'walletStatus').mockResolvedValue(WALLET)
    await open(old, '/start/spend')
    expect(useApplePayStore().isIPhone).toBe(true)
    expect(useApplePayStore().available).toBe(false)
    expectOnePath()
    app!.unmount()
    app = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'pushPrivateDoc').mockRejectedValue(new TypeError('fetch failed'))
    vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })

    const failing = await newFamily(IOS18)
    const status = vi.spyOn(apiClient, 'walletStatus').mockRejectedValue(new TypeError('fetch failed'))
    await open(failing, '/start/spend')
    await settle()
    expect(status).toHaveBeenCalled()
    expectOnePath()
  })

  it('(3) iPhone с Apple Pay: плитка Apple Pay → «Подключить Apple Pay» → партнёр → «Пропустить» → лист подключения', async () => {
    const pinia = await newFamily(IOS18)
    vi.spyOn(apiClient, 'walletStatus').mockResolvedValue(WALLET)
    const router = await open(pinia, '/start/spend')
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-start-path]')]
    expect(tiles.map((t) => t.dataset.startPath)).toEqual(['statement', 'applepay'])
    tiles[1].click()
    await settle()
    expect(brand()).toEqual(['Подключить Apple Pay'])
    $('[data-start-applepay]')!.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
    button('Пропустить')!.click()
    await settle()
    expect(router.currentRoute.value.fullPath).toBe('/settings?applepay=1')
    expect(useFinanceStore().setupDone).toBe(true)
  })
})
