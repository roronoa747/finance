// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs } from '@/test/planFamily'
import type { Account, Person } from '@/types/finance'
import AccountSheet from './AccountSheet.vue'

/** F2-06: «Траты отсюда» в листе счёта — переключатель, хозяин (двое), вклад без строки, viewer без кнопок. */

const T0 = '2026-10-01T00:00:00.000Z'
const two: Person[] = [
  { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
  { id: 'b', name: 'Аруна', salary: 0, payday: 20, updatedAt: T0 },
]
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open(accounts: Account[], id: string, { role = 'member', people = two }: { role?: 'member' | 'viewer'; people?: Person[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role))
  const store = useFinanceStore()
  store.setHouseholdDoc({ ...defaultSyncDoc(), people, accounts }, 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(AccountSheet, { accountId: id }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  const q = (sel: string) => document.querySelector<HTMLElement>(sel)
  const owner = () => [...document.querySelectorAll('[data-spend-owner] button')] as HTMLButtonElement[]
  return { store, q, owner }
}
const card = (id: string, p: Partial<Account> = {}): Account => ({ id, name: id, note: '', amount: 100_000, amountSetAt: T0, kind: 'card', updatedAt: T0, ...p })

describe('F2-06: «Траты отсюда» в листе счёта', () => {
  it('единственная карта — включена сама, хозяин «Оба»; выбрать «Я» — одно нажатие', async () => {
    const { store, q, owner } = await open([card('k1')], 'k1')
    expect(q('[data-spend-toggle]')!.getAttribute('aria-checked')).toBe('true')
    expect(owner().map((b) => b.textContent?.trim())).toEqual(['Я', 'Аруна', 'Оба'])
    expect(owner()[2].getAttribute('aria-pressed')).toBe('true')
    owner()[0].click()
    await nextTick()
    expect(store.householdDoc.accounts![0].spendBy).toBe('a')
    expect(owner()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('вторая карта: переключатель выключен → включить (оба) → выбрать партнёра — два нажатия', async () => {
    const { store, q, owner } = await open([card('k1'), card('k2')], 'k2')
    expect(q('[data-spend-toggle]')!.getAttribute('aria-checked')).toBe('false')
    expect(q('[data-spend-owner]')).toBeNull()
    q('[data-spend-toggle]')!.click()
    await nextTick()
    owner()[1].click()
    await nextTick()
    expect(store.householdDoc.accounts!.find((a) => a.id === 'k2')!.spendBy).toBe('b')
  })

  it('семья из одного — только переключатель; выключить — явный null', async () => {
    const { store, q } = await open([card('k1')], 'k1', { people: [two[0]] })
    expect(q('[data-spend-row]')).not.toBeNull()
    expect(q('[data-spend-owner]')).toBeNull()
    q('[data-spend-toggle]')!.click()
    await nextTick()
    expect(store.householdDoc.accounts![0].spendBy).toBeNull()
    expect(q('[data-spend-toggle]')!.getAttribute('aria-checked')).toBe('false')
  })

  it('вклад и валютный счёт — строки нет', async () => {
    const dep = card('dep', { kind: 'deposit', deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true } })
    const { q } = await open([dep], 'dep')
    expect(q('[data-spend-row]')).toBeNull()
    app!.unmount()
    app = null
    document.body.innerHTML = ''
    const r = await open([card('usd', { currency: 'USD', foreignAmount: 100, rate: 500 })], 'usd')
    expect(r.q('[data-spend-row]')).toBeNull()
  })

  it('viewer — строка «Траты отсюда · оба» без кнопок', async () => {
    const { q } = await open([card('k1')], 'k1', { role: 'viewer' })
    expect(q('[data-spend-toggle]')).toBeNull()
    expect(q('[data-spend-viewer]')!.textContent).toContain('оба')
  })
})
