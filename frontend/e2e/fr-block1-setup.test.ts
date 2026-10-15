// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '../src/router'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { useEventsStore } from '../src/stores/events'
import { useOperationsStore } from '../src/stores/operations'
import { landingPath } from '../src/router/landing'
import { creditBalance } from '../src/lib/finance'
import { readStatementFiles } from '../src/lib/statements/read'
import type { PdfRow } from '../src/lib/statements/pdf'
import { parseStatement } from '../src/lib/statements/parsers'
import type { SyncDoc } from '../src/types/finance'
import Start from '../src/views/Start.vue'
import { at, backend, fakeServer, fakeStatements, statementsFor, type FakeServer } from './support/family'

/**
 * Бэклог «первый», Блок 1 (FR-04): критерии брифа сценариями первого запуска — экран смонтирован по-настоящему,
 * с роутером (адрес шага), документ уходит на Go-мок. (а) новая семья без выписки: вступление → мечта → зарплата →
 * «Пропустить» партнёра; (б) «Пропустить» вступления и мечты → «Мечты» без целей; (в) выписка Kaspi опцией у зарплаты →
 * вопросы → тот же документ, что в части 4 Блока 3 B2C; (г) партнёр по коду: вступление → зарплата → главный;
 * (д) перезагрузка посреди и старые адреса прежнего потока.
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

/** Первый запуск по адресу (как после «С кем ведём?» — `landingPath` → `/start`); перезагрузка — новый монтаж. */
async function open(p: Phone, path: string): Promise<Router> {
  app?.unmount()
  document.body.innerHTML = ''
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
  await nextTick()
  return router
}

const page = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const field = (label: string) =>
  [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent?.trim() === label)!.querySelector('input')!
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
  b!.click()
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

describe('e2e / бэклог «первый», Блок 1 — первый запуск без выписки (FR-01…FR-03)', () => {
  it('(а) новая семья: вступление → мечта из шаблона → зарплата руками → «Пропустить» партнёра → «Мечты»; документ: цель главная, оклад и день, setupDoneAt, onboardedAt; события first_run_goal, first_run_done', async () => {
    const A = await phone('a')
    expect(landingPath(useAuthStore(), A.finance)).toBe('/start')
    const router = await open(A, '/start')
    expect(await throughIntro(router)).toBe('/start/dream')

    expect(head()).toContain('1 из 3')
    await tap('Машина')
    await tap('Дальше')
    await type(document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!, '3000000')
    expect(page()).toContain('будет вашей в')
    expect(page()).not.toContain('при остатке')
    // `/ux`: в первом запуске дальше зарплата — кнопка «Дальше», а не «Готово — к мечте».
    expect(page()).not.toContain('Готово — к мечте')
    await tap('Дальше')
    expect(router.currentRoute.value.path).toBe('/start/salary')
    expect(events()).toEqual(['first_run_goal'])

    // Зарплата — без выписки: главная «Дальше», выписка — тихой кнопкой; «Пропустить» здесь нет.
    expect(title()).toBe('Зарплата')
    expect(head()).toContain('2 из 3')
    expect(button('Пропустить')).toBeUndefined()
    expect(button('Есть PDF из банка')).toBeDefined()
    await type(field('Зарплата в месяц, ₸'), '450000')
    // День — поле с записью по уходу фокуса (`NumFieldBlur`).
    await type(field('День зарплаты'), '12')
    field('День зарплаты').dispatchEvent(new Event('blur'))
    await nextTick()
    await tap('Дальше')
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(head()).toContain('3 из 3')

    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/')
    expect(A.finance.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(A.finance.queue[0].goal?.name).toBe('Машина')
    expect(A.finance.people).toEqual([expect.objectContaining({ id: 'a', name: 'Алихан', salary: 450_000, payday: 12, onboardedAt: '2025-07-27T07:00:00.000Z' })])
    expect(A.finance.setupDone).toBe(true)
    expect(A.finance.householdDoc.spendTotals ?? []).toEqual([])
    expect(events()).toEqual(['first_run_goal', 'first_run_done'])
    expect(landingPath(useAuthStore(), A.finance)).toBe('/')

    await synced(A)
    expect(server.data.setupDoneAt).toBeTruthy()
    expect(server.data.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(server.data.people).toEqual([expect.objectContaining({ id: 'a', salary: 450_000, payday: 12 })])
  })

  it('(б) «Пропустить» на вступлении и на мечте → зарплата → «Пропустить» партнёра → «Мечты» без целей; first_run_goal не пишется', async () => {
    const A = await phone('a')
    const router = await open(A, '/start')
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/start/dream')
    expect(page()).toContain('На что копим?')
    expect(button('Пока без мечты')).toBeUndefined()
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/start/salary')
    await type(field('Зарплата в месяц, ₸'), '300000')
    await tap('Дальше')
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/')
    expect(A.finance.goals).toEqual([])
    expect(A.finance.setupDone).toBe(true)
    expect(events()).toEqual(['first_run_done'])
    expect(landingPath(useAuthStore(), A.finance)).toBe('/')
  })

  it('приёмка — весь путь новой семьи: на каждом экране не больше одной брендовой кнопки, и ни главная, ни заголовок не про выписку', async () => {
    const A = await phone('a')
    const router = await open(A, '/start')
    const seen: string[] = []
    const check = (where: string) => {
      const live = (el: Element) => !el.closest('[aria-hidden="true"]')
      const brand = [...document.querySelectorAll('button')].filter((b) => live(b) && /(^|\s)bg-brand(\s|$)/.test(b.className))
      const texts = brand.map((b) => b.textContent!.trim())
      expect(brand.length, `${where}: брендовых ${texts.join(' | ')}`).toBeLessThanOrEqual(1)
      expect(texts.join(' '), `${where}: главная`).not.toMatch(/выписк|PDF/i)
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
    await tap('Дальше')
    await type(document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!, '3000000')
    check('форма мечты')
    await tap('Дальше')
    check('зарплата')
    await tap('Есть PDF из банка')
    check('раскрытие «Есть PDF из банка»')
    await tap('Назад')
    await type(field('Зарплата в месяц, ₸'), '450000')
    await tap('Дальше')
    expect(router.currentRoute.value.path).toBe('/start/invite')
    check('партнёр')
    expect(seen).toEqual([
      'вступление 1: Дальше', 'вступление 2: Дальше', 'вступление 3: Дальше', 'мечта: Дальше', 'форма мечты: Дальше',
      'зарплата: Дальше', 'раскрытие «Есть PDF из банка»: Выбрать файл', 'партнёр: Создать код',
    ])
  })
})

describe('e2e / бэклог «первый», Блок 1 — выписка опцией, партнёр, перезагрузка (FR-01…FR-03)', () => {
  it('(в) зарплата → «Есть PDF из банка» → Kaspi → вопросы по одному → документ тот же, что в части 4 Блока 3 B2C: оклад, кредит с остатком и отметкой июля, «Kaspi Red» — «Кредиты», подписка — быт', async () => {
    const A = await phone('a')
    const router = await open(A, '/start/salary')
    await tap('Есть PDF из банка')
    expect(title()).toBe('Ваш банк')
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
    expect(router.currentRoute.value.path).toBe('/start/questions')
    expect(head()).toContain('2 из 3')
    expect(ops.all).toHaveLength(60)

    expect(page()).toContain('Нашли 7 повторяющихся')
    expect(page()).toContain('Это ваш доход?')
    await tap('Да, это зарплата')
    expect(A.finance.people).toEqual([expect.objectContaining({ id: 'a', salary: 120_000, payday: 24 })])

    expect(page()).toContain('Оплата Kaspi Кредита — это что?')
    expect(button('Потом')).toBeUndefined()
    await type(field('Остаток долга, ₸ — если знаете'), '1200000')
    await tap('Записать')
    const credit = A.finance.householdDoc.credits.find((c) => c.name === 'Оплата Kaspi Кредита')!
    expect(credit).toMatchObject({ principal: 1_200_000, payment: 151_790, day: 24, annualRate: 0, rateUnknown: true })
    expect(A.finance.payments).toEqual([expect.objectContaining({ kind: 'credit', targetId: credit.id, period: '2025-07', amount: 151_790, source: 'statement' })])
    expect(creditBalance(credit, A.finance.payments)).toBe(1_200_000)
    expect(A.finance.merchantRules[0].to).toEqual({ payment: { kind: 'credit', targetId: credit.id, categoryId: 'sc_credit' } })

    await tap('Записать')
    await tap('Записать')
    const red = A.finance.obligations.find((o) => o.name === 'Оплата Kaspi Red')!
    expect(red.category).toBe('d2')
    expect(A.finance.payments.find((p) => p.targetId === red.id)).toMatchObject({ kind: 'obligation', period: '2025-07', amount: 45_000, source: 'statement' })
    expect(A.finance.obligations.find((o) => o.name === 'Яндекс Плюс')).toMatchObject({ category: 'd4' })

    // Остальные — «Пропустить» в шапке: закрыты без записи, дальше — партнёр (экрана «Ваш месяц» нет).
    const before = { obligations: A.finance.obligations.length, rules: A.finance.merchantRules.length }
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(A.finance.obligations).toHaveLength(before.obligations)
    expect(A.finance.merchantRules).toHaveLength(before.rules)
    expect(page()).not.toMatch(/Ваш (январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)/)
    await tap('Пропустить')
    expect(router.currentRoute.value.path).toBe('/')
    await synced(A)
    expect(server.data.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 1_200_000 })])
    expect(server.data.spendTotals!.some((t) => t.by === 'a' && t.kind === 'month' && t.period === '2025-07')).toBe(true)
  })

  it('(г) партнёр по коду: вступление → зарплата (один шаг — без «n из k») → главный; шагов мечты и партнёра нет, finishSetup не зовётся', async () => {
    server = fakeServer({
      ...defaultSyncDoc(),
      setupDoneAt: '2025-07-20T07:00:00.000Z',
      people: [{ id: 'a', name: 'Алихан', salary: 600_000, payday: 10, onboardedAt: '2025-07-20T07:00:00.000Z', updatedAt: '2025-07-20T07:00:00.000Z' }],
    } as SyncDoc)
    const B = await phone('b')
    expect(landingPath(useAuthStore(), B.finance)).toBe('/start')
    const finishSetup = vi.spyOn(B.finance, 'finishSetup')
    const router = await open(B, '/start')
    expect(await throughIntro(router)).toBe('/start/salary')
    expect(head()).not.toMatch(/\d из \d/)
    expect(page()).not.toContain('На что копим?')
    // Старые и чужие адреса партнёра — его первый шаг (вступление), не мечта и не приглашение.
    for (const path of ['/start/dream', '/start/invite', '/start/month']) {
      await open(B, path)
      expect(document.querySelector('[data-intro-page]'), path).not.toBeNull()
    }
    const back = await open(B, '/start/salary')
    await type(field('Зарплата в месяц, ₸'), '350000')
    await tap('Готово')
    expect(back.currentRoute.value.path).toBe('/')
    expect(finishSetup).not.toHaveBeenCalled()
    expect(B.finance.people.find((p) => p.id === 'b')).toMatchObject({ name: 'Дана', salary: 350_000, onboardedAt: '2025-07-27T07:00:00.000Z' })
    expect(B.finance.householdDoc.setupDoneAt).toBe('2025-07-20T07:00:00.000Z')
    expect(events()).toEqual(['first_run_done'])
    expect(landingPath(useAuthStore(), B.finance)).toBe('/')
  })

  it('(д) перезагрузка посреди: `/start/salary` после мечты — цель на месте, вступление не повторяется; старые `/start/upload` → зарплата, `/start/month` → партнёр', async () => {
    const A = await phone('a')
    const router = await open(A, '/start/intro')
    await tap('Пропустить')
    await tap('Машина')
    await tap('Дальше')
    await type(document.querySelector<HTMLInputElement>('input[placeholder="1 800 000"]')!, '3000000')
    await tap('Дальше')
    expect(router.currentRoute.value.path).toBe('/start/salary')

    // Перезагрузка: тот же адрес — тот же шаг; цель записана, гард с `/start` не выкидывает (своей записи ещё нет).
    await open(A, '/start/salary')
    expect(title()).toBe('Зарплата')
    expect(document.querySelector('[data-intro-page]')).toBeNull()
    expect(A.finance.goals.map((g) => g.name)).toEqual(['Машина'])
    expect(landingPath(useAuthStore(), A.finance)).toBe('/start')

    // Прежний поток на проде: `/start/upload` — шаг зарплаты, `/start/month` — пригласить партнёра.
    await open(A, '/start/upload')
    expect(title()).toBe('Зарплата')
    await type(field('Зарплата в месяц, ₸'), '500000')
    await tap('Дальше')
    await open(A, '/start/month')
    expect(title()).toBe('Пригласите партнёра')
    expect(head()).toContain('3 из 3')
  })
})
