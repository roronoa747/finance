// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import Statements from './Statements.vue'

/**
 * B2C-15 «Тесты»: карточка решения → запись. Кнопки карточки сопоставления на «Неделе» ведут
 * в стор: «Да, отметить» — отметка из выписки, «Нет, это другое» — отказ без записи, «Потом» —
 * карточка уходит до следующего открытия, вопрос остаётся, записи нет.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  // Синк документа по таймеру (таймеры поддельные) — сети в тесте нет, запрос не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'upsertOperations').mockResolvedValue({ upserted: 0 })
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** «Неделя» участника: кредит 58 000 пятнадцатого и строка выписки «Оплата Kaspi Кредита» 14 сентября. */
async function openWeek() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'Алихан', role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [
    { id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' },
    { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: '' },
  ]
  finance.householdDoc.credits = [{ id: 'loan', name: 'Автокредит', note: '', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: '' }]
  const store = useOperationsStore()
  store.ops['op-1'] = { id: 'op-1', bank: 'kaspi', date: '2026-09-14', amount: -58_000, kind: 'purchase', merchant: 'Оплата Kaspi Кредита', categoryId: 'sc_credit', internal: false }

  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/week')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Statements)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return { finance, store }
}

const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const page = () => document.body.textContent ?? ''
const QUESTION = 'Похоже, это платёж по Автокредит — отметить?'

async function tap(label: string) {
  const b = button(label)
  expect(b, label).toBeTruthy()
  b!.click()
  await nextTick()
  await nextTick()
}

describe('B2C-15: карточка сопоставления на «Неделе» → запись', () => {
  it('«Да, отметить» — отметка кредита из выписки (сумма строки, без счёта), карточка уходит', async () => {
    const { finance, store } = await openWeek()
    expect(page()).toContain(QUESTION)
    await tap('Да, отметить')
    const live = finance.payments.filter((p) => !p.deletedAt)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, source: 'statement', opId: 'op-1', accountId: null })
    expect(store.pendingMatches).toHaveLength(0)
    expect(page()).not.toContain(QUESTION)
  })

  it('«Нет, это другое» — отказ помнится, записи нет, карточка уходит', async () => {
    const { finance, store } = await openWeek()
    await tap('Нет, это другое')
    expect(finance.payments.filter((p) => !p.deletedAt)).toHaveLength(0)
    expect(store.pendingMatches).toHaveLength(0)
    expect(page()).not.toContain(QUESTION)
  })

  it('«Потом» — карточка уходит, вопрос остаётся в сторе, записи нет', async () => {
    const { finance, store } = await openWeek()
    await tap('Потом')
    expect(finance.payments.filter((p) => !p.deletedAt)).toHaveLength(0)
    expect(store.pendingMatches).toHaveLength(1)
    expect(page()).not.toContain(QUESTION)
  })
})
