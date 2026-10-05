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
  // Вопросы — в листе за «! N» (Р-97): открываем его, как человек.
  document.querySelector<HTMLButtonElement>('[data-bang]')?.click()
  await nextTick()
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

// Блок 15 (Р-96, Р-97): на экране брендовая — только «Загрузить», пока своей выписки за неделю нет; вопросы — в
// листе за «! N», в листе — не больше одной брендовой, брендовых рамок нет.
describe('ревью Блока 3 Н-22 (правило 12): брендовая на экране — «Загрузить»; в листе вопросов — не больше одной', () => {
  const brandButtons = () => [...document.querySelectorAll('button')].filter((b) => b.className.includes('bg-brand ')).map((b) => b.textContent?.trim())
  const brandFrames = () => document.querySelectorAll('.border-brand').length
  /** Незнакомый продавец месяца — пачка «Без раздела» (ответ — чипы). */
  const unknownOp = (store: ReturnType<typeof useOperationsStore>) => {
    store.ops['op-u'] = { id: 'op-u', bank: 'kaspi', date: '2026-09-08', amount: -7_500, kind: 'purchase', merchant: 'ИП ЖАНСАЯ', categoryId: null, internal: false }
  }

  it('сопоставление и день своей зарплаты — в листе один вопрос с одной брендовой; о зарплате «Неделя» не спрашивает (Р-97)', async () => {
    vi.setSystemTime(new Date('2026-09-10T07:00:00Z'))
    await openWeek((finance) => {
      finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000 }
    })
    await vi.waitFor(() => expect(page()).toContain(QUESTION))
    expect(page()).not.toContain('Пришла зарплата')
    expect(page()).not.toMatch(/\d из \d/)
    expect(brandButtons()).toEqual(['Загрузить', 'Да, отметить'])
    expect(brandFrames()).toBe(0)
  })

  it('разбор продавца — ответ чипами: в листе брендовых кнопок нет', async () => {
    await openWeek((finance, store) => {
      finance.householdDoc.credits = []
      delete store.ops['op-1']
      unknownOp(store)
    })
    await vi.waitFor(() => expect(page()).toContain('Без раздела · 1'))
    expect(brandButtons()).toEqual(['Загрузить'])
    expect(brandFrames()).toBe(0)
  })

  it('день своей зарплаты, вопросов нет — значка «!» нет: «Пришла» — строка зарплаты «Месяца»', async () => {
    vi.setSystemTime(new Date('2026-09-10T07:00:00Z'))
    await openWeek((finance, store) => {
      finance.householdDoc.people[0] = { ...finance.householdDoc.people[0], salary: 500_000 }
      finance.householdDoc.credits = []
      delete store.ops['op-1']
    })
    expect(document.querySelector('[data-bang]')).toBeNull()
    expect(page()).not.toContain('Пришла зарплата')
    expect(brandButtons()).toEqual(['Загрузить'])
  })

  it('решений нет — главное «Загрузить» в строке загрузки: одна брендовая, значка «!» и рамок нет', async () => {
    await openWeek((finance, store) => {
      finance.householdDoc.credits = []
      delete store.ops['op-1']
    })
    expect(brandButtons()).toEqual(['Загрузить'])
    expect(document.querySelector('[data-bang]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(brandFrames()).toBe(0)
  })
})

describe('B2C-49: одно решение за раз, «N из M» растёт, а не тает', () => {
  it('«! 3» → лист: «1 из 3» → ответ → «2 из 3» (не «1 из 2»); «Потом» сдвигает к следующему; после последнего — лист закрыт', async () => {
    // Сопоставление кредита, незнакомый продавец месяца и подписка без ответа — три решения.
    await openWeek((finance, store) => {
      store.ops['op-u'] = { id: 'op-u', bank: 'kaspi', date: '2026-09-08', amount: -7_500, kind: 'purchase', merchant: 'ИП ЖАНСАЯ', categoryId: null, internal: false }
      finance.householdDoc.obligations = [{ id: 'nf', name: 'Netflix', note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 4_990 }], updatedAt: '' }]
    })
    await vi.waitFor(() => expect(page()).toContain(QUESTION))
    expect(page()).toContain('1 из 3')
    await tap('Да, отметить')
    expect(page()).toContain('Без раздела · 1')
    expect(page()).toContain('ИП ЖАНСАЯ')
    expect(page()).toContain('2 из 3')
    expect(page()).not.toContain('1 из 2')
    await tap('Потом')
    expect(page()).toContain('Оставить подписку Netflix?')
    expect(page()).toContain('3 из 3')
    await tap('Оставить')
    expect(page()).not.toContain('Оставить подписку Netflix?')
    expect(page()).not.toMatch(/\d из \d/)
    expect(document.querySelectorAll('h2.type-h2')).toHaveLength(0)
    // Вопросы кончились — лист закрылся сам, значка нет.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-bang]')).toBeNull()
    expect([...document.querySelectorAll('button')].filter((b) => b.className.includes('bg-brand ')).map((b) => b.textContent?.trim())).toEqual(['Загрузить'])
  })
})

describe('B2C-61: незнакомые продавцы пачкой → правила разом', () => {
  const sells: [string, number][] = [['ИП АХМЕТОВА', 5_000], ['ИП СЕЙТКАЛИ', 4_000], ['ИП КИМ', 3_000], ['ИП ОСПАНОВ', 2_000], ['ИП НУРЛАНОВА', 1_000]]
  const openBatch = () =>
    openWeek((finance, store) => {
      finance.householdDoc.credits = []
      delete store.ops['op-1']
      sells.forEach(([merchant, amount], i) => (store.ops[`u${i}`] = { id: `u${i}`, bank: 'kaspi', date: '2026-09-2' + (i % 3), amount: -amount, kind: 'purchase', merchant, categoryId: null, internal: false }))
    })
  const row = (name: string) => [...document.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement
  const pick = async (...names: string[]) => {
    for (const n of names) row(n).click()
    await nextTick()
  }
  /** Ушедшие строки держит `TransitionGroup` до конца анимации — дождаться кадра. */
  const settle = async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    vi.advanceTimersByTime(500)
    await nextTick()
  }
  const rulesTo = (finance: ReturnType<typeof useFinanceStore>, categoryId: string) =>
    finance.merchantRules.filter((r) => !r.deletedAt && 'categoryId' in r.to && r.to.categoryId === categoryId).map((r) => r.match.merchant).sort()

  it('отметить 3 → «Выбрано 3 · сумма» → чип: три правила одной отправкой, итоги пересчитаны, строки ушли', async () => {
    const { finance } = await openBatch()
    await vi.waitFor(() => expect(page()).toContain('Без раздела · 5'))
    // Без отмеченных — «куда?» нет.
    expect(page()).not.toContain('Выбрано')
    expect(button('Продукты')).toBeUndefined()
    await pick('ИП АХМЕТОВА', 'ИП СЕЙТКАЛИ', 'ИП КИМ')
    expect(row('ИП КИМ').getAttribute('aria-pressed')).toBe('true')
    expect(page()).toMatch(/Выбрано 3 · 12\s000\s₸/)
    await tap('Продукты')
    expect(rulesTo(finance, 'sc_food')).toEqual(['ахметова', 'ким', 'сейткали'])
    await vi.waitFor(() => expect(apiClient.upsertOperations).toHaveBeenCalledTimes(1))
    expect(vi.mocked(apiClient.upsertOperations).mock.calls[0][0]).toHaveLength(3)
    const food = finance.householdDoc.spendTotals!.find((t) => t.kind === 'month' && t.period === '2026-09' && t.categoryId === 'sc_food')
    expect(food?.amount).toBe(12_000)
    await vi.waitFor(() => expect(page()).toContain('Без раздела · 2'))
    await settle()
    for (const n of ['ИП АХМЕТОВА', 'ИП СЕЙТКАЛИ', 'ИП КИМ', 'Выбрано']) expect(page()).not.toContain(n)
  })

  it('«Не помню» → правило «Прочее», продавец больше не спрашивается; «Выбрать все» → ответ всем, пачка уходит', async () => {
    const { finance, store } = await openBatch()
    await vi.waitFor(() => expect(page()).toContain('Без раздела · 5'))
    await pick('ИП ОСПАНОВ')
    await tap('Не помню')
    expect(rulesTo(finance, 'sc_other')).toEqual(['оспанов'])
    expect(store.ops.u3.categoryId).toBe('sc_other')
    await vi.waitFor(() => expect(page()).toContain('Без раздела · 4'))
    await settle()
    expect(page()).not.toContain('ИП ОСПАНОВ')

    await tap('Выбрать все')
    expect(page()).toMatch(/Выбрано 4 · 13\s000\s₸/)
    expect(button('Снять все')).toBeTruthy()
    await tap('Между своими')
    await vi.waitFor(() => expect(page()).not.toContain('Без раздела'))
    expect(finance.merchantRules.filter((r) => !r.deletedAt && 'internal' in r.to)).toHaveLength(4)
  })
})
