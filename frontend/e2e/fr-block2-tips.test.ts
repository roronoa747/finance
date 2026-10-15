// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView, type Router } from 'vue-router'
import { apiClient, type ApiClient } from '../src/api/client'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { readTipsSeen } from '../src/lib/storage'
import { startDemo } from '../src/lib/demo'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import type { SyncDoc } from '../src/types/finance'
import { at, backend, fakeServer, type FakeServer } from './support/family'

vi.mock('../src/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/goalPhoto')>()),
  attachTemplate: vi.fn(async () => 'deferred'),
}))
vi.mock('../src/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Бэклог «первый», Блок 2 (FR-07): подсказки у предмета — всё приложение (`RouterView`, настоящий гард), документ с
 * Go-мока. (а) новая семья после первого запуска: «Мечты» с пузырём → «Понятно» → нет; «Месяц» — свой; назад на
 * «Мечты» — нет; (б) нынешняя семья (`onboardedAt` есть): пузыри на вкладках, первый запуск не перезапускается (Р-8);
 * (в) viewer: текст без призыва, «Неделя» → «Месяц»; (г) демо: пузыри есть; (д) выход стирает «видел».
 */
type Phone = { pinia: Pinia; client: ApiClient; finance: ReturnType<typeof useFinanceStore> }

let app: App | null = null
let server: FakeServer

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  // Фоновый синк стора идёт в настоящий клиент — сети нет, запрос не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  server = fakeServer(planFamilyDoc())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const client = backend(server)
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  return { pinia, client, finance }
}

/** Ленивые экраны (динамический импорт) и перерисовка. */
async function settle() {
  for (let i = 0; i < 5; i++) await vi.dynamicImportSettled()
  for (let i = 0; i < 3; i++) await nextTick()
}

/** Всё приложение телефона по адресу — через гард. */
async function launch(pinia: Pinia, path: string): Promise<Router> {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(RouterView)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await settle()
  return router
}
async function go(router: Router, path: string) {
  await router.push(path)
  await settle()
}

const bubbles = () => [...document.querySelectorAll<HTMLElement>('[data-tip]')]
const shown = () => bubbles().map((b) => b.dataset.tip)
const tipText = () => bubbles()[0]?.querySelector('p')?.textContent?.trim() ?? ''
async function understood() {
  document.querySelector<HTMLButtonElement>('[data-tip-ok]')!.click()
  await settle()
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
async function tap(label: string) {
  const b = button(label)
  expect(b, `кнопка «${label}»`).toBeDefined()
  b!.click()
  await settle()
}

describe('e2e / бэклог «первый», Блок 2 — подсказки у предмета (FR-05…FR-07)', () => {
  it('(а) новая семья: первый запуск → «Мечты» с пузырём у мечты → «Понятно» → нет; «Месяц» — свой; назад — нет', async () => {
    server = fakeServer(defaultSyncDoc())
    const A = await phone('a')
    const router = await launch(A.pinia, '/')
    expect(router.currentRoute.value.path.startsWith('/start')).toBe(true)
    // В первом запуске пузырей нет — он сам ведёт по шагам.
    expect(shown()).toEqual([])
    await tap('Пропустить')
    await tap('Машина')
    // Тема — фото на весь экран (FR-09): «Выбрать это» — дальше форма.
    await tap('Выбрать это')
    const need = document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!
    need.value = '3000000'
    need.dispatchEvent(new Event('input'))
    await settle()
    await tap('Дальше')
    const salary = [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent?.trim() === 'Зарплата в месяц, ₸')!.querySelector('input')!
    salary.value = '450000'
    salary.dispatchEvent(new Event('input'))
    await settle()
    await tap('Дальше')
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/')

    expect(shown()).toEqual(['tab-dreams'])
    expect(bubbles()[0].parentElement!.textContent).toContain('Машина')
    await understood()
    expect(shown()).toEqual([])
    await go(router, '/month')
    expect(shown()).toEqual(['tab-month'])
    await go(router, '/')
    expect(shown()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-dreams'])
  })

  it('(б) нынешняя семья (onboardedAt есть): пузыри на четырёх вкладках по одному, «Понятно» — навсегда; первый запуск не перезапускается', async () => {
    const doc = planFamilyDoc()
    server = fakeServer({ ...doc, people: doc.people.map((p) => ({ ...p, onboardedAt: '2026-09-01T07:00:00.000Z' })) } as SyncDoc)
    const A = await phone('a')
    const router = await launch(A.pinia, '/')
    expect(router.currentRoute.value.path).toBe('/')
    await go(router, '/start')
    expect(router.currentRoute.value.path).toBe('/')

    for (const [path, id] of [['/', 'tab-dreams'], ['/week', 'tab-week'], ['/month', 'tab-month'], ['/money', 'tab-money']] as const) {
      await go(router, path)
      expect(shown(), path).toEqual([id])
      expect(tipText(), path).not.toMatch(/выписк|PDF/i)
      await understood()
      expect(shown(), path).toEqual([])
    }
    expect(readTipsSeen()).toEqual(['tab-dreams', 'tab-week', 'tab-month', 'tab-money'])

    // Перезагрузка — заново всё приложение: ни одного пузыря.
    const again = await launch(A.pinia, '/')
    for (const path of ['/', '/week', '/month', '/money']) {
      await go(again, path)
      expect(shown(), path).toEqual([])
    }
  })

  it('(в) viewer: «Неделя» → «Месяц»; пузыри «Месяца», «Мечт» и «Денег» — без призыва нажать', async () => {
    const V = await phone('b', 'viewer')
    const router = await launch(V.pinia, '/week')
    expect(router.currentRoute.value.path).toBe('/month')
    const texts: string[] = []
    for (const [path, id] of [['/month', 'tab-month'], ['/', 'tab-dreams'], ['/money', 'tab-money']] as const) {
      await go(router, path)
      expect(shown(), path).toEqual([id])
      texts.push(tipText())
      await understood()
    }
    expect(texts).toHaveLength(3)
    for (const t of texts) expect(t).not.toMatch(/нажмите|раскройте|загрузить/i)
  })

  it('(г) демо: пузыри на «Мечтах» и «Месяце», «Понятно» закрывает', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    expect(startDemo()).toBe(true)
    const router = await launch(pinia, '/')
    expect(router.currentRoute.value.path).toBe('/')
    expect(shown()).toEqual(['tab-dreams'])
    await understood()
    await go(router, '/month')
    expect(shown()).toEqual(['tab-month'])
  })

  it('(д) выход стирает «видел»: следующий вход на этом телефоне видит подсказки снова', async () => {
    const A = await phone('a')
    await launch(A.pinia, '/')
    await understood()
    expect(readTipsSeen()).toEqual(['tab-dreams'])
    useAuthStore().logout('discard')
    expect(readTipsSeen()).toEqual([])
    expect(localStorage.getItem('ff_tips_seen')).toBeNull()

    const again = await phone('a')
    await launch(again.pinia, '/')
    expect(shown()).toEqual(['tab-dreams'])
  })
})
