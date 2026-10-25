// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { openDebt } from '../src/lib/finance'
import { money } from '../src/lib/money'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Приёмка Блока 2 «Фидбек-2» (F2-04, F2-05) — сценарии, которых нет у исполнителя: вход с «Капитала» (не с «Долгов»),
 * первая досрочка без прошлой оплаты (счёт не выбран — «Внёс» не пишет), «Снизить платёж» — платёж кредита меньше, «было →
 * стало» = остаток всех долгов; партнёр видит взнос после синка, viewer — лист без кнопок. Калькулятор «Разово» с суммой
 * больше остатка → «Внёс досрочно» → кредит закрыт, калькулятор чистый, у закрытого — «Досрочные взносы · 1» → «Снять».
 * Семья `planFamilyDoc` без отметок, 12 сентября 2026.
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer

async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  return { pinia, client, store }
}

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await nextTick()
}

async function mount(p: Phone, path: string) {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(p.pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(p.pinia)
  app.use(router)
  app.mount(root)
  await tick()
}

const top = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const button = (text: string) => [...top().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!
const typeIn = async (el: HTMLInputElement, v: string) => {
  el.focus()
  el.value = v
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
}
const prepays = (p: Phone) => p.store.payments.filter((x) => x.kind === 'prepay' && !x.deletedAt)
const credit = (p: Phone, id: string) => p.store.credits.find((c) => c.id === id)!
const openCreditFromCapital = async (name: string) => {
  const row = [...document.querySelectorAll<HTMLElement>('[data-credits] *')].find((el) => el.textContent?.trim() === name)!
  row.click()
  await tick()
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  server = fakeServer(planFamilyDoc({ payments: [] }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('приёмка F2 Блок 2 — «Внёс досрочно» и «было → стало»', () => {
  it('«Капитал» → «Кредитка» → «Внёс досрочно»: без счёта не пишет; «Снизить платёж» → платёж меньше, «было → стало» всех долгов; партнёр видит, viewer без кнопок', async () => {
    const A = await phone('a')
    await mount(A, '/money')
    const debtBefore = openDebt(A.store.credits)
    const paymentBefore = credit(A, 'cc').payment
    await openCreditFromCapital('Кредитка')
    top().querySelector<HTMLElement>('[data-credit-prepay]')!.click()
    await tick()
    expect(top().textContent).toContain('Внёс досрочно')

    await typeIn(top().querySelector<HTMLInputElement>('[data-prepay-amount]')!, '100 000')
    button('Снизить платёж').click()
    await tick()
    expect(top().querySelector('[data-prepay-preview]')!.textContent).toMatch(/^Платёж .+ вместо /)
    // Первая досрочка, прошлой оплаты нет — счёт не выбран: «Внёс» показывает ошибку, записи нет.
    button('Внёс').click()
    await tick()
    expect(top().textContent).toContain('Выберите счёт')
    expect(prepays(A)).toHaveLength(0)

    const card = [...top().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Kaspi Gold'))!
    card.click()
    await tick()
    const apply = button('Внёс')
    apply.click()
    apply.click() // двойное касание до перерисовки — одна досрочка
    await tick()
    expect(prepays(A)).toHaveLength(1)
    const rec = prepays(A)[0]
    expect(rec).toMatchObject({ targetId: 'cc', amount: 100_000, principal: 100_000, accountId: 'card', mode: 'payment' })
    expect(credit(A, 'cc').payment).toBeLessThan(paymentBefore)
    expect(credit(A, 'cc').principal).toBe(200_000)
    expect(top().textContent).toContain('Молодец!')
    expect(top().querySelector('[data-prepay-before]')!.textContent!.trim()).toBe(money(debtBefore))
    expect(top().querySelector('[data-prepay-after]')!.textContent!.trim()).toBe(money(debtBefore - 100_000))
    expect(Number.isInteger(rec.saved)).toBe(true)
    button('Готово').click()
    await tick()
    expect(top().querySelector('[data-credit-payoff]')!.textContent).toContain('Досрочные взносы · 1')

    await A.store.syncHousehold(A.client)
    const B = await phone('b')
    expect(credit(B, 'cc')).toMatchObject({ principal: 200_000, payment: credit(A, 'cc').payment })
    expect(openDebt(B.store.credits)).toBe(debtBefore - 100_000)

    const V = await phone('a', 'viewer')
    await mount(V, '/money')
    await openCreditFromCapital('Кредитка')
    expect(top().querySelector('[data-credit-prepay]')).toBeNull()
  })

  it('калькулятор «Разово» больше остатка → «Внёс досрочно» с суммой → кредит закрыт, калькулятор чистый; у закрытого «Досрочные взносы · 1» → «Снять» возвращает', async () => {
    const A = await phone('a')
    await mount(A, '/money/debts')
    document.querySelector<HTMLElement>('[data-debt="cc"]')!.click()
    await tick()
    top().querySelector<HTMLElement>('[data-credit-prepay]')!.click()
    await tick()
    button('Подробнее').click()
    await tick()
    // Калькулятор поверх: «Разово» → сумма больше остатка → тихая «Внёс досрочно».
    button('Разово').click()
    await tick()
    await typeIn(top().querySelector<HTMLInputElement>('input')!, '350 000')
    top().querySelector<HTMLElement>('[data-payoff-prepay]')!.click()
    await tick()
    expect(top().querySelector<HTMLInputElement>('[data-prepay-amount]')!.value.replace(/\s/g, '')).toBe('350000')
    expect(top().querySelector('[data-prepay-preview]')!.textContent).toBe('Долг закроется этим взносом')
    const card = [...top().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Kaspi Gold'))!
    card.click()
    await tick()
    const debtBefore = openDebt(A.store.credits)
    button('Внёс').click()
    await tick()
    // Взнос больше остатка — в тело ушёл только остаток; «было» — честное.
    expect(prepays(A)[0]).toMatchObject({ targetId: 'cc', principal: 300_000 })
    expect(credit(A, 'cc').principal).toBe(0)
    expect(top().querySelector('[data-prepay-before]')!.textContent!.trim()).toBe(money(debtBefore))
    expect(top().querySelector('[data-prepay-after]')!.textContent!.trim()).toBe(money(debtBefore - 300_000))
    expect(document.querySelector('[data-debt="cc"]')).toBeNull()
    button('Готово').click()
    await tick()
    // Калькулятор снова чистый — не зовёт внести ту же сумму второй раз.
    expect(top().querySelector('[data-payoff-prepay]')).toBeNull()
    expect(top().textContent).toContain('Досрочные взносы')
    button('Закрыть').click()
    await tick()

    // Закрытый кредит — «Капитал» → «Закрытые · 1» → лист: «Внёс досрочно» нет, путь к «Снять» — «Досрочные взносы · 1».
    await mount(A, '/money')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Закрытые · 1')!.click()
    await tick()
    ;[...top().querySelectorAll<HTMLElement>('*')].find((el) => el.textContent?.trim() === 'Кредитка')!.click()
    await tick()
    expect(top().querySelector('[data-credit-prepay]')).toBeNull()
    expect(top().querySelector('[data-credit-payoff]')!.textContent).toContain('Досрочные взносы · 1')
    top().querySelector<HTMLElement>('[data-credit-payoff]')!.click()
    await tick()
    button('Снять').click()
    await tick()
    button('Снять').click()
    await tick()
    expect(prepays(A)).toHaveLength(0)
    expect(credit(A, 'cc').principal).toBe(300_000)
    expect(openDebt(A.store.credits)).toBe(debtBefore)
  })
})
