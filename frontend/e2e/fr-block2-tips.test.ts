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
import { authAs, planFamilyDoc, withOwnWeek } from '../src/test/planFamily'
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
    // FB-21: после мечты — «Тратьте как обычно» («Позже»), затем партнёр («Пропустить») — зарплату не спрашивают.
    await tap('Позже')
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
    // «Неделя» новой семьи пустая — ведёт брендовое «Загрузить», пузыря нет (FR-06 п. 2).
    await go(router, '/week')
    expect(shown()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-dreams'])
  })

  it('(б) нынешняя семья (onboardedAt есть): пузыри на четырёх вкладках по одному, «Понятно» — навсегда; первый запуск не перезапускается', async () => {
    // Со своими тратами недели — иначе «Неделя» пустая и без пузыря.
    const doc = withOwnWeek(planFamilyDoc())
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
    await understood()
    // Из демо — в свою семью (Р-13 «Figma», FG-11): увиденное в демо не возвращается.
    const A = await phone('a')
    await launch(A.pinia, '/')
    expect(shown()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-dreams', 'tab-month'])
  })

  it('приёмка — нажатие самого предмета вместо «Понятно» закрывает навсегда на всех четырёх вкладках; лист поверх — без пузыря', async () => {
    const doc = withOwnWeek(planFamilyDoc())
    server = fakeServer({ ...doc, people: doc.people.map((p) => ({ ...p, onboardedAt: '2026-09-01T07:00:00.000Z' })) } as SyncDoc)
    const A = await phone('a')
    const router = await launch(A.pinia, '/')
    // Нажатие внутри обёртки при замёрзших часах Vue отбрасывает — сдвигать часы перед каждым (§6 бэклога).
    const press = async (el: Element | null | undefined, what: string) => {
      expect(el, what).toBeTruthy()
      vi.setSystemTime(Date.now() + 1000)
      ;(el as HTMLElement).click()
      await settle()
    }
    const subject = () => bubbles()[0]?.parentElement

    // «Мечты»: нажатие мечты — экран цели; назад — пузыря нет.
    expect(shown()).toEqual(['tab-dreams'])
    await press(subject()!.querySelector('button'), 'мечта')
    expect(router.currentRoute.value.path).toMatch(/^\/goals\//)
    await go(router, '/')
    expect(shown()).toEqual([])

    // «Месяц»: открыт лист — пузыря нет, закрыт — вернулся; нажатие раздела — ушёл.
    await go(router, '/month')
    expect(shown()).toEqual(['tab-month'])
    await press(document.querySelector('[data-afford-open]'), '«Хватит?»')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(shown()).toEqual([])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(shown()).toEqual(['tab-month'])
    await press(document.querySelector('[data-sections] [data-section] [data-row-open]'), 'раздел месяца')
    expect(shown()).toEqual([])

    // «Деньги»: нажатие квадрата.
    await go(router, '/money')
    expect(shown()).toEqual(['tab-money'])
    await press(subject()!.querySelector('[aria-label="Деньги"] button:nth-child(2)'), 'квадрат «Долги»')
    expect(shown()).toEqual([])

    // «Неделя»: нажатие раздела — его лист, пузыря нет; лист закрыт — не вернулся (возврат приёмки: пузырь стоял у суммы).
    await go(router, '/week')
    expect(shown()).toEqual(['tab-week'])
    await press(document.querySelector('[data-week-list] .row-open'), 'раздел недели')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(shown()).toEqual([])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(shown()).toEqual([])

    expect([...readTipsSeen()].sort()).toEqual(['tab-dreams', 'tab-money', 'tab-month', 'tab-week'])
    // Перезагрузка — ни одного.
    const again = await launch(A.pinia, '/')
    for (const path of ['/', '/week', '/month', '/money']) {
      await go(again, path)
      expect(shown(), path).toEqual([])
    }
  })

  it('повторная приёмка — «Разобрать» в карточке разделов «Недели» тоже нажатие предмета: лист вопросов, пузыря нет, навсегда', async () => {
    // Подписка без ответа — вопрос разбора, у разделов появляется «Разобрать».
    const doc = withOwnWeek(planFamilyDoc())
    server = fakeServer({
      ...doc,
      people: doc.people.map((p) => ({ ...p, onboardedAt: '2026-09-01T07:00:00.000Z' })),
      obligations: [...(doc.obligations ?? []), { id: 'nf', name: 'Netflix', note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 4_990 }], updatedAt: '' }],
    } as SyncDoc)
    const A = await phone('a')
    await launch(A.pinia, '/week')
    expect(shown()).toEqual(['tab-week'])
    const bang = document.querySelector<HTMLElement>('[data-week-list] [data-bang]')
    expect(bang, '«Разобрать»').not.toBeNull()
    vi.setSystemTime(Date.now() + 1000)
    bang!.click()
    await settle()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Вопросы')
    expect(shown()).toEqual([])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(shown()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-week'])
    // Перезагрузка — пузыря «Недели» нет.
    const again = await launch(A.pinia, '/week')
    expect(again.currentRoute.value.path).toBe('/week')
    expect(shown()).toEqual([])
  })

  it('(д) один раз на устройство (Р-13 «Figma», FG-11): выход, вход и другая семья «видел» не стирают — подсказки не возвращаются', async () => {
    const A = await phone('a')
    await launch(A.pinia, '/')
    await understood()
    expect(readTipsSeen()).toEqual(['tab-dreams'])
    useAuthStore().logout('discard')
    expect(readTipsSeen()).toEqual(['tab-dreams'])

    const again = await phone('a')
    await launch(again.pinia, '/')
    expect(shown()).toEqual([])
    // Другая семья на этом телефоне: `claimFor` стирает данные прошлой — «видел» остаётся.
    useFinanceStore().claimFor('h-other')
    expect(readTipsSeen()).toEqual(['tab-dreams'])
  })

  it('(е) пузырь, на который не ответили, после 4 с на экране отмечен сам — со вкладки ушли, второй раз его нет', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const A = await phone('a')
    const router = await launch(A.pinia, '/')
    expect(shown()).toEqual(['tab-dreams'])
    await vi.advanceTimersByTimeAsync(3_000)
    await go(router, '/month')
    // 3 с — мало: «Мечты» не увидены, их пузырь вернётся.
    expect(readTipsSeen()).toEqual([])
    expect(shown()).toEqual(['tab-month'])
    await vi.advanceTimersByTimeAsync(4_000)
    expect(readTipsSeen()).toEqual(['tab-month'])
    await go(router, '/')
    expect(shown()).toEqual(['tab-dreams'])
    await go(router, '/month')
    expect(shown()).toEqual([])
  })
})
