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

  it('из тенговой выписки — тенговая запись суммой операции (банк уже обменял, B2C-80)', () => {
    const r = family().store.markSalary('a', { period: '2026-10', amount: 760_000, accountId: null, source: 'statement', opId: 'op1' })!
    expect(r).toMatchObject({ kind: 'salary', amount: 760_000, accountId: null, source: 'statement', opId: 'op1' })
    expect(r.foreign).toBeUndefined()
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
    // Тенге месяца (B2C-80): до обмена 1 500 × 502,98 (последний курс книги к 10.10) = 754 470 ₸.
    expect(text()).toContain('обменяно 0 € из 1 500 € · ≈ 754 470 ₸')
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
    // После обмена — сразу: 257 500 + 1 000 × 502,98 = 502 980 → 760 480 ₸.
    expect(text()).toContain('обменяно 500 € из 1 500 € · ≈ 760 480 ₸')
  })

  it('viewer видит строку, но не «Обменял»', async () => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-10' })
    useAuthStore().setAuthData(authAs('viewer'))
    await mount(pinia)
    expect(text()).toContain('обменяно 0 € из 1 500 €')
    expect(button('Обменял')).toBeUndefined()
  })

  it('лист обменов (B2C-79-а): «Отменить» → подтверждение → надгробие у одного, второй на месте', async () => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-10' })
    const kaspi = planFamilyDoc().accounts[0]
    const x1 = store.addExchange({ by: 'a', accountId: 'eur', toAccountId: kaspi.id, foreign: 500, rate: 515, period: '2026-10' })!
    const x2 = store.addExchange({ by: 'a', accountId: 'eur', toAccountId: null, foreign: 300, rate: 520.5, period: '2026-10' })!
    const kzt = () => store.accounts.find((a) => a.id === kaspi.id)!.amount
    const before = kzt()
    await mount(pinia)
    // 500 × 515 = 257 500; 300 × 520,5 = 156 150; 700 × 502,98 = 352 086 → 765 736 ₸.
    expect(text()).toContain('обменяно 800 € из 1 500 € · ≈ 765 736 ₸')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('обменяно'))!.click()
    await flush()
    expect(text()).toContain(`500 € по 515 → 257 500 ₸ ${kaspi.name} · 3 октября`)
    expect(text()).toContain('300 € по 520,5 → 156 150 ₸ не на счёт · 3 октября')
    // В листе нет брендовой кнопки — главное действие экрана остаётся «Обменял».
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect([...dialog.querySelectorAll('button')].some((b) => b.className.includes('bg-brand text-brand-ink'))).toBe(false)

    const cancels = () => [...dialog.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Отменить')
    expect(cancels()).toHaveLength(2)
    cancels()[0].click()
    await flush()
    // Подтверждение в том же листе; без «Отменить» во второй раз надгробия нет.
    expect(text()).toContain('Отменить обмен 500 €?')
    expect(store.fxExchanges.every((x) => !x.deletedAt)).toBe(true)
    button('Нет')!.click()
    await flush()
    expect(text()).not.toContain('Отменить обмен 500 €?')
    cancels()[0].click()
    await flush()
    cancels()[0].click() // у первого обмена «Отменить» сменилось подтверждением — первая теперь его
    await flush()
    expect(store.fxExchanges.find((x) => x.id === x1.id)!.deletedAt).toBeTruthy()
    expect(store.fxExchanges.find((x) => x.id === x2.id)!.deletedAt).toBeFalsy()
    expect(text()).not.toContain('500 € по 515')
    expect(text()).toContain('300 € по 520,5')
    // Остатки — из записей: Kaspi −257 500 ₸, евро-счёт +500 € (1 500 − 300).
    expect(kzt()).toBe(before - 257_500)
    expect(store.accounts.find((a) => a.id === 'eur')!.foreignAmount).toBe(1_200)
    // 300 × 520,5 = 156 150 + 1 200 × 502,98 = 603 576 → 759 726 ₸.
    expect(text()).toContain('обменяно 300 € из 1 500 € · ≈ 759 726 ₸')
  })

  it.each([
    ['viewer', authAs('viewer')],
    ['партнёр', authAs('member', 'b')],
  ])('%s открывает лист только для чтения — без «Отменить»', async (_, auth) => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-10' })
    store.addExchange({ by: 'a', accountId: 'eur', toAccountId: null, foreign: 500, rate: 515, period: '2026-10' })
    useAuthStore().setAuthData(auth)
    await mount(pinia)
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('обменяно'))!.click()
    await flush()
    expect(text()).toContain('500 € по 515 → 257 500 ₸')
    expect(button('Отменить')).toBeUndefined()
    expect(button('Обменял')).toBeUndefined()
  })

  it('отметку сняли, обмен жив (Н-6): строка и лист видны, без «Обменял»; отмена работает', async () => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-10' })
    store.addExchange({ by: 'a', accountId: 'eur', toAccountId: null, foreign: 500, rate: 515, period: '2026-10' })
    store.unmarkPaid('salary', 'a', '2026-10')
    expect(store.fxExchanges.every((x) => !x.deletedAt)).toBe(true) // снятие отметки обмены не трогает
    await mount(pinia)
    // До прихода необменянное — весь оклад: 257 500 + 1 000 × 502,98 = 502 980 → 760 480 ₸.
    expect(text()).toContain('обменяно 500 € · ≈ 760 480 ₸')
    expect(button('Обменял')).toBeUndefined()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('обменяно'))!.click()
    await flush()
    button('Отменить')!.click()
    await flush()
    button('Отменить')!.click()
    await flush()
    expect(store.fxExchanges[0].deletedAt).toBeTruthy()
    expect(text()).toBe('')
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
