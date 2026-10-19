// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { StepCandidate } from '@/lib/finance'
import type { AiAdvice, AiReview, SyncDoc } from '@/types/finance'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * RZ-11 (бэклог «Разбор», Р-9, Р-23): ✦ у мечты (герой и строка «Мечт», не желание), у срока на экране цели, у кредита на
 * «Долгах» и у целей и карточки долга в «Цели и фонды» «Месяца» (решение исполнителя: подушка — фонд, на «Мечтах» её нет).
 * Кнопка ✦ — рядом с кнопкой строки, не внутри; нажатие — отчёт на карточке совета, строка не открылась.
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
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const prepay: StepCandidate = { id: 'prepay', kind: 'prepay', shift: { period: KEY, from: 'rest', to: 'debt', amount: 50_000 }, effect: { months: 1, saved: 4_000 } }
const goalAdvice = (id: string, name: string): AiAdvice => ({ title: `Совет ${name}`, text: 'Текст.', figure: null, action: { kind: 'open', target: { kind: 'goal', id, name } } })
/** Разбор v3: 1 — мечта героя «Отпуск», 2 — мечта строки «Машина», 3 — досрочка в карточку долга. */
const review = (advices: AiAdvice[]): AiReview => ({
  id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
  v: 3, reason: 'month', where: '', work: { ops: 10, found: 2, yearly: 0 }, advices,
})
const advices = [goalAdvice('trip', 'Отпуск'), goalAdvice('car', 'Машина'), { title: 'Досрочно', text: 'Текст.', figure: null, action: { kind: 'do', candidate: prepay } } as AiAdvice]
function familyDoc(reviews: AiReview[] = [review(advices)]): SyncDoc {
  return planFamilyDoc({
    goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 },
    wishlist: [{ id: 'car', name: 'Наушники', price: 90_000, by: 'a', bought: false, updatedAt: T0 } as never],
    aiReviews: reviews,
  })
}

async function mount(path: string, opts: { role?: 'member' | 'viewer'; doc?: SyncDoc; ready: string } = { ready: 'body' }) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData(authAs(opts.role ?? 'member', opts.role === 'viewer' ? 'b' : 'a'))
  auth.ai = true
  useFinanceStore().setHouseholdDoc(opts.doc ?? familyDoc(), 1)
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await vi.waitFor(() => expect(document.querySelector(opts.ready)).not.toBeNull())
  await flush()
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
/** Нажатие, которое ведёт по адресу: ждём сам переход (ленивый экран маршрута под нагрузкой грузится дольше ожидания). */
const go = async (el: HTMLElement | null | undefined) => {
  const spy = vi.spyOn(router, 'push')
  await press(el)
  await spy.mock.results.at(-1)?.value
  spy.mockRestore()
  await flush()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const cards = () => all('[data-advice-mark]').map((b) => b.dataset.adviceCard)
const notNested = () => all('[data-advice-mark]').forEach((b) => expect(b.parentElement!.closest('button')).toBeNull())
const debtCredit = () => useFinanceStore().monthPlanOf(KEY).queue.find((x) => x.kind === 'debt')?.creditId

describe('RZ-11: ✦ на мечтах, экране цели, долгах и в «Цели и фонды»', () => {
  it('«Мечты»: ✦ у героя и у строки мечты из совета, у желания — нет; кнопка не вложена в кнопку строки', async () => {
    await mount('/', { ready: '[data-hero-line]' })
    expect(cards()).toEqual(['1', '2'])
    notNested()
    const hero = q('[data-hero-line]')!.parentElement!.querySelector<HTMLElement>('[data-advice-mark]')!
    expect(hero.dataset.adviceCard).toBe('1')
    const row = all('[data-row-open]').find((b) => txt(b) === 'Машина')!
    expect(row.tagName).toBe('BUTTON')
    expect(row.parentElement!.querySelector<HTMLElement>('[data-advice-mark]')!.dataset.adviceCard).toBe('2')
    // Желание «Наушники» (с тем же id, что у мечты) — без ✦.
    expect(all('[data-advice-mark]').some((b) => b.closest('[class*="fx-in"]')?.textContent?.includes('Наушники'))).toBe(false)
  })

  it('«Мечты»: нажатие ✦ строки — отчёт на карточке совета, экран цели не открыт; нажатие строки — экран цели', async () => {
    await mount('/', { ready: '[data-hero-line]' })
    const row = all('[data-row-open]').find((b) => txt(b) === 'Машина')!
    await go(row.parentElement!.querySelector<HTMLElement>('[data-advice-mark]'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?review=1&card=2'), { timeout: 5000 })
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull(), { timeout: 5000 })
    await flush()
    expect(txt(q('[data-report-card][data-active] [data-review-advice-title]'))).toBe('Совет Машина')

    app!.unmount()
    document.body.innerHTML = ''
    await mount('/', { ready: '[data-hero-line]' })
    await go(all('[data-row-open]').find((b) => txt(b) === 'Машина'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/goals/car'), { timeout: 5000 })
  })

  it('экран цели: ✦ у срока при совете (и у viewer), без совета — нет', async () => {
    await mount('/goals/car', { ready: '[data-goal-term]' })
    expect(q('[data-goal-term] [data-advice-mark]')!.dataset.adviceCard).toBe('2')
    app!.unmount()
    document.body.innerHTML = ''
    await mount('/goals/car', { role: 'viewer', ready: '[data-goal-term]' })
    expect(q('[data-goal-term] [data-advice-mark]')!.dataset.adviceCard).toBe('2')
    app!.unmount()
    document.body.innerHTML = ''
    await mount('/goals/cushion', { ready: '[data-goal-term]' })
    expect(q('[data-advice-mark]')).toBeNull()
  })

  it('«Долги»: досрочка метит кредит карточки долга, «Открыть» долга — свой кредит; ✦ не в кнопке строки', async () => {
    await mount('/money/debts', { ready: '[data-debt-rows]' })
    const credit = debtCredit()!
    expect(q(`[data-debt="${credit}"] [data-advice-mark]`)!.dataset.adviceCard).toBe('3')
    expect(cards()).toEqual(['3'])
    notNested()
    app!.unmount()
    document.body.innerHTML = ''
    await mount('/money/debts', { ready: '[data-debt-rows]', doc: familyDoc([review([{ title: 'Долг', text: 'Текст.', figure: null, action: { kind: 'open', target: { kind: 'credit', id: 'inst', name: 'Рассрочка' } } }])]) })
    expect(q('[data-debt="inst"] [data-advice-mark]')!.dataset.adviceCard).toBe('1')
    // Нажатие строки — лист кредита, не отчёт.
    await press(q('[data-debt="inst"] [data-row-open]'))
    expect(router.currentRoute.value.query.review).toBeUndefined()
    expect(q('[role="dialog"]')).not.toBeNull()
  })

  it('«Месяц» · «Цели и фонды»: раздел зовёт ✦; раскрыл — ✦ у целей и у карточки долга', async () => {
    await mount('/month', { ready: '[data-sections]' })
    expect(q('[data-section="queue"] [data-section-mark]')).not.toBeNull()
    await press(q('[data-section="queue"]'))
    expect(q('[data-queue="trip"] [data-advice-mark]')!.dataset.adviceCard).toBe('1')
    expect(q('[data-queue="car"] [data-advice-mark]')!.dataset.adviceCard).toBe('2')
    expect(q('[data-queue="cushion"] [data-advice-mark]')).toBeNull()
    const debtRow = all('[data-queue]').find((el) => !['trip', 'car', 'cushion'].includes(el.dataset.queue!))!
    expect(debtRow.querySelector<HTMLElement>('[data-advice-mark]')!.dataset.adviceCard).toBe('3')
    notNested()
  })
})
