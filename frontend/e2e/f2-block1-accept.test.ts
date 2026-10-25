// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { monthPlan } from '../src/lib/finance'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Приёмка Блока 1 «Фидбек-2» (F2-02, F2-03) — сценарии, которых нет у исполнителя: первая оплата кредита без прошлого
 * счёта (лист отметки спрашивает счёт; Enter в сумме листа не отмечает), отметка в «Месяце» на другом телефоне — на
 * «Долгах» ✓ без кнопки и второй записи нет, viewer — только ✓. Семья `planFamilyDoc` без отметок, 12 сентября 2026.
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer
const KEY = '2026-09'

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

const row = (id: string) => document.querySelector(`[data-debt="${id}"]`)!.parentElement!
const dialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!
const marks = (p: Phone, id: string) => p.store.payments.filter((x) => x.targetId === id && x.period === KEY && !x.deletedAt)
const due = (p: Phone, id: string) =>
  monthPlan(p.store.householdDoc, { key: KEY, totals: [], spendCategories: [], uploads: [] }).dues.find((d) => d.targetId === id)

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

describe('приёмка F2 Блок 1 — «Оплатил» у кредита и «Готово» в листе отметки', () => {
  it('первая оплата: «Оплатил» → лист спрашивает счёт; Enter в сумме не отмечает; выбрал счёт → ✓, «Месяц» оплачен', async () => {
    const A = await phone('a')
    await mount(A, '/money/debts')
    row('cc').querySelector<HTMLElement>('[data-debt-pay]')!.click()
    await tick()
    const sheet = dialog()
    expect(sheet.textContent).toContain('Кредитка')

    // «Готово» клавиатуры в сумме листа: фокус ушёл, лист открыт, отметки нет — подтверждение только кнопкой.
    const sum = sheet.querySelector<HTMLInputElement>('input')!
    expect(sum.getAttribute('enterkeyhint')).toBe('done')
    sum.focus()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    sum.dispatchEvent(enter)
    await tick()
    expect(enter.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(sum)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(marks(A, 'cc')).toHaveLength(0)

    ;[...sheet.querySelectorAll('button')].find((b) => b.textContent?.includes('Kaspi Gold'))!.click()
    await tick()
    button(sheet, 'Отметить оплату').click()
    await tick(8)
    expect(marks(A, 'cc')).toHaveLength(1)
    expect(marks(A, 'cc')[0]).toMatchObject({ kind: 'credit', amount: 25_000, accountId: 'card', by: 'a' })
    expect(row('cc').querySelector('[data-debt-given]')).not.toBeNull()
    expect(row('cc').querySelector('[data-debt-pay]')).toBeNull()
    expect(due(A, 'cc')).toMatchObject({ paid: true })
  })

  it('B отметил «Кредит» в «Месяце» → у A на «Долгах» ✓ без кнопки, запись одна; viewer — только ✓', async () => {
    const B = await phone('b')
    B.store.markPaid('credit', 'loan', 'b', { period: KEY, accountId: 'card' })
    await B.store.syncHousehold(B.client)

    const A = await phone('a')
    await mount(A, '/money/debts')
    expect(row('loan').querySelector('[data-debt-given]')).not.toBeNull()
    expect(row('loan').querySelector('[data-debt-pay]')).toBeNull()
    expect(row('cc').querySelector('[data-debt-pay]')?.textContent?.trim()).toBe('Оплатил')
    expect(marks(A, 'loan')).toHaveLength(1)

    const V = await phone('a', 'viewer')
    await mount(V, '/money/debts')
    expect(row('loan').querySelector('[data-debt-given]')).not.toBeNull()
    expect(document.querySelector('[data-debt-pay]')).toBeNull()
    expect(document.querySelector('[data-debt-give]')).toBeNull()
  })
})
