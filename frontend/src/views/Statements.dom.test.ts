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
async function openWeek(setup?: (finance: ReturnType<typeof useFinanceStore>, store: ReturnType<typeof useOperationsStore>) => void) {
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
  setup?.(finance, store)

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
  return { finance, store, router }
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

describe('возврат приёмки п. 2: зарплата, отмеченная по выписке, раскладывается', () => {
  // Оклад Алихана 500 000 десятого; приход 500 000 десятого сентября; кредита в этих сценариях нет.
  const salaryDay = (finance: ReturnType<typeof useFinanceStore>, store: ReturnType<typeof useOperationsStore>) => {
    finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000 }
    finance.householdDoc.credits = []
    delete store.ops['op-1']
    store.ops['op-2'] = { id: 'op-2', bank: 'kaspi', date: '2026-09-10', amount: 500_000, kind: 'transfer-in', merchant: 'ТОО Работодатель', categoryId: null, internal: false }
  }
  const ALLOCATE = '/week/salary?from=salary&person=a&period=2026-09'

  it('«Да, зарплата» на карточке сопоставления — отметка из выписки и сразу раскладка', async () => {
    const { finance, router } = await openWeek(salaryDay)
    expect(page()).toContain('Это зарплата Алихан?')
    await tap('Да, зарплата')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(ALLOCATE))
    expect(finance.payments.filter((p) => !p.deletedAt)).toEqual([expect.objectContaining({ kind: 'salary', targetId: 'a', period: '2026-09', source: 'statement', opId: 'op-2' })])
  })

  it('отмеченная по выписке (правило при загрузке) и не разложенная — карточка «разложить?» → раскладка; записанная раскладка и ручная отметка карточки не дают', async () => {
    const { router } = await openWeek((finance, store) => {
      salaryDay(finance, store)
      finance.markSalary('a', { period: '2026-09', amount: 500_000, accountId: null, source: 'statement', opId: 'op-2', at: '2026-09-10T07:00:00.000Z' })
    })
    expect(page()).toContain('Пришла зарплата Алихан — разложить?')
    await tap('Разложить')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(ALLOCATE))

    // Раскладка записана — вопроса нет.
    app?.unmount()
    document.body.innerHTML = ''
    await openWeek((finance, store) => {
      salaryDay(finance, store)
      finance.markSalary('a', { period: '2026-09', amount: 500_000, accountId: null, source: 'statement', opId: 'op-2', at: '2026-09-10T07:00:00.000Z' })
      finance.recordAllocation({ source: 'salary', sourceId: 'a', period: '2026-09', by: 'a', total: 100_000, parts: [{ target: 'life', amount: 100_000 }] })
    })
    expect(page()).not.toContain('разложить?')

    // Ручная отметка («Пришла») ведёт на раскладку сама — карточки нет (старые ручные отметки уже разложены Ритуалом).
    app?.unmount()
    document.body.innerHTML = ''
    await openWeek((finance, store) => {
      salaryDay(finance, store)
      finance.markSalary('a', { period: '2026-09', amount: 500_000, accountId: null })
    })
    expect(page()).not.toContain('разложить?')
  })
})

describe('возврат приёмки 2 п. 3, 4: одна карточка о зарплате, у неотмеченной — вопрос о приходе', () => {
  it('день зарплаты, отметки нет — «Пришла зарплата Алихан?» (как решение на главном), кнопка «Пришла зарплата»; «разложить?» — только у раскладки', async () => {
    vi.setSystemTime(new Date('2026-09-10T07:00:00Z'))
    await openWeek((finance, store) => {
      finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000 }
      finance.householdDoc.credits = []
      delete store.ops['op-1']
    })
    expect(page()).toContain('Пришла зарплата Алихан?')
    expect(page()).toContain('10 сентября')
    expect(page()).not.toContain('разложить?')
    expect(button('Пришла зарплата')).toBeTruthy()
  })

  it('зарплата сентября из выписки не разложена, а «Пришла?» октября уже спрашивается (день 1-го, 29-е) — на «Неделе» одна карточка «разложить?»', async () => {
    vi.setSystemTime(new Date('2026-09-29T07:00:00Z'))
    await openWeek((finance, store) => {
      finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000, payday: 1 }
      finance.householdDoc.credits = []
      delete store.ops['op-1']
      finance.markSalary('a', { period: '2026-09', amount: 500_000, accountId: null, source: 'statement', opId: 'op-9', at: '2026-09-01T07:00:00.000Z' })
    })
    expect(page()).toContain('Пришла зарплата Алихан — разложить?')
    expect(page()).not.toContain('Пришла зарплата Алихан?')
    expect(page().split('Пришла зарплата').length - 1).toBe(1)
  })
})
