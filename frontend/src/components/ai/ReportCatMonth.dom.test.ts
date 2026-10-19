// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, createWebHistory, RouterView, type Router } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiAdvice, AiReview, SyncDoc } from '@/types/finance'
import type { SpendTotal } from '@/lib/statements/types'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * RZ-13 (Х-9, владелец 2026-10-19 «А»): 12 сентября выписка ни у кого не дошла до 7-го — картинка «Куда ушло» и находки
 * об августе. Строка «Куда ушло» и «Открыть» совета раздела ведут на `/month?month=2026-08&cat=` — лист раздела августа
 * (сводка прошлого месяца `MonthPast`) с названием месяца и его цифрой, без «Изменить»; лист текущего месяца — с
 * «Изменить». Х-10: «Открыть» → «Назад» — отчёт на той же карточке (веб-история роутера).
 */
let app: App | null = null
let router: Router
const NOW = '2026-09-12T07:00:00Z'
const KEY = '2026-09'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('офлайн'))))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({
    uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-08-31', ops_count: 40, created_at: T0 }],
  } as never)
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const total = (period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `a:month:${period}:${categoryId}`, by: 'a', kind: 'month', period, categoryId, amount, ops: 4, updatedAt: T0,
})
const advice = (title: string, target: Extract<AiAdvice['action'], { kind: 'open' }>['target']): AiAdvice => ({ title, text: `${title}.`, figure: null, action: { kind: 'open', target } })
const review: AiReview = {
  id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
  v: 3, reason: 'month', where: 'Кафе выросло.', work: { ops: 40, found: 2, yearly: 0 },
  advices: [advice('Мечта', { kind: 'goal', id: 'trip', name: 'Отпуск' }), advice('Кафе', { kind: 'cat', id: 'sc_cafe', name: 'Кафе' })],
}
const doc = (): SyncDoc =>
  planFamilyDoc({
    spendTotals: [total('2026-06', 'sc_cafe', 30_000), total('2026-07', 'sc_cafe', 30_000), total('2026-08', 'sc_cafe', 90_000), total(KEY, 'sc_cafe', 5_000)],
    spendPlans: [{ id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 40_000, updatedAt: T0 }],
    aiReviews: [review],
  })

async function mount(path: string, web = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData(authAs('member', 'a'))
  auth.ai = true
  useFinanceStore().setHouseholdDoc(doc(), 1)
  if (web) window.history.replaceState(null, '', '/')
  router = createRouter({ history: web ? createWebHistory() : createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await vi.waitFor(() => expect(document.querySelector('[data-month-nav]')).not.toBeNull(), { timeout: 5000 })
  await flush()
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
/** Нажатие ссылки: ждём сам переход (ленивый экран маршрута грузится дольше тика). */
const go = async (el: HTMLElement | null | undefined) => {
  const spy = vi.spyOn(router, 'push')
  await press(el)
  await spy.mock.results.at(-1)?.value
  spy.mockRestore()
  await flush()
}
const sheet = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => !d.hasAttribute('data-report')) ?? null

describe('RZ-13: лист раздела того месяца, что на картинке', () => {
  it('строка «Куда ушло» и «Открыть» раздела — `?month=2026-08&cat=`; лист августа с названием месяца, его цифрой, без «Изменить»', async () => {
    await mount('/month?review=1')
    await vi.waitFor(() => expect(q('[data-where-row="sc_cafe"]')).not.toBeNull(), { timeout: 5000 })
    expect(txt(q('[data-review-where-month]'))).toBe('в августе')
    expect(q('[data-where-row="sc_cafe"]')!.getAttribute('href')).toBe('/month?month=2026-08&cat=sc_cafe')
    const links = [...document.querySelectorAll<HTMLElement>('[data-review-link]')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/goals/trip', '/month?month=2026-08&cat=sc_cafe'])

    await go(q('[data-where-row="sc_cafe"]'))
    expect(router.currentRoute.value.fullPath).toBe('/month?month=2026-08&cat=sc_cafe')
    await vi.waitFor(() => expect(q('[data-month-past]')).not.toBeNull())
    expect(q('[data-report]')).toBeNull()
    await vi.waitFor(() => expect(sheet()).not.toBeNull())
    expect(txt(sheet()!.querySelector('[data-cat-month]'))).toBe('август')
    expect(txt(sheet()!.querySelector('[data-cat-amount]'))).toMatch(/^90\s000 ₸$/)
    // План каждого — тот же общий план раздела (критик Блока 3: строка участника не пустая).
    expect(txt(sheet()!.querySelector('[data-cat-person="a"]'))).toMatch(/40\s000/)
    expect(sheet()!.querySelector('[data-cat-edit]')).toBeNull()
  })

  it('неверный месяц в адресе (не месяц, дальше года назад, будущий) — лист раздела текущего месяца с «Изменить» (критик Блока 3)', async () => {
    for (const month of ['2026-8', 'abc', '2025-01', '2027-03']) {
      await mount(`/month?month=${month}&cat=sc_cafe`)
      await vi.waitFor(() => expect(sheet()).not.toBeNull())
      expect(txt(sheet()!.querySelector('[data-cat-month]')), month).toBe('сентябрь')
      expect(sheet()!.querySelector('[data-cat-edit]'), month).not.toBeNull()
      app!.unmount()
      app = null
      document.body.innerHTML = ''
    }
  })

  it('лист текущего месяца — «сентябрь», его цифра и «Изменить» у участника', async () => {
    await mount('/month?cat=sc_cafe')
    await vi.waitFor(() => expect(sheet()).not.toBeNull())
    expect(txt(sheet()!.querySelector('[data-cat-month]'))).toBe('сентябрь')
    // Выписка сентября до 7-го не дошла — у раздела план.
    expect(txt(sheet()!.querySelector('[data-cat-amount]'))).toContain('план')
    expect(sheet()!.querySelector('[data-cat-edit]')).not.toBeNull()
  })

  it('Х-10: «Открыть» совета → «Назад» — отчёт на карточке того же совета, не на первой', async () => {
    await mount('/month', true)
    await go(q('[data-review-open]'))
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull(), { timeout: 5000 })
    // Работа ИИ → Куда ушло → совет 1 → совет 2 («Кафе»).
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
      await flush()
    }
    const active = () => txt(q('[data-report-card][data-active] [data-review-advice-title]'))
    expect(active()).toBe('Кафе')
    // Карточка записана в перехвате — раньше обработчика самой ссылки (`RouterLink`): на телефоне переход успевает
    // создать новую запись истории до всплытия (стенд Х-10). Слушатель цели ставится после `RouterLink` — видит то,
    // что было записано до него (критик Блока 3: мутант «всплытие вместо перехвата» — красный).
    const link = q('[data-report-card][data-active] [data-review-link]')!
    let atLink: unknown = 'не нажато'
    link.addEventListener('click', () => (atLink = window.history.state?.reportCard), { once: true })
    await go(link)
    expect(atLink).toBe(3)
    expect(router.currentRoute.value.fullPath).toBe('/month?month=2026-08&cat=sc_cafe')
    await vi.waitFor(() => expect(q('[data-report]')).toBeNull())

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?review=1'), { timeout: 5000 })
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull(), { timeout: 5000 })
    await flush()
    expect(active()).toBe('Кафе')

    // Память одноразовая: прочитали — из записи истории стёрто.
    expect(window.history.state.reportCard).toBeUndefined()
  })

  it('Х-10 без веб-истории (память роутера): «Открыть» → «Назад» — отчёт как раньше, с первой карточки, без ошибок (критик Блока 3)', async () => {
    window.history.replaceState(null, '', '/')
    await mount('/month?review=1&card=2')
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull(), { timeout: 5000 })
    await flush()
    expect(txt(q('[data-report-card][data-active] [data-review-advice-title]'))).toBe('Кафе')
    await go(q('[data-report-card][data-active] [data-review-link]'))
    await vi.waitFor(() => expect(q('[data-report]')).toBeNull())
    expect(window.history.state).toBeNull()

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?review=1&card=2'), { timeout: 5000 })
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull(), { timeout: 5000 })
    await flush()
    // Памяти нет — старт по адресу: `card=2` — снова совет «Кафе».
    expect(txt(q('[data-report-card][data-active] [data-review-advice-title]'))).toBe('Кафе')
  })
})
