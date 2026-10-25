// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '../src/router'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { readStatementFiles } from '../src/lib/statements/read'
import type { PdfRow } from '../src/lib/statements/pdf'
import { parseStatement } from '../src/lib/statements/parsers'
import type { WalletStatus } from '../src/types/api'
import Start from '../src/views/Start.vue'
import { at, backend, fakeServer, fakeStatements, statementsFor, type FakeServer } from './support/family'

/**
 * Бэклог «Хвосты», Блок 4 (TL-10, Р-10): шаг «Тратьте как обычно» без выбора из одного. Экран смонтирован с роутером,
 * документ и выписка уходят в Go-мок. (а) новая семья на Android: фото мечты, заголовок, «Загрузить выписку», «Позже» —
 * плиток нет; выписка → партнёр → «Неделя»; (б) iPhone: пока статус Apple Pay в пути — вид с одним путём, ответ — две
 * плитки, выбор переключает кнопку; (в) партнёр по коду на Android — тот же шаг без плиток.
 */

vi.mock('../src/lib/statements/read', () => ({ readStatementFiles: vi.fn() }))

const fixtures = import.meta.glob<PdfRow[]>('../src/lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })
const kaspi = () => parseStatement(fixtures['../src/lib/statements/fixtures/kaspi-01.rows.json'])

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
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

type Phone = { pinia: Pinia; client: ApiClient; finance: ReturnType<typeof useFinanceStore> }

/** Телефон участника с user-agent платформы: вход, документ семьи с Go-мока. */
async function phone(slot: 'a' | 'b', userAgent: string): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${slot}`, user: { id: user, email: `${slot}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot === 'a' ? 'Алихан' : 'Дана', role: 'member', joined_at: '' },
  })
  useApplePayStore().userAgent = userAgent
  const client = { ...backend(server), ...statementsFor(fakeStatements(), user, slot) } as unknown as ApiClient
  vi.spyOn(apiClient, 'getHouseholdDoc').mockImplementation(client.getHouseholdDoc)
  vi.spyOn(apiClient, 'pushHouseholdDoc').mockImplementation(client.pushHouseholdDoc)
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  return { pinia, client, finance }
}

async function open(p: Phone, path: string): Promise<Router> {
  setActivePinia(p.pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Start)
  app.use(p.pinia)
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
/** Брендовые кнопки (правило 12: одна главная). */
const brand = () => [...document.querySelectorAll('button.bg-brand')].map((b) => b.textContent?.trim())

/** Шаг трат с одним путём: мечта, заголовок, одна главная «Загрузить выписку», тихое «Позже», плиток нет. */
function expectOnePath() {
  expect($('[data-start-path]'), 'плиток выбора нет').toBeNull()
  expect($('[data-start-dream]')).not.toBeNull()
  expect($('h1')?.textContent?.trim()).toBe('Тратьте как обычно')
  expect(brand()).toEqual(['Загрузить выписку'])
  expect($('[data-start-upload]')).not.toBeNull()
  expect($('[data-start-later]')).not.toBeNull()
}

describe('e2e / «Хвосты» Блок 4 — шаг трат первого запуска без выбора из одного (TL-10)', () => {
  it('(а) новая семья на Android: мечта → траты без плиток, одна «Загрузить выписку» и «Позже» → выписка Kaspi → партнёр → «Пропустить» → «Неделя»', async () => {
    const A = await phone('a', ANDROID)
    const wallet = vi.spyOn(apiClient, 'walletStatus').mockResolvedValue(WALLET)
    A.finance.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    const router = await open(A, '/start/spend')
    expectOnePath()
    expect($('[data-start-dream]')!.textContent).toContain('Машина')
    // Статус Apple Pay пришёл (ярлык есть), но телефон не iPhone — путь всё равно один.
    expect(wallet).toHaveBeenCalled()
    expectOnePath()

    const ops = useOperationsStore()
    const send = ops.send
    vi.spyOn(ops, 'send').mockImplementation(() => send(A.client))
    vi.mocked(readStatementFiles).mockResolvedValue({ ok: [{ name: 'выписка.pdf', parsed: kaspi() }], errors: [] })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['%PDF'], 'выписка.pdf', { type: 'application/pdf' })] })
    input.dispatchEvent(new Event('change'))
    await settle()
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(ops.all.length).toBeGreaterThan(0)
    button('Пропустить')!.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/week')
    expect(A.finance.setupDone).toBe(true)
  })

  it('(б) iPhone: пока статус Apple Pay в пути — один путь без плиток; ответ — две плитки, «Выписка» нажата; Apple Pay → «Подключить Apple Pay», подсказки про файл нет', async () => {
    const A = await phone('a', IPHONE)
    let answer!: (s: WalletStatus) => void
    vi.spyOn(apiClient, 'walletStatus').mockReturnValue(new Promise<WalletStatus>((r) => (answer = r)))
    await open(A, '/start/spend')
    expectOnePath()

    answer(WALLET)
    await settle()
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-start-path]')]
    expect(tiles.map((t) => t.dataset.startPath)).toEqual(['statement', 'applepay'])
    expect(tiles[0].getAttribute('aria-pressed')).toBe('true')
    expect(brand()).toEqual(['Загрузить выписку'])
    tiles[1].click()
    await settle()
    expect(tiles[1].getAttribute('aria-pressed')).toBe('true')
    expect(brand()).toEqual(['Подключить Apple Pay'])
    expect(document.body.textContent).not.toContain('Файл остаётся на телефоне')
    tiles[0].click()
    await settle()
    expect(brand()).toEqual(['Загрузить выписку'])
  })

  it('(в) партнёр по коду на Android: вступление → тот же шаг трат без плиток, «Позже» → главный', async () => {
    server.data = { ...defaultSyncDoc(), people: [{ id: 'a', name: 'Алихан', salary: 600_000, payday: 10, updatedAt: '2025-07-01T00:00:00.000Z' }], setupDoneAt: '2025-07-01T00:00:00.000Z' } as typeof server.data
    const B = await phone('b', ANDROID)
    vi.spyOn(apiClient, 'walletStatus').mockResolvedValue(WALLET)
    const router = await open(B, '/start/spend')
    expectOnePath()
    button('Позже')!.click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/')
  })
})
