// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { applyRules } from '@/lib/statements/model'
import { parseStatement } from '@/lib/statements/parsers'
import { readStatementFiles } from '@/lib/statements/read'
import type { PdfRow } from '@/lib/statements/pdf'
import { plain } from '@/lib/money'
import type { Operation } from '@/lib/statements/types'
import type { SyncDoc } from '@/types/finance'
import { isDark } from '@/lib/theme'
import Start from './Start.vue'

// Чтение PDF — в браузере (pdf.js); здесь — готовый разбор фикстуры Kaspi (FR-01: «Есть PDF из банка» → вопросы).
vi.mock('@/lib/statements/read', () => ({ readStatementFiles: vi.fn() }))

/**
 * Возврат приёмки 2 п. 1: первый запуск не стирает введённое, когда приходит синк. Вопросы
 * пересобираются при каждой подмене документа (синк после ответа, `focus`, фоновый круг), а поля
 * карточки сбрасывались на каждый новый объект вопроса: исправленный оклад откатывался к выписке,
 * введённый остаток кредита стирался («Записать» давал обязательство вместо кредита), выбранный чип
 * возвращался. Подмена здесь — как у `pull`: новый объект документа с новой ревизией.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  // Синк документа по таймеру (таймеры поддельные) — сети в тесте нет, запрос не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'upsertOperations').mockResolvedValue({ upserted: 0 })
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const op = (id: string, date: string, amount: number, merchant: string, kind: Operation['kind'] = 'purchase'): Operation => ({
  id, bank: 'kaspi', date, amount, kind, merchant, categoryId: null, internal: false,
})

/** Новая семья после разбора выписки: зарплата, кредит Kaspi, аренда переводом. */
async function openQuestions() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'Алихан', role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.setHouseholdDoc(defaultSyncDoc(), 1)
  const store = useOperationsStore()
  const list = applyRules(
    [
      op('s8', '2026-08-12', 300_000, 'Зарплата ТОО Ромашка', 'income'),
      op('s9', '2026-09-12', 300_000, 'Зарплата ТОО Ромашка', 'income'),
      op('c8', '2026-08-05', -151_790, 'Оплата Kaspi Кредита'),
      op('c9', '2026-09-05', -151_790, 'Оплата Kaspi Кредита'),
      op('r8', '2026-08-03', -220_000, 'PEREVOD ARENDA', 'transfer-out'),
      op('r9', '2026-09-03', -220_000, 'PEREVOD ARENDA', 'transfer-out'),
      op('k8', '2026-08-20', -45_000, 'Оплата Kaspi Red'),
      op('k9', '2026-09-20', -45_000, 'Оплата Kaspi Red'),
    ],
    [],
  )
  for (const o of list) store.ops[o.id] = o

  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/start/questions')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Start)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  /** Синк, возврат в приложение, фоновый круг: документ с сервера — новый объект, та же суть. */
  const pull = async () => {
    finance.setHouseholdDoc(JSON.parse(JSON.stringify(finance.householdDoc)) as SyncDoc, 2)
    await nextTick()
    await nextTick()
  }
  return { finance, store, pull }
}

const page = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
const field = (label: string) =>
  [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent?.trim() === label)!.querySelector('input')!
async function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}
async function click(el: HTMLElement) {
  el.click()
  await nextTick()
  await nextTick()
}

describe('views/Start.vue — синк посреди вопроса не стирает введённое (возврат приёмки 2 п. 1, DOM)', () => {
  it('исправленный оклад, остаток кредита и выбранный чип переживают подмену документа; «Записать» пишет введённое', async () => {
    const { finance, pull } = await openQuestions()

    // Доход: оклад исправлен 300 000 → 350 000, пришёл синк — поле то же, «Да» пишет 350 000.
    expect(page()).toContain('Это ваш доход?')
    await type(field('Оклад, ₸'), '350000')
    await pull()
    expect(field('Оклад, ₸').value).toBe(plain(350_000))
    await click(button('Да, это зарплата'))
    expect(finance.people.find((p) => p.id === 'a')).toMatchObject({ salary: 350_000, payday: 12 })
    await pull()

    // Аренда: выбран чип «Аренда», синк — чип тот же, «Записать» — обязательство «Аренда» в жилье.
    expect(page()).toContain('PEREVOD ARENDA — это что?')
    await click(button('Аренда'))
    await pull()
    expect(button('Аренда').getAttribute('aria-pressed')).toBe('true')
    await click(button('Записать'))
    expect(finance.obligations).toEqual([expect.objectContaining({ name: 'Аренда', category: 'd1', note: 'PEREVOD ARENDA' })])
    await pull()

    // Кредит: остаток «если знаете» введён, синк — остаток на месте, «Записать» — кредит с остатком и без ставки.
    expect(page()).toContain('Оплата Kaspi Кредита — это что?')
    await type(field('Остаток долга, ₸ — если знаете'), '1200000')
    await pull()
    expect(field('Остаток долга, ₸ — если знаете').value).toBe(plain(1_200_000))
    await click(button('Записать'))
    expect(finance.householdDoc.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, rateUnknown: true, payment: 151_790 })])
    expect(finance.obligations.map((o) => o.name)).toEqual(['Аренда'])

    // Следующий вопрос-кредит: поля сброшены — остаток 1 200 000 не переезжает в Kaspi Red, «Записать» без остатка — обязательство.
    expect(page()).toContain('Оплата Kaspi Red — это что?')
    expect(field('Остаток долга, ₸ — если знаете').value).toBe('')
    await click(button('Записать'))
    expect(finance.householdDoc.credits).toHaveLength(1)
    expect(finance.obligations.map((o) => o.name)).toEqual(['Аренда', 'Оплата Kaspi Red'])
  })

  it('критик возврата 2: вторая выписка меняет кандидата дохода — поля обновляются (ключ дохода — с отправителем), «Да» пишет нового', async () => {
    const { finance, store } = await openQuestions()
    expect(page()).toContain('ТОО Ромашка')
    expect(field('Оклад, ₸').value).toBe(plain(300_000))
    // Загружена Freedom с большим регулярным приходом — кандидат дохода теперь ТОО Лютик 500 000 · 25-го.
    for (const o of applyRules([op('l8', '2026-08-25', 500_000, 'Зарплата ТОО Лютик', 'income'), op('l9', '2026-09-25', 500_000, 'Зарплата ТОО Лютик', 'income')], [])) store.ops[o.id] = o
    await nextTick()
    await nextTick()
    expect(page()).toContain('ТОО Лютик')
    expect(field('Оклад, ₸').value).toBe(plain(500_000))
    expect(field('День').value).toBe('25')
    await click(button('Да, это зарплата'))
    expect(finance.people.find((p) => p.id === 'a')).toMatchObject({ salary: 500_000, payday: 25 })
  })
})

/* ------------------ FR-01: путь первого запуска (бэклог «первый») ------------------ */

const fixtures = import.meta.glob<PdfRow[]>('../lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })
const kaspi = () => parseStatement(fixtures['../lib/statements/fixtures/kaspi-01.rows.json'])

/** Первый запуск по адресу: новая семья (`a`) или партнёр по коду (`b` в настроенной семье). */
async function mountStart(path: string, slot: 'a' | 'b' = 'a') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't', user: { id: `u-${slot}`, email: `${slot}@b.kz`, created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: `u-${slot}`, slot, display_name: slot === 'a' ? 'Алихан' : 'Дана', role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  const doc = defaultSyncDoc()
  if (slot === 'b') Object.assign(doc, { people: [{ id: 'a', name: 'Алихан', salary: 600_000, payday: 10, updatedAt: '2026-09-01T00:00:00.000Z' }], setupDoneAt: '2026-09-01T00:00:00.000Z' })
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Start)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return { finance, router, ops: useOperationsStore() }
}
/** Переход роутера (ленивый экран — динамический импорт) и перерисовка; `setTimeout` в тесте поддельный. */
async function settle() {
  for (let i = 0; i < 5; i++) await vi.dynamicImportSettled()
  await nextTick()
  await nextTick()
}
const stepper = () => document.querySelector('.type-meta')?.textContent?.replace(/\s+/g, ' ').trim()

describe('FR-01: мечта → зарплата → партнёр; выписка — опцией у зарплаты (DOM, роутер)', () => {
  it('без выписки: «Пока без мечты» → зарплата («2 из 3») → «Дальше» — партнёр без вопросов → «Позже» — главный, семья настроена', async () => {
    const { finance, router } = await mountStart('/start/dream')
    expect(page()).toContain('На что копим?')
    expect(stepper()).toBe('1 из 3')
    await click(button('Пока без мечты'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/salary')
    expect(stepper()).toBe('2 из 3')
    await type(field('Зарплата в месяц, ₸'), '450000')
    await click(button('Дальше'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(finance.people[0]).toMatchObject({ id: 'a', salary: 450_000, payday: 10 })
    expect(stepper()).toBe('3 из 3')
    await click(button('Позже'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/')
    expect(finance.setupDone).toBe(true)
    expect(finance.people[0].onboardedAt).toBe('2026-09-24T07:00:00.000Z')
  })

  it('«Есть PDF из банка» → «Назад» к полям; файл → вопросы («2 из 3») → «Да, это зарплата», «Потом» → партнёр', async () => {
    const { finance, router, ops } = await mountStart('/start/salary')
    await click(button('Есть PDF из банка'))
    expect(page()).toContain('Ваш банк')
    expect(button('Выбрать файл')).toBeTruthy()
    await click(button('Назад'))
    expect(field('Зарплата в месяц, ₸')).toBeTruthy()
    await click(button('Есть PDF из банка'))

    const parsed = kaspi()
    vi.mocked(readStatementFiles).mockResolvedValue({ ok: [{ name: 'выписка.pdf', parsed }], errors: [] })
    // Отправка — как после «Отправить»: операции в своей копии стора (сеть в тесте не отвечает).
    vi.spyOn(ops, 'send').mockImplementation(async () => {
      for (const o of applyRules(parsed.operations, [])) ops.ops[o.id] = o
    })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['%PDF'], 'выписка.pdf', { type: 'application/pdf' })] })
    input.dispatchEvent(new Event('change'))
    await settle()
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/questions')
    expect(stepper()).toBe('2 из 3')
    expect(page()).toContain('Это ваш доход?')
    await click(button('Да, это зарплата'))
    expect(finance.people[0]).toMatchObject({ salary: 120_000, payday: 24 })
    await click(button('Потом'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
  })

  it('партнёр по коду: после вступления — сразу зарплата («1 из 1»), «Готово» — главный: свой оклад и onboardedAt, finishSetup не зовётся', async () => {
    const { finance, router } = await mountStart('/start/salary', 'b')
    const finishSetup = vi.spyOn(finance, 'finishSetup')
    expect(page()).not.toContain('На что копим?')
    expect(stepper()).toBe('1 из 1')
    await type(field('Зарплата в месяц, ₸'), '300000')
    await click(button('Готово'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/')
    expect(finance.people.find((p) => p.id === 'b')).toMatchObject({ salary: 300_000, onboardedAt: '2026-09-24T07:00:00.000Z' })
    expect(finishSetup).not.toHaveBeenCalled()
    expect(finance.householdDoc.setupDoneAt).toBe('2026-09-01T00:00:00.000Z')
  })
})

/* ------------------ FR-02: вступление — три образа ------------------ */

describe('FR-02: вступление — три экрана-образа перед первым шагом (DOM, роутер)', () => {
  afterEach(() => {
    isDark.value = false
  })
  const current = () => [...document.querySelectorAll<HTMLElement>('[data-intro-page]')].find((s) => s.getAttribute('aria-hidden') === 'false')!

  it('новая семья: `/start` — вступление без «n из k», точки и «Пропустить»; «Дальше» × 3 → мечта, назад к вступлению не ведёт', async () => {
    const { router } = await mountStart('/start')
    expect(document.querySelectorAll('[data-intro-page]')).toHaveLength(3)
    expect(document.querySelector('[data-intro-dots]')).not.toBeNull()
    expect(page()).not.toMatch(/\d из \d/)
    expect(button('Пропустить')).toBeTruthy()
    expect(current().querySelector('h1')!.textContent).toBe('Мечта')
    // Картинка в теме экрана: светлая — `-light.webp`; первая грузится сразу, остальные — лениво.
    const imgs = [...document.querySelectorAll('[data-intro-page] img')]
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/landing/dream-light.webp', '/landing/free-light.webp', '/landing/leaks-light.webp'])
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual([null, 'lazy', 'lazy'])
    await click(button('Дальше'))
    expect(current().querySelector('h1')!.textContent).toBe('Свободно')
    await click(button('Дальше'))
    expect(current().querySelector('h1')!.textContent).toBe('Утечки')
    await click(button('Дальше'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/dream')
    expect(page()).toContain('На что копим?')
    expect(stepper()).toBe('1 из 3')
    // `replace`: в истории вступления нет — «назад» к нему не возвращает.
    router.back()
    await settle()
    expect(router.currentRoute.value.path).not.toBe('/start')
  })

  it('«Пропустить» — сразу мечта; партнёр по коду: вступление → зарплата; тёмная тема — `-dark.webp`', async () => {
    const { router } = await mountStart('/start')
    await click(button('Пропустить'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/dream')
    app?.unmount()
    document.body.innerHTML = ''

    isDark.value = true
    const partner = await mountStart('/start', 'b')
    expect(document.querySelector('[data-intro-page] img')!.getAttribute('src')).toBe('/landing/dream-dark.webp')
    await click(button('Пропустить'))
    await settle()
    expect(partner.router.currentRoute.value.path).toBe('/start/salary')
  })

  it('свайп: влево — следующий экран, вправо — предыдущий; короткий жест и края ленты — без смены', async () => {
    await mountStart('/start/intro')
    const strip = document.querySelector('[data-intro-page]')!.parentElement!.parentElement!
    const swipe = async (from: number, to: number) => {
      strip.dispatchEvent(Object.assign(new Event('touchstart'), { touches: [{ clientX: from }] }))
      strip.dispatchEvent(Object.assign(new Event('touchend'), { changedTouches: [{ clientX: to }] }))
      await nextTick()
    }
    const title = () => current().querySelector('h1')!.textContent
    await swipe(100, 130)
    expect(title()).toBe('Мечта')
    await swipe(300, 100)
    expect(title()).toBe('Свободно')
    await swipe(300, 290)
    expect(title()).toBe('Свободно')
    await swipe(300, 100)
    await swipe(300, 100)
    expect(title()).toBe('Утечки')
    await swipe(100, 300)
    expect(title()).toBe('Свободно')
  })
})
