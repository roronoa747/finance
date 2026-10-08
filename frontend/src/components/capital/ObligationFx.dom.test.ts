// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { FX_BOOK_KEY } from '@/lib/storage'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import NewObligationSheet from './NewObligationSheet.vue'
import ObligationSheet from './ObligationSheet.vue'
import PaymentLine from '@/components/money/PaymentLine.vue'

/**
 * Подписка в валюте (B2C-81, Р-75): форма — чипы валют (тенге по умолчанию), сумма в долларах, тихая
 * строка «≈ N ₸ по курсу Нацбанка», версия с `currency`/`rate`; список «Платежей» — «15 $» в подписи и
 * тенге по курсу дня списания; «Оплатил» пишет эти тенге. Числа — ручной расчёт в комментариях.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(component: Component, props: Record<string, unknown>) {
  // Книга: доллар 03.10 — 471,20 (сегодня, воскресенье 04.10, — курс субботы); 09.10 впереди — нет.
  localStorage.setItem(FX_BOOK_KEY, JSON.stringify({ book: { USD: { '2026-10-03': 471.2 } }, covered: {} }))
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(component, props) })
  app.use(pinia)
  app.mount(root)
  await flush()
  return store
}

const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
const text = () => (document.body.textContent ?? '').replace(/[  ]/g, ' ')
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
  await Promise.resolve()
}
const type = async (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}

describe('подписка в долларах', () => {
  it('новая: тенге по умолчанию, $ — строка «≈ 7 068 ₸» (15 × 471,20), версия с валютой и курсом', async () => {
    const store = await mount(NewObligationSheet, { open: true })
    expect(document.querySelector('button[aria-label="KZT"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(text()).toContain('Сумма в месяц, ₸')
    const [name] = [...document.querySelectorAll('input')] as HTMLInputElement[]
    await type(name, 'Netflix')
    ;(document.querySelector('button[aria-label="USD"]') as HTMLButtonElement).click()
    await flush()
    expect(text()).toContain('Сумма в месяц, $')
    const amount = [...document.querySelectorAll('input[inputmode]')][0] as HTMLInputElement
    await type(amount, '15')
    expect(text()).toContain('≈ 7 068 ₸ по курсу Нацбанка')
    button('Добавить').click()
    await flush()
    const o = store.obligations.find((x) => x.name === 'Netflix')!
    expect(o.versions).toEqual([{ from: '2000-01', amount: 15, currency: 'USD', rate: 471.2 }])
  })

  it('список: «10-го · 15 $» и тенге по курсу; «Оплатил» пишет эти тенге', async () => {
    const store = await mount(PaymentLine, { item: { kind: 'obligation', obligation: { id: 'nf' } }, period: '2026-10' })
    store.addObligation({ name: 'Netflix', day: 10, category: 'd4', amount: 15, fx: { currency: 'USD', rate: 470 } })
    const o = store.obligations.find((x) => x.name === 'Netflix')!
    app!.unmount()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(PaymentLine, { item: { kind: 'obligation', obligation: o }, period: '2026-10' }) })
    app.use(createPiniaFrom())
    app.mount(root)
    await flush()
    // 10.10 впереди — последний курс книги 471,20: 15 × 471,2 = 7 068 ₸.
    expect(text()).toContain('10-го · 15 $')
    expect(text()).toContain('7 068 ₸')
    // «Оплатил» без суммы — тенге по курсу дня списания (Р-75).
    store.markPaid('obligation', o.id, 'a', { period: '2026-10', accountId: null })
    expect(store.payments.find((p) => p.targetId === o.id)).toMatchObject({ kind: 'obligation', period: '2026-10', amount: 7_068 })
  })

  it('правка: сумма в своей валюте, «≈ N ₸», история в долларах; смена суммы — версия с месяца в валюте', async () => {
    const store = await mount(ObligationSheet, { obligationId: null })
    store.addObligation({ name: 'Netflix', day: 10, category: 'd4', amount: 15, fx: { currency: 'USD', rate: 470 } })
    const o = store.obligations.find((x) => x.name === 'Netflix')!
    app!.unmount()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(ObligationSheet, { obligationId: o.id }) })
    app.use(createPiniaFrom())
    app.mount(root)
    await flush()
    expect(text()).toContain('Сумма сейчас, $')
    expect(text()).toContain('≈ 7 068 ₸ по курсу Нацбанка')
    button('Запланировать изменение').click()
    await flush()
    expect(document.querySelector('button[aria-label="USD"]')!.getAttribute('aria-pressed')).toBe('true')
    const planned = document.querySelector('[class*="border-brand"] input[inputmode]') as HTMLInputElement
    await type(planned, '18')
    // 18 × 471,2 = 8 481,6 → 8 482 ₸; рост 8 482 − 7 068 = 1 414 ₸ в месяц.
    expect(text()).toContain('≈ 8 482 ₸ по курсу Нацбанка')
    expect(text()).toContain('платёж вырастет на 1 414 ₸')
    button('Запланировать').click()
    await flush()
    expect(store.obligations.find((x) => x.id === o.id)!.versions.at(-1)).toMatchObject({ from: '2026-11', amount: 18, currency: 'USD', rate: 471.2 })
    expect(text()).toContain('18 $')
  })
})

/** Тот же pinia, что у стора: активный — последний созданный в `mount`. */
function createPiniaFrom() {
  return (useFinanceStore() as unknown as { _p: ReturnType<typeof createPinia> })._p
}

describe('центы в долларах (ML-09, хвост 1000)', () => {
  it('«9,99 $»: подсказка «Округлим до 10 $», сохраняется 10, а не 999; тенге — без запятой', async () => {
    const store = await mount(NewObligationSheet, { open: true })
    const [name] = [...document.querySelectorAll('input')] as HTMLInputElement[]
    await type(name, 'Spotify')
    const amount = () => [...document.querySelectorAll('input[inputmode]')][0] as HTMLInputElement
    await type(amount(), '9,99')
    expect(amount().value).toBe('999')
    ;(document.querySelector('button[aria-label="USD"]') as HTMLButtonElement).click()
    await flush()
    await type(amount(), '9,99')
    expect(amount().value).toBe('9,99')
    expect(amount().getAttribute('inputmode')).toBe('decimal')
    expect(text()).toContain('Округлим до 10 $')
    // 10 × 471,20 = 4 712 ₸.
    expect(text()).toContain('≈ 4 712 ₸ по курсу Нацбанка')
    button('Добавить').click()
    await flush()
    const o = store.obligations.find((x) => x.name === 'Spotify')!
    expect(o.versions).toEqual([{ from: '2000-01', amount: 10, currency: 'USD', rate: 471.2 }])
  })
})
