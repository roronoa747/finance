// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { plain } from '@/lib/money'
import type { Account, AccountSpent } from '@/types/finance'
import Week from './Week.vue'

/**
 * F2-08 (Р-7): «На карте N» — тихая строка «Недели» с тающим остатком моего счёта для трат; нажатие — лист счёта
 * (`/money?account=<id>`); нет счёта для трат и у viewer — строки нет. Вторник 20 октября 2026.
 */
let app: App | null = null
const T0 = '2026-10-01T00:00:00.000Z'
const card = (p: Partial<Account> = {}): Account => ({ id: 'k1', name: 'Kaspi Gold', note: '', amount: 250_000, amountSetAt: T0, kind: 'card', updatedAt: T0, ...p })
const spent: AccountSpent = { id: 'k1:a', accountId: 'k1', by: 'a', since: T0, amount: 5_000, updatedAt: T0 }

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openWeek(accounts: Account[], role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: role === 'viewer' ? 'c' : 'a', display_name: 'a', role, joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [{ id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' }]
  finance.householdDoc.accounts = accounts
  finance.householdDoc.accountSpent = [spent]
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/week')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Week)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  for (let i = 0; i < 6; i++) await nextTick()
  return { router }
}
const line = () => document.querySelector<HTMLElement>('[data-week-balance]')
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('F2-08: «На карте» на «Неделе»', () => {
  it('есть счёт для трат — строка с тающим остатком; нажатие — лист счёта', async () => {
    const { router } = await openWeek([card()])
    expect(txt(line()).replace(/\s/g, ' ')).toBe(`На карте ${plain(245_000)}`.replace(/\s/g, ' '))
    line()!.click()
    for (let i = 0; i < 4; i++) await nextTick()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/money?account=k1'))
  })

  it('наличные — «Наличные N»', async () => {
    await openWeek([card({ id: 'cash', kind: 'cash', spendBy: 'both' })])
    expect(txt(line())).toMatch(/^Наличные /)
  })

  it('нет счёта для трат — строки нет', async () => {
    await openWeek([card(), card({ id: 'k2' })])
    expect(line()).toBeNull()
  })

  it('viewer — строки нет', async () => {
    await openWeek([card()], 'viewer')
    expect(line()).toBeNull()
  })
})
