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
import { useApplePayStore } from '@/stores/applepay'
import { applyRules } from '@/lib/statements/model'
import { parseStatement } from '@/lib/statements/parsers'
import { readStatementFiles } from '@/lib/statements/read'
import type { PdfRow } from '@/lib/statements/pdf'
import { isDark } from '@/lib/theme'
import Start from './Start.vue'

// Чтение PDF — в браузере (pdf.js); здесь — готовый разбор фикстуры Kaspi (шаг «Тратьте как обычно» → выписка).
vi.mock('@/lib/statements/read', () => ({ readStatementFiles: vi.fn() }))

/**
 * Первый запуск «сначала траты» (Блок 5 «Фидбек», Р-35, FB-21; FR-01…FR-03, DOM, роутер): вступление → мечта →
 * «Тратьте как обычно» → партнёр; выходы — `/week` после выписки, лист Apple Pay после плитки, главный после «Позже»;
 * партнёр по коду — `intro → spend` → главный. На всех выходах — `finishSetup` и `onboardedAt`. «Это ваш доход?» и
 * «Записать?» первого запуска больше нет — вопросы «Недели» и «нашли в выписке» «Месяца» (свои тесты).
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
const page = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
async function click(el: HTMLElement) {
  el.click()
  await nextTick()
  await nextTick()
}
const stepper = () => document.querySelector('.type-meta')?.textContent?.replace(/\s+/g, ' ').trim()
/** Выписка на шаге трат: файл → `readStatementFiles` (мок) → отправка как после «Отправить» (сеть в тесте не отвечает). */
async function uploadKaspi(ops: ReturnType<typeof useOperationsStore>) {
  const parsed = kaspi()
  vi.mocked(readStatementFiles).mockResolvedValue({ ok: [{ name: 'выписка.pdf', parsed }], errors: [] })
  vi.spyOn(ops, 'send').mockImplementation(async () => {
    for (const o of applyRules(parsed.operations, [])) ops.ops[o.id] = o
  })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File(['%PDF'], 'выписка.pdf', { type: 'application/pdf' })] })
  input.dispatchEvent(new Event('change'))
  await settle()
  await settle()
}

describe('FB-21: мечта → «Тратьте как обычно» → партнёр; выходы (DOM, роутер)', () => {
  it('«Позже»: «Пропустить» мечту → траты («2 из 3») → «Позже» — партнёр без вопросов → «Пропустить» — главный, семья настроена, onboardedAt', async () => {
    const { finance, router } = await mountStart('/start/dream')
    expect(page()).toContain('На что копим?')
    expect(stepper()).toBe('1 из 3')
    await click(button('Пропустить'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/spend')
    expect(stepper()).toBe('2 из 3')
    expect(page()).toContain('Тратьте как обычно')
    // Зарплату не спрашивают: полей оклада нет.
    expect(page()).not.toContain('Зарплата в месяц')
    await click(button('Позже'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(stepper()).toBe('3 из 3')
    expect(finance.people.find((p) => p.id === 'a')?.salary ?? 0).toBe(0)
    await click(button('Пропустить'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/')
    expect(finance.setupDone).toBe(true)
    expect(finance.people[0]).toMatchObject({ id: 'a', name: 'Алихан', onboardedAt: '2026-09-24T07:00:00.000Z' })
  })

  it('выписка: файл → операции в сторе, вопросов нет → партнёр → «Пропустить» — «Неделя» (неделя выписки на экране), finishSetup и onboardedAt', async () => {
    const { finance, router, ops } = await mountStart('/start/spend')
    const finishSetup = vi.spyOn(finance, 'finishSetup')
    expect(button('Загрузить выписку')).toBeTruthy()
    await uploadKaspi(ops)
    expect(Object.keys(ops.ops).length).toBeGreaterThan(0)
    expect(router.currentRoute.value.path).toBe('/start/invite')
    expect(page()).not.toContain('Это ваш доход?')
    expect(finance.people.find((p) => p.id === 'a')?.salary ?? 0).toBe(0)
    await click(button('Пропустить'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/week')
    expect(finishSetup).toHaveBeenCalled()
    expect(finance.people[0].onboardedAt).toBe('2026-09-24T07:00:00.000Z')
  })

  it('Apple Pay: плитка только на iPhone; выбрана — «Подключить Apple Pay» → партнёр → «Пропустить» — лист подключения `/settings?applepay=1`', async () => {
    const { router } = await mountStart('/start/spend')
    expect(document.querySelector('[data-start-path="applepay"]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''

    const second = await mountStart('/start/spend')
    const ap = useApplePayStore()
    ap.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    ap.status = { connected: false, phones: 0, waiting: false, shortcut_url: 'https://example.test/shortcut', shortcut_url_legacy: 'https://example.test/legacy' } as never
    await nextTick()
    const tile = document.querySelector<HTMLElement>('[data-start-path="applepay"]')
    expect(tile).not.toBeNull()
    expect(document.querySelector('[data-start-path="statement"]')!.getAttribute('aria-pressed')).toBe('true')
    await click(tile!)
    expect(tile!.getAttribute('aria-pressed')).toBe('true')
    expect(button('Подключить Apple Pay')).toBeTruthy()
    expect(button('Загрузить выписку')).toBeUndefined()
    await click(button('Подключить Apple Pay'))
    await settle()
    expect(second.router.currentRoute.value.path).toBe('/start/invite')
    await click(button('Пропустить'))
    await settle()
    expect(second.router.currentRoute.value.fullPath).toBe('/settings?applepay=1')
    expect(second.finance.setupDone).toBe(true)
    void router
  })

  it('партнёр по коду: после вступления — сразу траты (единственный шаг — без «1 из 1»), «Позже» — главный: onboardedAt без оклада, finishSetup не зовётся', async () => {
    const { finance, router } = await mountStart('/start/spend', 'b')
    const finishSetup = vi.spyOn(finance, 'finishSetup')
    expect(page()).not.toContain('На что копим?')
    expect(page()).toContain('Тратьте как обычно')
    expect(stepper()).toBeUndefined()
    await click(button('Позже'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/')
    expect(finance.people.find((p) => p.id === 'b')).toMatchObject({ onboardedAt: '2026-09-24T07:00:00.000Z' })
    expect(finance.people.find((p) => p.id === 'b')?.salary ?? 0).toBe(0)
    expect(finishSetup).not.toHaveBeenCalled()
    expect(finance.householdDoc.setupDoneAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('старые адреса: `/start/salary` и `/start/questions` → траты, `/start/month` → партнёр', async () => {
    const { router } = await mountStart('/start/salary')
    expect(router.currentRoute.value.path).toBe('/start/salary')
    expect(page()).toContain('Тратьте как обычно')
    app?.unmount()
    document.body.innerHTML = ''
    const q = await mountStart('/start/questions')
    expect(page()).toContain('Тратьте как обычно')
    void q
    app?.unmount()
    document.body.innerHTML = ''
    await mountStart('/start/month')
    expect(page()).toContain('Пригласите партнёра')
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

  it('«Пропустить» — сразу мечта; партнёр по коду: вступление → траты; тёмная тема — `-dark.webp`', async () => {
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
    expect(partner.router.currentRoute.value.path).toBe('/start/spend')
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

/* ------------------ FR-03: «Пропустить» в шапке ------------------ */

describe('FR-03: «Пропустить» — в шапке необязательных шагов, внизу одна главная (DOM, роутер)', () => {
  const head = () => document.querySelector('[data-start-head]')!
  const skipInHead = () => [...head().querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Пропустить')
  const skips = () => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Пропустить')

  it('есть на вступлении, мечте, тратах и партнёре — одной кнопкой в шапке; шапка липкая; на тратах внизу одна брендовая', async () => {
    for (const path of ['/start/intro', '/start/dream', '/start/spend', '/start/invite']) {
      await mountStart(path)
      expect(skipInHead(), path).toBe(true)
      expect(skips(), path).toHaveLength(1)
      expect(head().className).toContain('sticky')
      app?.unmount()
      document.body.innerHTML = ''
    }
    await mountStart('/start/spend')
    const bottom = [...document.querySelectorAll('button')].filter((b) => !head().contains(b) && b.className.includes('bg-brand'))
    expect(bottom.map((b) => b.textContent?.trim())).toEqual(['Загрузить выписку'])
  })

  it('мечта: «Пока без мечты» внизу нет, «Пропустить» → траты без цели; траты: «Пропустить» = «Позже» → партнёр; партнёр: внизу одна «Создать код», «Пропустить» — onboardedAt и first_run_done', async () => {
    const { finance, router } = await mountStart('/start/dream')
    expect(button('Пока без мечты')).toBeUndefined()
    await click(button('Пропустить'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/spend')
    expect(finance.goals).toEqual([])
    await click(button('Пропустить'))
    await settle()
    expect(router.currentRoute.value.path).toBe('/start/invite')
    app?.unmount()
    document.body.innerHTML = ''

    const invite = await mountStart('/start/invite')
    const { useEventsStore } = await import('@/stores/events')
    const track = vi.spyOn(useEventsStore(), 'track')
    expect(button('Позже')).toBeUndefined()
    expect(page()).not.toContain('Один человек — тоже семья')
    const bottom = [...document.querySelectorAll('button')].filter((b) => !head().contains(b) && b.className.includes('bg-brand'))
    expect(bottom.map((b) => b.textContent?.trim())).toEqual(['Создать код'])
    await click(button('Пропустить'))
    await settle()
    expect(invite.router.currentRoute.value.path).toBe('/')
    expect(invite.finance.people.find((p) => p.id === 'a')?.onboardedAt).toBe('2026-09-24T07:00:00.000Z')
    expect(track).toHaveBeenCalledWith('first_run_done')
  })
})
