// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { createAppRouter, routes } from '../src/router'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { useEventsStore } from '../src/stores/events'
import { useOperationsStore } from '../src/stores/operations'
import { landingPath } from '../src/router/landing'
import { readStatementFiles } from '../src/lib/statements/read'
import { matchCategory } from '../src/lib/statements/matching'
import type { PdfRow } from '../src/lib/statements/pdf'
import { parseStatement } from '../src/lib/statements/parsers'
import type { SyncDoc } from '../src/types/finance'
import Start from '../src/views/Start.vue'
import Week from '../src/views/Week.vue'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, statementsFor, type FakeServer } from './support/family'

/**
 * Бэклог «первый», Блок 1 (FR-04), после Блока 5 «Фидбек» (FB-21, Р-35 — первый запуск «сначала траты»): критерии
 * брифа сценариями первого запуска — экран смонтирован по-настоящему, с роутером (адрес шага), документ уходит на
 * Go-мок. (а) новая семья без выписки: вступление → мечта → «Тратьте как обычно» («Позже») → «Пропустить» партнёра;
 * (б) «Пропустить» вступления и мечты → «Мечты» без целей; (в) выписка Kaspi на шаге трат → партнёр → «Неделя»;
 * доход — вопрос «Недели», повторы — «нашли в выписке» в «Месяце»; (г) партнёр по коду: вступление → траты → главный;
 * (д) перезагрузка посреди и старые адреса прежних потоков. Зарплату первый запуск не спрашивает.
 */

// PDF читает pdf.js в браузере — здесь разбор фикстуры; фото шаблона — без сети.
vi.mock('../src/lib/statements/read', () => ({ readStatementFiles: vi.fn() }))
vi.mock('../src/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/goalPhoto')>()),
  attachTemplate: vi.fn(async () => 'deferred'),
}))

const fixtures = import.meta.glob<PdfRow[]>('../src/lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })
const kaspi = () => parseStatement(fixtures['../src/lib/statements/fixtures/kaspi-01.rows.json'])

let app: App | null = null
let server: FakeServer

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  // Как часть 4 Блока 3 B2C: выписка Kaspi за 26.06–26.07.2025 загружена 27 июля.
  at('2025-07-27T07:00:00Z')
  // Фоновый синк стора идёт в настоящий клиент — сети нет, запрос не отвечает; синк телефона — явный, в мок.
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

/** Телефон участника: вход, документ семьи с Go-мока. */
async function phone(slot: 'a' | 'b'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${slot}`, user: { id: user, email: `${slot}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot === 'a' ? 'Алихан' : 'Дана', role: 'member', joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(fakeStatements(), user, slot) } as unknown as ApiClient
  // Фоновый синк стора (после ответа, `finish`) идёт в `apiClient` — документ семьи направлен в тот же Go-мок.
  vi.spyOn(apiClient, 'getHouseholdDoc').mockImplementation(client.getHouseholdDoc)
  vi.spyOn(apiClient, 'pushHouseholdDoc').mockImplementation(client.pushHouseholdDoc)
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  return { pinia, client, finance }
}

/** Экран по адресу (первый запуск — как после «С кем ведём?», `landingPath` → `/start`); перезагрузка — новый монтаж. */
async function open(p: Phone, path: string, view: typeof Start | typeof Week | typeof Month = Start): Promise<Router> {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(p.pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(p.pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  await nextTick()
  return router
}

const page = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const head = () => document.querySelector('[data-start-head]')!.textContent?.replace(/\s+/g, ' ').trim()
const title = () => document.querySelector('h1')?.textContent?.trim()
/** Переход роутера (ленивые экраны — динамический импорт) и перерисовка. */
async function settle() {
  for (let i = 0; i < 5; i++) await vi.dynamicImportSettled()
  await nextTick()
  await nextTick()
}
async function tap(label: string) {
  const b = button(label)
  expect(b, `кнопка «${label}»`).toBeDefined()
  vi.setSystemTime(new Date(Date.now() + 1000))
  b!.click()
  await settle()
}
async function press(el: HTMLElement | null, what: string) {
  expect(el, what).not.toBeNull()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await settle()
}
async function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}
const events = () => useEventsStore().queue.map((e) => e.kind)

/** Синк семьи дошёл до Go-мока: фоновый круг стора и явный — тем же клиентом. */
async function synced(p: Phone) {
  await vi.advanceTimersByTimeAsync(5_000)
  await p.finance.syncHousehold(p.client)
  expect(p.finance.unsent, 'документ на сервере').toBe(false)
}

/** Вступление «Дальше» × 3: три образа и первый настоящий шаг. */
async function throughIntro(router: Router) {
  const seen: string[] = []
  for (let i = 0; i < 3; i++) {
    seen.push(document.querySelector('[data-intro-page][aria-hidden="false"] h1')!.textContent!.trim())
    expect(head(), 'на вступлении нет «n из k»').not.toMatch(/\d из \d/)
    await tap('Дальше')
  }
  expect(seen).toEqual(['Мечта', 'Свободно', 'Утечки'])
  return router.currentRoute.value.path
}

/** Мечта из шаблона «Машина» на 3 000 000 — «Дальше» ведёт к тратам. */
async function makeDream(router: Router) {
  await tap('Машина')
  // Тема — фото на весь экран (FR-09): «Выбрать это» — дальше форма.
  await tap('Выбрать это')
  await type(document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!, '3000000')
  await tap('Дальше')
  expect(router.currentRoute.value.path).toBe('/start/spend')
}

describe('e2e / бэклог «первый», Блок 1 — первый запуск без выписки (FR-01…FR-03; FB-21)', () => {
  it('(а) новая семья: вступление → мечта из шаблона → «Тратьте как обычно» («Позже») → «Пропустить» партнёра → «Мечты»; документ: цель главная, оклада нет, setupDoneAt, onboardedAt; события first_run_goal, first_run_done', async () => {
    const A = await phone('a')
    expect(landingPath(useAuthStore(), A.finance)).toBe('/start')
    const router = await open(A, '/start')
    expect(await throughIntro(router)).toBe('/start/dream')

    expect(head()).toContain('1 из 3')
    await tap('Машина')
    await tap('Выбрать это')
    await type(document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!, '3000000')
    expect(page()).toContain('будет вашей в')
    expect(page()).not.toContain('при остатке')
    // `/ux`: в первом запуске дальше траты — кнопка «Дальше», а не «Готово — к мечте».
    expect(page()).not.toContain('Готово — к мечте')
    await tap('Дальше')
    expect(router.currentRoute.value.path).toBe('/start/spend')
    expect(events()).toEqual(['first_run_goal'])

    // «Тратьте как обычно»: фото мечты, одна брендовая «Загрузить выписку», тихое «Позже»; полей зарплаты нет.
    expect(title()).toBe('Тратьте как обычно')
    expect(head()).toContain('2 из 3')
    expect(page()).toContain('Машина')
    expect(button('Пропустить')).toBeDefined()
    expect(button('Загрузить выписку')).toBeDefined()
    expect(page()).not.toContain('Зарплата в месяц')
    await tap('Позже')
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(head()).toContain('3 из 3')

    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/')
    expect(A.finance.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(A.finance.queue[0].goal?.name).toBe('Машина')
    expect(A.finance.people).toEqual([expect.objectContaining({ id: 'a', name: 'Алихан', onboardedAt: expect.stringMatching(/^2025-07-27T07:00/) })])
    expect(A.finance.people[0].salary ?? 0).toBe(0)
    expect(A.finance.setupDone).toBe(true)
    expect(A.finance.householdDoc.spendTotals ?? []).toEqual([])
    expect(events()).toEqual(['first_run_goal', 'first_run_done'])
    expect(landingPath(useAuthStore(), A.finance)).toBe('/')

    await synced(A)
    expect(server.data.setupDoneAt).toBeTruthy()
    expect(server.data.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(server.data.people).toEqual([expect.objectContaining({ id: 'a', name: 'Алихан' })])
  })

  it('(б) «Пропустить» на вступлении и на мечте → траты → «Позже» → «Пропустить» партнёра → «Мечты» без целей; first_run_goal не пишется', async () => {
    const A = await phone('a')
    const router = await open(A, '/start')
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/start/dream')
    expect(page()).toContain('На что копим?')
    expect(button('Пока без мечты')).toBeUndefined()
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/start/spend')
    // Без мечты — плитка без фото.
    expect(document.querySelector('[data-start-dream]')).not.toBeNull()
    await tap('Позже')
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/')
    expect(A.finance.goals).toEqual([])
    expect(A.finance.setupDone).toBe(true)
    expect(events()).toEqual(['first_run_done'])
    expect(landingPath(useAuthStore(), A.finance)).toBe('/')
  })

  it('приёмка — весь путь новой семьи: на каждом экране не больше одной брендовой кнопки; заголовки не про выписку (главная шага трат — «Загрузить выписку» по решению владельца, Р-30)', async () => {
    const A = await phone('a')
    const router = await open(A, '/start')
    const seen: string[] = []
    const check = (where: string) => {
      const live = (el: Element) => !el.closest('[aria-hidden="true"]')
      const brand = [...document.querySelectorAll('button')].filter((b) => live(b) && /(^|\s)bg-brand(\s|$)/.test(b.className))
      const texts = brand.map((b) => b.textContent!.trim())
      expect(brand.length, `${where}: брендовых ${texts.join(' | ')}`).toBeLessThanOrEqual(1)
      const h1 = [...document.querySelectorAll('h1')].filter(live).map((h) => h.textContent!.trim())
      expect(h1.join(' '), `${where}: заголовок`).not.toMatch(/выписк|PDF/i)
      seen.push(`${where}: ${texts[0] ?? '—'}`)
    }
    for (let i = 0; i < 3; i++) {
      check(`вступление ${i + 1}`)
      await tap('Дальше')
    }
    check('мечта')
    await tap('Машина')
    await tap('Выбрать это')
    await type(document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!, '3000000')
    check('форма мечты')
    await tap('Дальше')
    check('траты')
    await tap('Позже')
    expect(router.currentRoute.value.path).toBe('/start/invite')
    check('партнёр')
    expect(seen).toEqual([
      'вступление 1: Дальше', 'вступление 2: Дальше', 'вступление 3: Дальше', 'мечта: Дальше', 'форма мечты: Дальше',
      'траты: Загрузить выписку', 'партнёр: Создать код',
    ])
  })
})

describe('e2e / бэклог «первый», Блок 1 — выписка на шаге трат, партнёр, перезагрузка (FR-01…FR-03; FB-21)', () => {
  it('(в) траты → выписка Kaspi → партнёр → «Пропустить» → «Неделя»; «Это ваш доход?» — вопрос «Недели», «Да» → оклад; «нашли в выписке» в «Месяце» → «В платежи» → платёж, июль отмечен, правило', async () => {
    const A = await phone('a')
    const router = await open(A, '/start/spend')
    expect(title()).toBe('Тратьте как обычно')
    // Отправка — настоящая, в Go-мок (своя копия операций и итоги в документе), как «Отправить» в «Неделе».
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
    expect(head()).toContain('3 из 3')
    expect(ops.all).toHaveLength(60)
    // Вопросов первого запуска нет; оклад не спрашивался.
    expect(page()).not.toContain('Это ваш доход?')
    expect(A.finance.people.find((p) => p.id === 'a')?.salary ?? 0).toBe(0)
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/week')
    expect(A.finance.setupDone).toBe(true)
    expect(A.finance.people[0].onboardedAt).toMatch(/^2025-07-27T07:00/)

    // «Неделя»: «Это ваш доход?» первым — «Да» пишет оклад 120 000 (24-го) и правило зарплаты.
    await open(A, '/week', Week)
    await press(document.querySelector<HTMLElement>('[data-bang]'), 'строка «Вопросы»')
    expect(page()).toContain('Это ваш доход?')
    await tap('Да, это зарплата')
    expect(A.finance.people).toEqual([expect.objectContaining({ id: 'a', salary: 120_000, payday: 24 })])
    // Отправитель безымянный и приход не регулярный (кредит наличными не в счёт) — правила зарплаты нет, как и раньше.
    expect(A.finance.merchantRules.filter((r) => 'payment' in r.to && r.to.payment.kind === 'salary')).toEqual([])

    // «Месяц» → «Платежи»: «нашли N в выписке»; «В платежи» у «Оплата Kaspi Кредита» → лист кредита (TL-03) → остаток →
    // «Добавить».
    await open(A, '/month', Month)
    expect(document.querySelector('[data-section-found]')).not.toBeNull()
    await press(document.querySelector<HTMLElement>('[data-section="dues"]'), 'строка «Платежи»')
    const row = [...document.querySelectorAll<HTMLElement>('[data-found-row]')].find((r) => r.textContent?.includes('Оплата Kaspi Кредита'))!
    expect(row, 'строка кредита').toBeTruthy()
    await press(row.querySelector<HTMLElement>('[data-found-pay]'), '«В платежи»')
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Новый долг')
    const rest = [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes('Остаток долга'))!.querySelector('input')!
    await type(rest, '2400000')
    await tap('Добавить')
    // Строка кредита — кредит с остатком (TL-03, Р-3), не обязательство «быт».
    const credit = A.finance.credits.find((c) => c.name === 'Оплата Kaspi Кредита')!
    expect(credit).toMatchObject({ day: 24, payment: 151_790, principal: 2_400_000 })
    expect(A.finance.obligations).toEqual([])
    expect(A.finance.payments.find((p) => p.targetId === credit.id)).toMatchObject({ kind: 'credit', period: '2025-07', amount: 151_790, source: 'statement' })
    expect(A.finance.merchantRules.find((r) => 'payment' in r.to && r.to.payment.targetId === credit.id)!.to).toEqual({ payment: { kind: 'credit', targetId: credit.id, categoryId: matchCategory('credit', credit) } })
    // Строка ушла из «нашли» (правило платежа записано — после пересчёта операций).
    await vi.advanceTimersByTimeAsync(200)
    await settle()
    expect([...document.querySelectorAll('[data-found-row]')].some((r) => r.textContent?.includes('Оплата Kaspi Кредита'))).toBe(false)

    await synced(A)
    expect(server.data.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 2_400_000 })])
    expect(server.data.people).toEqual([expect.objectContaining({ id: 'a', salary: 120_000 })])
    expect(server.data.spendTotals!.some((t) => t.by === 'a' && t.kind === 'month' && t.period === '2025-07')).toBe(true)
  })

  it('(г) партнёр по коду: вступление → траты (один шаг — без «n из k») → «Позже» — главный; шагов мечты и партнёра нет, finishSetup не зовётся, оклада нет', async () => {
    server = fakeServer({
      ...defaultSyncDoc(),
      setupDoneAt: '2025-07-20T07:00:00.000Z',
      people: [{ id: 'a', name: 'Алихан', salary: 600_000, payday: 10, onboardedAt: '2025-07-20T07:00:00.000Z', updatedAt: '2025-07-20T07:00:00.000Z' }],
    } as SyncDoc)
    const B = await phone('b')
    expect(landingPath(useAuthStore(), B.finance)).toBe('/start')
    const finishSetup = vi.spyOn(B.finance, 'finishSetup')
    const router = await open(B, '/start')
    expect(await throughIntro(router)).toBe('/start/spend')
    expect(head()).not.toMatch(/\d из \d/)
    expect(page()).not.toContain('На что копим?')
    // Старые и чужие адреса партнёра — его первый шаг (вступление), не мечта и не приглашение.
    for (const path of ['/start/dream', '/start/invite', '/start/month']) {
      await open(B, path)
      expect(document.querySelector('[data-intro-page]'), path).not.toBeNull()
    }
    const back = await open(B, '/start/spend')
    await tap('Позже')
    expect(back.currentRoute.value.path).toBe('/')
    expect(finishSetup).not.toHaveBeenCalled()
    expect(B.finance.people.find((p) => p.id === 'b')).toMatchObject({ name: 'Дана', onboardedAt: expect.stringMatching(/^2025-07-27T07:00/) })
    expect(B.finance.people.find((p) => p.id === 'b')?.salary ?? 0).toBe(0)
    expect(B.finance.householdDoc.setupDoneAt).toBe('2025-07-20T07:00:00.000Z')
    expect(events()).toEqual(['first_run_done'])
    expect(landingPath(useAuthStore(), B.finance)).toBe('/')
  })

  it('(д) перезагрузка посреди: `/start/spend` после мечты — цель на месте, вступление не повторяется; старые `/start/upload`, `/start/salary`, `/start/questions` → траты, `/start/month` → партнёр', async () => {
    const A = await phone('a')
    const router = await open(A, '/start/intro')
    await tap('Пропустить')
    await makeDream(router)

    // Перезагрузка: тот же адрес — тот же шаг; цель записана, гард с `/start` не выкидывает (своей записи ещё нет).
    await open(A, '/start/spend')
    expect(title()).toBe('Тратьте как обычно')
    expect(document.querySelector('[data-intro-page]')).toBeNull()
    expect(A.finance.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(landingPath(useAuthStore(), A.finance)).toBe('/start')

    // Прежние потоки на проде: выписка, зарплата и вопросы — шаг трат, `/start/month` — пригласить партнёра.
    for (const path of ['/start/upload', '/start/salary', '/start/questions']) {
      await open(A, path)
      expect(title(), path).toBe('Тратьте как обычно')
    }
    await open(A, '/start/month')
    expect(title()).toBe('Пригласите партнёра')
    expect(head()).toContain('3 из 3')
  })
})

describe('e2e / бэклог «первый», Блок 2 FR-08 — холодный запуск посреди первого запуска (хвост §4 Блока 1; FB-21)', () => {
  /** Холодный запуск PWA: `start_url` «/» через настоящий гард; экран — тот, куда он привёл. */
  async function coldStart(p: Phone): Promise<Router> {
    app?.unmount()
    document.body.innerHTML = ''
    setActivePinia(p.pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.path, 'гард не пустил на «Мечты»').toBe('/start')
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Start)
    app.use(p.pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    return router
  }

  it('(е) мечта записана, PWA закрыли до трат → холодный запуск: траты (не вступление и не вторая мечта) → партнёр → «Мечты»; цель одна, setupDoneAt и onboardedAt', async () => {
    const A = await phone('a')
    const router0 = await open(A, '/start/intro')
    await tap('Пропустить')
    await makeDream(router0)
    await synced(A)

    const router = await coldStart(A)
    expect(title()).toBe('Тратьте как обычно')
    expect(head()).toContain('2 из 3')
    expect(document.querySelector('[data-intro-page]')).toBeNull()
    await tap('Позже')
    expect(router.currentRoute.value.path).toBe('/start/invite')

    // Закрыли на шаге партнёра — холодный запуск возвращает к тратам (FB-21: пройденный шаг трат нигде не записан —
    // «мечта есть → траты»), не к началу и не ко второй мечте; «Позже» — снова партнёр.
    await coldStart(A)
    expect(title()).toBe('Тратьте как обычно')
    expect(document.querySelector('[data-intro-page]')).toBeNull()
    await tap('Позже')
    expect(title()).toBe('Пригласите партнёра')
    await tap('Пропустить')
    expect(A.finance.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(A.finance.setupDone).toBe(true)
    expect(A.finance.people[0].onboardedAt).toBeTruthy()
    expect(landingPath(useAuthStore(), A.finance)).toBe('/')
  })

  it('(ж) код выдан, первый участник закрыл приложение до «Готово» → партнёр по коду: путь партнёра (без мечты и без приглашения) и семья настроена', async () => {
    server = fakeServer({
      ...defaultSyncDoc(),
      people: [{ id: 'a', name: 'Алихан', salary: 600_000, payday: 10, updatedAt: '2025-07-26T07:00:00.000Z' }],
      goals: [],
    } as SyncDoc)
    const B = await phone('b')
    expect(landingPath(useAuthStore(), B.finance)).toBe('/start')
    const router = await coldStart(B)
    expect(await throughIntro(router)).toBe('/start/spend')
    expect(page()).not.toContain('На что копим?')
    await tap('Позже')
    expect(router.currentRoute.value.path).toBe('/')
    expect(B.finance.setupDone).toBe(true)
    expect(B.finance.people.find((p) => p.id === 'b')).toMatchObject({ onboardedAt: expect.stringMatching(/^2025-07-27T07:00/) })
  })
})
