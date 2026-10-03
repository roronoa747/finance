// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { FX_BOOK_KEY } from '@/lib/storage'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import type { Account } from '@/types/finance'
import SalaryExchange from './SalaryExchange.vue'

/**
 * «Пришла зарплата» в валюте и «Обменял» (B2C-79): приход пишет `foreign`/`currency` на валютный
 * счёт; лист «Обменял» — сумма по умолчанию (необменянное), итог «= N ₸», одна брендовая
 * «Записать», запись `fxExchanges` без правки `payments`; viewer «Обменял» не видит.
 */

let app: App | null = null
const T0 = '2026-09-01T00:00:00.000Z'
const eurAcc: Account = { id: 'eur', name: 'Евро-счёт', note: '', amount: 0, amountSetAt: T0, kind: 'card', currency: 'EUR', foreignAmount: 0, rate: 500, updatedAt: T0 }

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-03T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function family(role: 'member' | 'viewer' = 'member', accounts: Account[] = [eurAcc]) {
  // Книга: евро 03.10 — 502,98.
  localStorage.setItem(FX_BOOK_KEY, JSON.stringify({ book: { EUR: { '2026-10-03': 502.98 } }, covered: {} }))
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role))
  const store = useFinanceStore()
  const doc = planFamilyDoc()
  doc.people[0] = { ...doc.people[0], salaryVersions: [{ from: '2025-10', amount: 1_500, currency: 'EUR', rate: 505.5 }] }
  doc.accounts = [...doc.accounts, ...accounts]
  store.setHouseholdDoc(doc, 1)
  return { pinia, store }
}

async function mount(pinia: ReturnType<typeof createPinia>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(SalaryExchange, { personId: 'a', period: '2026-10' }) })
  app.use(pinia)
  app.mount(root)
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const text = () => (document.body.textContent ?? '').replace(/[  ]/g, ' ')
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined

describe('приход валютной зарплаты (стор)', () => {
  it('пишет foreign и currency на валютный счёт той же валюты; тенге — по курсу дня прихода: 1 500 × 502,98 = 754 470 ₸', () => {
    const { store } = family()
    const r = store.markSalary('a', { period: '2026-10' })!
    expect(r).toMatchObject({ kind: 'salary', foreign: 1_500, currency: 'EUR', amount: 754_470, accountId: 'eur' })
    expect(store.accounts.find((a) => a.id === 'eur')).toMatchObject({ foreignAmount: 1_500, amount: 754_470 })
  })

  it('тенговый счёт валютную зарплату не получает; валютного нет — «не зачислено»', () => {
    const a = family().store.markSalary('a', { period: '2026-10', accountId: planFamilyDoc().accounts[0].id })!
    expect(a.accountId).toBeNull()
    const b = family('member', []).store.markSalary('a', { period: '2026-10' })!
    expect(b).toMatchObject({ accountId: null, foreign: 1_500 })
  })

  it('«Евро-счёт» одним нажатием — общий валютный счёт с курсом сегодня', () => {
    const { store } = family('member', [])
    const id = store.addFxAccount('EUR')
    expect(store.accounts.find((a) => a.id === id)).toMatchObject({ name: 'Евро-счёт', currency: 'EUR', foreignAmount: 0, rate: 502.98 })
  })

  it('«Обменял» пишет запись и не трогает payments; отмена — надгробие', () => {
    const { store } = family()
    store.markSalary('a', { period: '2026-10' })
    const before = JSON.stringify(store.payments)
    const x = store.addExchange({ by: 'a', accountId: 'eur', toAccountId: null, foreign: 500, rate: 515, period: '2026-10' })!
    expect(x).toMatchObject({ currency: 'EUR', foreign: 500, rate: 515, tenge: 257_500 })
    expect(JSON.stringify(store.payments)).toBe(before)
    expect(store.accounts.find((a) => a.id === 'eur')!.foreignAmount).toBe(1_000)
    store.undoExchange(x.id)
    expect(store.fxExchanges[0].deletedAt).toBeTruthy()
    expect(store.accounts.find((a) => a.id === 'eur')!.foreignAmount).toBe(1_500)
    // С тенгового счёта обмен не пишется.
    expect(store.addExchange({ by: 'a', accountId: planFamilyDoc().accounts[0].id, toAccountId: null, foreign: 1, rate: 1, period: '2026-10' })).toBeNull()
  })
})

describe('SalaryExchange — строка и лист «Обменял»', () => {
  it('строка «обменяно 0 € из 1 500 €», лист: сумма по умолчанию, итог, одна брендовая «Записать»', async () => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-10' })
    await mount(pinia)
    expect(text()).toContain('обменяно 0 € из 1 500 €')
    button('Обменял')!.click()
    await flush()

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const inputs = [...dialog.querySelectorAll('input[inputmode]')] as HTMLInputElement[]
    expect(inputs[0].value.replace(/[  ]/g, ' ')).toBe('1 500')
    expect(text()).toContain('Нацбанк сегодня — 502,98 ₸')
    inputs[0].value = '500'
    inputs[0].dispatchEvent(new Event('input'))
    inputs[1].value = '515'
    inputs[1].dispatchEvent(new Event('input'))
    await flush()
    // 500 × 515 = 257 500 ₸.
    expect(text()).toContain('= 257 500 ₸')
    // Брендовая кнопка кита — `bg-brand text-brand-ink`; в листе она одна.
    const brand = [...dialog.querySelectorAll('button')].filter((b) => b.className.includes('bg-brand text-brand-ink'))
    expect(brand.map((b) => b.textContent?.trim())).toEqual(['Записать'])
    expect(button('Записать')!.disabled).toBe(true) // счёт зачисления ещё не выбран
    const kaspi = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.includes('Kaspi Gold'))!
    kaspi.click()
    await flush()
    button('Записать')!.click()
    await flush()
    expect(store.fxExchanges).toHaveLength(1)
    expect(store.fxExchanges[0]).toMatchObject({ foreign: 500, rate: 515, tenge: 257_500, toAccountId: planFamilyDoc().accounts[0].id })
    expect(text()).toContain('обменяно 500 € из 1 500 €')
  })

  it('viewer видит строку, но не «Обменял»', async () => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-10' })
    useAuthStore().setAuthData(authAs('viewer'))
    await mount(pinia)
    expect(text()).toContain('обменяно 0 € из 1 500 €')
    expect(button('Обменял')).toBeUndefined()
  })

  it('тенговая зарплата — ничего не рисует', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member'))
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    store.markSalary('a', { period: '2026-10' })
    await mount(pinia)
    expect(text()).toBe('')
  })
})
