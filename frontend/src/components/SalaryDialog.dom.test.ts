// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { salaryAt } from '@/lib/finance'
import { FX_BOOK_KEY } from '@/lib/storage'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import SalaryDialog from './SalaryDialog.vue'

/**
 * Форма оклада в валюте (B2C-78): чипы валют, сумма в евро с прошлого месяца, тихая строка
 * «≈ N ₸ по курсу Нацбанка» (курс — сегодняшний из книги), запись версии с `currency`/`rate`;
 * валюты нет в книге и ручка молчит — поле курса руками. Числа — ручной расчёт в комментариях.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  // Синк и /api/fx-rate: сети нет — запрос падает, курс публичной ручки не приходит.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount() {
  // Книга на телефоне: евро 24.09 — 511,40; 10.09 (день зарплаты) — 510,00.
  localStorage.setItem(FX_BOOK_KEY, JSON.stringify({ book: { EUR: { '2026-09-10': 510, '2026-09-24': 511.4 } }, covered: {} }))
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(SalaryDialog, { id: 'a' }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  return store
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const text = () => (document.body.textContent ?? '').replace(/[  ]/g, ' ')
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
  await Promise.resolve()
}

describe('SalaryDialog — оклад в валюте', () => {
  it('евро с прошлого месяца: строка «≈ N ₸», версия с валютой и курсом, «Доход» в тенге по книге', async () => {
    const store = await mount()
    button('Изменить оклад').click()
    await flush()
    ;(document.querySelector('button[aria-label="EUR"]') as HTMLButtonElement).click()
    await flush()
    expect(text()).toContain('Новый оклад, €')

    const amount = document.querySelector('input[inputmode]:focus, [class*="border-brand"] input[inputmode]') as HTMLInputElement
    amount.value = '1500'
    amount.dispatchEvent(new Event('input'))
    await flush()
    // 1 500 × 511,40 (сегодня) = 767 100 ₸.
    expect(text()).toContain('≈ 767 100 ₸ по курсу Нацбанка')

    const select = document.querySelector('select') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toContain('2024-09') // 24 месяца назад
    select.value = '2025-10'
    select.dispatchEvent(new Event('change'))
    await flush()
    button('Сохранить').click()
    await flush()

    const p = store.people.find((x) => x.id === 'a')!
    expect(p.salaryVersions).toContainEqual({ from: '2025-10', amount: 1_500, currency: 'EUR', rate: 511.4, reason: undefined })
    expect(p.salary).toBe(700_000) // тенговое значение по умолчанию не тронуто
    // Сентябрь: 1 500 × 510 (10.09) = 765 000 ₸; без книги — по курсу версии 1 500 × 511,4 = 767 100 ₸.
    expect(salaryAt(p, '2026-09', { EUR: { '2026-09-10': 510 } })).toBe(765_000)
    expect(salaryAt(p, '2026-09')).toBe(767_100)
    // Форма показывает оклад в евро и тенге за этот месяц.
    expect(text()).toContain('Оклад сейчас, €')
    expect(text()).toContain('≈ 765 000 ₸ по курсу Нацбанка')
  })

  it('валюты нет в книге и ручка молчит — поле курса руками; без курса «Сохранить» называет курс', async () => {
    const store = await mount()
    button('Изменить оклад').click()
    await flush()
    ;(document.querySelector('button[aria-label="CNY"]') as HTMLButtonElement).click()
    await flush()
    await flush()
    expect(text()).toContain('Курс, ₸ за 1 ¥')
    const inputs = [...document.querySelectorAll('[class*="border-brand"] input[inputmode]')] as HTMLInputElement[]
    inputs[0].value = '10000'
    inputs[0].dispatchEvent(new Event('input'))
    await flush()
    button('Сохранить').click()
    await flush()
    expect(text()).toContain('Нет курса — попробуйте позже')
    expect(store.people.find((x) => x.id === 'a')!.salaryVersions?.some((x) => x.currency === 'CNY')).toBeFalsy()
    inputs[1].value = '66,8'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    expect(text()).not.toContain('Нет курса — попробуйте позже')
    button('Сохранить').click()
    await flush()
    const v = store.people.find((x) => x.id === 'a')!.salaryVersions!.find((x) => x.currency === 'CNY')
    expect(v).toMatchObject({ amount: 10_000, currency: 'CNY', rate: 66.8 })
  })

  it('тенге — как раньше: версия без валюты и курса', async () => {
    const store = await mount()
    button('Изменить оклад').click()
    await flush()
    const amount = document.querySelector('[class*="border-brand"] input[inputmode]') as HTMLInputElement
    amount.value = '800000'
    amount.dispatchEvent(new Event('input'))
    await flush()
    expect(text()).not.toContain('по курсу Нацбанка')
    button('Сохранить').click()
    await flush()
    const v = store.people.find((x) => x.id === 'a')!.salaryVersions!.at(-1)!
    expect(v).toMatchObject({ amount: 800_000 })
    expect(v).not.toHaveProperty('currency')
    expect(v).not.toHaveProperty('rate')
  })
})
