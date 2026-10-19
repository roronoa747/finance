// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiAdvice, AiReview, Obligation, SyncDoc } from '@/types/finance'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * RZ-10 (бэклог «Разбор», Р-9, Р-23): ✦ у предметов советов на «Месяце» (строка раздела, платёж, подписка в группе) и
 * «Деньгах» (платёж, подписка): отдельная кнопка рядом с кнопкой строки — нажатие открывает отчёт на карточке совета,
 * строка своего листа не открывает; свёрнутые раздел и «Подписки · N» зовут тем же ✦ без кнопки; viewer видит так же;
 * разбора нет — ✦ нет. Приложение — `RouterView` с маршрутами: ✦ с «Денег» переходит на «Месяц».
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

const sub = (id: string, name: string, day: number, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day, category: 'd4', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
})
const advice = (target: Extract<AiAdvice['action'], { kind: 'open' }>['target']): AiAdvice => ({
  title: `Совет ${target.name}`, text: 'Текст.', figure: null, action: { kind: 'open', target },
})
/** Разбор v3 сентября: 1 — раздел «Кафе», 2 — аренда, 3 — подписка iCloud. */
const review: AiReview = {
  id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
  v: 3, reason: 'month', where: '', work: { ops: 10, found: 3, yearly: 0 },
  advices: [
    advice({ kind: 'cat', id: 'sc_cafe', name: 'Кафе' }),
    advice({ kind: 'obligation', id: 'rent', name: 'Аренда' }),
    advice({ kind: 'obligation', id: 'icloud', name: 'iCloud' }),
  ],
}
function familyDoc(reviews: AiReview[] = [review]): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    obligations: [...doc.obligations, sub('netflix', 'Netflix', 5, 5_000), sub('icloud', 'iCloud', 15, 1_500)],
    spendPlans: [
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 40_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
    ],
    aiReviews: reviews,
  })
}

async function mount(opts: { role?: 'member' | 'viewer'; doc?: SyncDoc; path?: string } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData(authAs(opts.role ?? 'member', opts.role === 'viewer' ? 'b' : 'a'))
  auth.ai = true
  useFinanceStore().setHouseholdDoc(opts.doc ?? familyDoc(), 1)
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(opts.path ?? '/month')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await vi.waitFor(() => expect(document.querySelector(opts.path?.startsWith('/money') ? '[data-payments]' : '[data-sections]')).not.toBeNull())
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
const mark = (row: string) => q(`${row} [data-advice-mark]`)
const activeTitle = () => txt(q('[data-report-card][data-active] [data-review-advice-title]'))

describe('RZ-10: ✦ у предметов на «Месяце» и «Деньгах»', () => {
  it('«Месяц»: свёрнутые разделы зовут ✦; раскрыл — ✦ у раздела и у платежа, кнопка рядом с кнопкой строки, не внутри', async () => {
    await mount()
    expect(q('[data-section="spend"] [data-section-mark]')).not.toBeNull()
    expect(q('[data-section="dues"] [data-section-mark]')).not.toBeNull()
    expect(txt(q('[data-section="spend"]'))).toContain('есть совет ИИ')
    expect(q('[data-section="queue"] [data-section-mark]')).toBeNull()

    await press(q('[data-section="spend"]'))
    const cafe = mark('[data-spend-row="sc_cafe"]')!
    expect(cafe.tagName).toBe('BUTTON')
    expect(cafe.getAttribute('aria-label')).toBe('Совет ИИ')
    expect(cafe.dataset.adviceCard).toBe('1')
    expect(mark('[data-spend-row="sc_food"]')).toBeNull()
    // Кнопка строки — название; ✦ не вложен в неё.
    const rowBtn = q('[data-spend-row="sc_cafe"] [data-row-open]')!
    expect(rowBtn.tagName).toBe('BUTTON')
    expect(rowBtn.querySelector('button')).toBeNull()

    await press(q('[data-section="dues"]'))
    expect(mark('[data-due-id="obligation:rent"]')!.dataset.adviceCard).toBe('2')
    expect(q('[data-due-id="obligation:rent"] [data-row-open] button')).toBeNull()
    // iCloud — в свёрнутой «Подписки · N»: группа зовёт ✦, раскрыл — ✦ у подписки.
    expect(q('[data-subs] [data-subs-mark]')).not.toBeNull()
    expect(mark('[data-due-id="obligation:icloud"]')).toBeNull()
    await press(q('[data-subs] button'))
    expect(mark('[data-due-id="obligation:icloud"]')!.dataset.adviceCard).toBe('3')
    expect(mark('[data-due-id="obligation:netflix"]')).toBeNull()
  })

  it('нажатие ✦ — отчёт на карточке совета, лист строки не открыт; нажатие строки — прежний лист', async () => {
    await mount()
    await press(q('[data-section="spend"]'))
    await go(mark('[data-spend-row="sc_cafe"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?review=1&card=1'), { timeout: 5000 })
    await flush()
    expect(q('[data-report]')).not.toBeNull()
    expect(activeTitle()).toBe('Совет Кафе')
    expect(all('[role="dialog"]').filter((d) => !d.hasAttribute('data-report'))).toHaveLength(0)

    await press(q('[data-report-close]'))
    await vi.waitFor(() => expect(q('[data-report]')).toBeNull())
    await press(q('[data-spend-row="sc_cafe"] [data-row-open]'))
    expect(txt(q('[role="dialog"]'))).toContain('Кафе')
    expect(q('[data-report]')).toBeNull()
  })

  it('viewer — те же ✦; разбора нет — ✦ нет ни у строк, ни у разделов', async () => {
    await mount({ role: 'viewer' })
    await press(q('[data-section="spend"]'))
    expect(mark('[data-spend-row="sc_cafe"]')!.dataset.adviceCard).toBe('1')
    app!.unmount()
    document.body.innerHTML = ''

    await mount({ doc: familyDoc([]) })
    expect(q('[data-section-mark]')).toBeNull()
    await press(q('[data-section="spend"]'))
    await press(q('[data-section="dues"]'))
    expect(q('[data-advice-mark]')).toBeNull()
  })

  it('«Деньги»: ✦ у платежа и у подписки в группе (группа зовёт ✦); нажатие — «Месяц» с отчётом на карточке совета', async () => {
    await mount({ path: '/money' })
    expect(mark('[data-payments] [data-payment]:not([data-subs] *)')).not.toBeNull()
    const rent = all('[data-payments] > [data-payment]').find((el) => txt(el).includes('Аренда'))!
    expect(rent.querySelector<HTMLElement>('[data-advice-mark]')!.dataset.adviceCard).toBe('2')
    expect(rent.querySelector('[data-advice-mark]')!.closest('button:not([data-advice-mark])')).toBeNull()
    expect(q('[data-subs] [data-subs-mark]')).not.toBeNull()
    await press(q('[data-subs] button'))
    const icloud = all('[data-subs] [data-payment]').find((el) => txt(el).includes('iCloud'))!
    expect(icloud.querySelector<HTMLElement>('[data-advice-mark]')!.dataset.adviceCard).toBe('3')

    await go(icloud.querySelector<HTMLElement>('[data-advice-mark]'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?review=1&card=3'), { timeout: 5000 })
    await vi.waitFor(() => expect(q('[data-report]')).not.toBeNull(), { timeout: 5000 })
    await flush()
    expect(activeTitle()).toBe('Совет iCloud')
  })
})
