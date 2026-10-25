// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { monthPlan } from '../src/lib/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Payment } from '../src/types/finance'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Блок 1 «Фидбек-2» (F2-03): «Внёс автокредит — куда указывать, что оплатил?» Телефон A на «Долгах» нажимает «Оплатил» у
 * «Кредита» → ✓ у суммы; в плане месяца (экран «Месяц») этот платёж оплачен той же записью; после синка телефон B видит
 * ✓ на своих «Долгах» без кнопки. Семья `planFamilyDoc` на фейковом сервере, 12 сентября 2026; август «Кредита» оплачен
 * с Kaspi Gold — счёт берётся прошлый.
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer
const KEY = '2026-09'
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

const row = (id: string) => document.querySelector(`[data-debt="${id}"]`)!.parentElement!
const dues = (p: Phone) => monthPlan(p.store.householdDoc, { key: KEY, totals: [], spendCategories: [], uploads: [] }).dues

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

describe('e2e / F2-03 — «Оплатил» у кредита на «Долгах»', () => {
  it('«Долги» → «Оплатил» у «Кредита» → ✓; «Месяц» — оплачен той же записью; B после синка — ✓ без кнопки', async () => {
    const A = await phone('a')
    const B = await phone('b')
    expect(dues(A).find((d) => d.targetId === 'loan')).toMatchObject({ kind: 'credit', amount: 58_000, paid: false })

    await mount(A, '/money/debts')
    const pay = row('loan').querySelector<HTMLElement>('[data-debt-pay]')!
    expect(pay.textContent?.trim()).toBe('Оплатил')
    pay.click()
    await tick()
    expect(row('loan').querySelector('[data-debt="loan"] [data-debt-given]')).not.toBeNull()
    expect(row('loan').querySelector('[data-debt-pay]')).toBeNull()

    // План месяца — тот же, что рисует «Месяц»: платёж «Кредита» оплачен, запись одна.
    expect(dues(A).find((d) => d.targetId === 'loan')).toMatchObject({ amount: 58_000, paid: true })
    const marks = A.store.payments.filter((p) => p.targetId === 'loan' && p.period === KEY && !p.deletedAt)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ kind: 'credit', accountId: 'card', by: 'a' })

    await A.store.syncHousehold(A.client)
    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(dues(B).find((d) => d.targetId === 'loan')).toMatchObject({ paid: true })
    await mount(B, '/money/debts')
    expect(row('loan').querySelector('[data-debt-given]')).not.toBeNull()
    expect(row('loan').querySelector('[data-debt-pay]')).toBeNull()
    expect(row('cc').querySelector('[data-debt-pay]')).not.toBeNull()
  })
})
