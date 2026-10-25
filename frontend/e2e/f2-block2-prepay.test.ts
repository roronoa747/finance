// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { money } from '../src/lib/money'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Payment } from '../src/types/finance'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Блок 2 «Фидбек-2» (F2-04): «досрочно погасил — и правил остаток руками». Телефон A: «Долги» → «Кредит» → «Внёс
 * досрочно» → сумма → «Внёс» (счёт — прошлой оплаты, Kaspi Gold) — остаток в строке «Долгов» меньше на сумму, досрочка — в
 * «Применённых» калькулятора, «Снять» возвращает остаток. Семья `planFamilyDoc` на фейковом сервере, 12 сентября 2026.
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer
const augLoan: Payment = {
  id: 'pay-loan-aug', kind: 'credit', targetId: 'loan', period: '2026-08', amount: 58_000, principal: 30_000, accountId: 'card', by: 'a',
  at: '2026-08-15T05:00:00.000Z', updatedAt: T0,
}

async function phone(slot: 'a' | 'b'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', slot))
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

const rowSum = (id: string) =>
  document.querySelector(`[data-debt="${id}"]`)!.querySelector('[id] .num')!.textContent!.trim()
const top = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const button = (text: string) => [...top().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  server = fakeServer(planFamilyDoc({ payments: [augLoan] }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('e2e / F2-04 — «Внёс досрочно» в листе кредита', () => {
  it('«Долги» → кредит → «Внёс досрочно» → сумма → «Внёс»: остаток строки меньше на сумму, досрочка в «Применённых», «Снять» возвращает', async () => {
    const A = await phone('a')
    await mount(A, '/money/debts')
    const before = A.store.credits.find((c) => c.id === 'loan')!.principal
    expect(rowSum('loan')).toBe(money(before))

    document.querySelector<HTMLElement>('[data-debt="loan"]')!.click()
    await tick()
    top().querySelector<HTMLElement>('[data-credit-prepay]')!.click()
    await tick()
    const amount = top().querySelector<HTMLInputElement>('[data-prepay-amount]')!
    amount.focus()
    amount.value = '200 000'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    // Два нажатия от листа кредита: «Внёс досрочно» → «Внёс»; счёт — прошлой оплаты, выбирать не нужно.
    button('Внёс').click()
    await tick()
    const rec = A.store.payments.find((p) => p.kind === 'prepay' && !p.deletedAt)!
    expect(rec).toMatchObject({ targetId: 'loan', amount: 200_000, principal: 200_000, accountId: 'card', mode: 'term', by: 'a' })
    expect(rowSum('loan')).toBe(money(before - 200_000))

    // Готово → лист кредита; «Досрочные взносы · 1» → калькулятор с «Применёнными».
    button('Готово').click()
    await tick()
    top().querySelector<HTMLElement>('[data-credit-payoff]')!.click()
    await tick()
    expect(top().textContent).toContain('Применённые досрочки')
    expect(top().textContent).toContain(money(200_000))
    button('Снять').click()
    await tick()
    button('Снять').click()
    await tick()
    expect(A.store.payments.filter((p) => p.kind === 'prepay' && !p.deletedAt)).toHaveLength(0)
    expect(rowSum('loan')).toBe(money(before))
  })
})
