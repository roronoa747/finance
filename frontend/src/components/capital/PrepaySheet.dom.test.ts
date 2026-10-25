// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { lumpPlan } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import CreditSheet from './CreditSheet.vue'
import PrepaySheet from './PrepaySheet.vue'
import PayoffSheet from './PayoffSheet.vue'

/**
 * F2-04 (Р-3): «Внёс досрочно» — небольшой кнопкой у остатка в листе кредита, лист взноса поверх, калькулятор — за
 * «Подробнее»; блока «Применить к кредиту» в калькуляторе нет, из него — тихая «Внёс досрочно» с суммой.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  // Правка планирует синк — сети в тесте нет, запрос просто не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function family(role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  return { pinia, store }
}

function mount(pinia: ReturnType<typeof createPinia>, render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.use(pinia)
  app.mount(root)
}

const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
/** Лист взноса — последний открытый (поверх листа кредита или калькулятора). */
const top = () => dialogs().at(-1)!
const button = (text: string, root: ParentNode = top()) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)
async function type(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
const prepays = (store: ReturnType<typeof useFinanceStore>) => store.payments.filter((p) => p.kind === 'prepay' && !p.deletedAt)

describe('F2-04: «Внёс досрочно» в листе кредита', () => {
  it('участник, кредит со ставкой — кнопка у остатка, «Посчитать досрочно» нет', async () => {
    const { pinia } = family()
    mount(pinia, () => h(CreditSheet, { creditId: 'loan', onClose: () => {} }))
    await nextTick()
    const btn = document.querySelector<HTMLElement>('[data-credit-prepay]')!
    expect(btn.textContent?.trim()).toBe('Внёс досрочно')
    // У своего предмета — в подписи «Остаток долга», рядом с полем.
    expect(btn.closest('label')?.textContent).toContain('Остаток долга')
    expect(top().textContent).not.toContain('Посчитать досрочно')
    expect(document.querySelector('[data-credit-payoff]')).toBeNull()
  })

  it('без ставки, долг человеку, остаток 0, viewer — кнопки нет', async () => {
    const cases: [string, (s: ReturnType<typeof useFinanceStore>) => string, 'member' | 'viewer'][] = [
      ['без ставки', (s) => s.addCredit({ name: 'Из выписки', principal: 500_000, annualRate: 0, rateUnknown: true, payment: 50_000, day: 5 }), 'member'],
      ['человеку', (s) => s.addCredit({ name: 'Брату', principal: 500_000, annualRate: 0, payment: 50_000, day: 5, person: true }), 'member'],
      ['остаток 0', (s) => s.addCredit({ name: 'Закрытый', principal: 0, annualRate: 0.2, payment: 50_000, day: 5 }), 'member'],
      ['viewer', () => 'loan', 'viewer'],
    ]
    for (const [name, add, role] of cases) {
      const { pinia, store } = family(role)
      const id = add(store)
      mount(pinia, () => h(CreditSheet, { creditId: id, onClose: () => {} }))
      await nextTick()
      expect(document.querySelector('[data-credit-prepay]'), name).toBeNull()
      app!.unmount()
      app = null
      document.body.innerHTML = ''
    }
  })

  it('«Внёс досрочно» → лист поверх; «Подробнее» просит калькулятор (payoff)', async () => {
    const { pinia } = family()
    const onPayoff = vi.fn()
    mount(pinia, () => h(CreditSheet, { creditId: 'loan', onClose: () => {}, onPayoff }))
    await nextTick()
    document.querySelector<HTMLElement>('[data-credit-prepay]')!.click()
    await nextTick()
    expect(dialogs()).toHaveLength(2)
    expect(top().textContent).toContain('Внёс досрочно')
    button('Подробнее')!.click()
    await nextTick()
    expect(onPayoff).toHaveBeenCalledWith('loan')
  })

  it('внесённые досрочки — тихая строка «Досрочные взносы · N» и у закрытого досрочкой долга', async () => {
    const { pinia, store } = family()
    store.applyPrepayment('cc', 'a', { amount: 300_000, mode: 'term', accountId: 'card' })
    expect(store.credits.find((c) => c.id === 'cc')!.principal).toBe(0)
    const onPayoff = vi.fn()
    mount(pinia, () => h(CreditSheet, { creditId: 'cc', onClose: () => {}, onPayoff }))
    await nextTick()
    expect(document.querySelector('[data-credit-prepay]')).toBeNull()
    const more = document.querySelector<HTMLElement>('[data-credit-payoff]')!
    expect(more.textContent?.trim()).toBe('Досрочные взносы · 1')
    more.click()
    expect(onPayoff).toHaveBeenCalledWith('cc')
  })
})

describe('F2-04: лист PrepaySheet', () => {
  const open = (pinia: ReturnType<typeof createPinia>, props: Record<string, unknown> = {}) =>
    mount(pinia, () => h(PrepaySheet, { creditId: 'loan', onClose: () => {}, ...props }))
  const amount = () => top().querySelector<HTMLInputElement>('[data-prepay-amount]')!

  it('сумма + счёт → applyPrepayment с { amount, mode, accountId }; остаток уменьшился', async () => {
    const { pinia, store } = family()
    const spy = vi.spyOn(store, 'applyPrepayment')
    open(pinia)
    await nextTick()
    await type(amount(), '200 000')
    ;[...top().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Kaspi Gold'))!.click()
    await nextTick()
    button('Внёс')!.click()
    await nextTick()
    expect(spy).toHaveBeenCalledWith('loan', 'a', { amount: 200_000, mode: 'term', accountId: 'card' })
    expect(store.credits.find((c) => c.id === 'loan')!.principal).toBe(800_000)
    expect(top().querySelector('[data-prepay-done]')).not.toBeNull()
  })

  it('без счёта — ошибка формы, записи нет; без суммы — тоже', async () => {
    const { pinia, store } = family()
    open(pinia)
    await nextTick()
    button('Внёс')!.click()
    await nextTick()
    expect(top().textContent).toContain('Впишите сумму')
    await type(amount(), '100 000')
    button('Внёс')!.click()
    await nextTick()
    expect(top().textContent).toContain('Выберите счёт')
    expect(prepays(store)).toHaveLength(0)
  })

  it('«Снизить платёж» меняет платёж кредита; предпросмотр — одна строка', async () => {
    const { pinia, store } = family()
    open(pinia)
    await nextTick()
    await type(amount(), '200 000')
    button('Снизить платёж')!.click()
    await nextTick()
    const plan = lumpPlan(1_000_000, 0.33, 58_000, 200_000, 'payment')!
    expect(top().querySelector('[data-prepay-preview]')!.textContent?.trim()).toBe(`Платёж ${money(plan.payment)} вместо ${money(58_000)}`)
    button('Не списывать — только отметить')!.click()
    await nextTick()
    button('Внёс')!.click()
    await nextTick()
    expect(store.credits.find((c) => c.id === 'loan')).toMatchObject({ principal: 800_000, payment: plan.payment })
  })

  it('сумма больше остатка — долг закрыт (остаток 0), взнос = остаток', async () => {
    const { pinia, store } = family()
    open(pinia, { creditId: 'cc' })
    await nextTick()
    await type(amount(), '500 000')
    expect(top().querySelector('[data-prepay-preview]')!.textContent?.trim()).toBe('Долг закроется этим взносом')
    button('Не списывать — только отметить')!.click()
    await nextTick()
    button('Внёс')!.click()
    await nextTick()
    expect(store.credits.find((c) => c.id === 'cc')!.principal).toBe(0)
    expect(prepays(store)[0].amount).toBe(300_000)
  })

  it('двойное нажатие подтверждения пишет одну досрочку', async () => {
    const { pinia, store } = family()
    open(pinia)
    await nextTick()
    await type(amount(), '100 000')
    button('Не списывать — только отметить')!.click()
    await nextTick()
    const apply = button('Внёс')!
    apply.click()
    apply.click()
    await nextTick()
    expect(prepays(store)).toHaveLength(1)
  })

  it('платёж не покрывает проценты — строка «экономию не считаем», без Infinity/NaN (Р-11)', async () => {
    const { pinia, store } = family()
    const id = store.addCredit({ name: 'Тяжёлый', principal: 1_000_000, annualRate: 0.36, payment: 25_000, day: 5 })
    open(pinia, { creditId: id })
    await nextTick()
    await type(amount(), '100 000')
    const text = top().textContent!
    expect(text).toContain('При текущем платеже долг не закрывается — экономию не считаем')
    expect(text).not.toMatch(/Infinity|NaN/)
  })

  it('viewer — лист не открывается', async () => {
    const { pinia } = family('viewer')
    open(pinia)
    await nextTick()
    expect(dialogs()).toHaveLength(0)
  })
})

describe('F2-04: калькулятор PayoffSheet', () => {
  it('блока «Применить к кредиту» нет; «Внёс досрочно» в «Разово» открывает лист с суммой калькулятора', async () => {
    const { pinia } = family()
    mount(pinia, () => h(PayoffSheet, { creditId: 'loan', onClose: () => {} }))
    await nextTick()
    button('Разово')!.click()
    await nextTick()
    const input = top().querySelector<HTMLInputElement>('input')!
    await type(input, '150 000')
    expect(top().textContent).not.toContain('Применить к кредиту')
    expect(top().textContent).not.toContain('Откуда списать')
    document.querySelector<HTMLElement>('[data-payoff-prepay]')!.click()
    await nextTick()
    expect(dialogs()).toHaveLength(2)
    expect(top().querySelector<HTMLInputElement>('[data-prepay-amount]')!.value).toBe(plain(150_000))
  })
})
