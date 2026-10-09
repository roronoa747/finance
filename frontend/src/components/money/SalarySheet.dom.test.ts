// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { monthSalaries, type SalaryLine } from '@/lib/finance'
import { moneySigned } from '@/lib/money'
import { FX_BOOK_KEY, writeStorage } from '@/lib/storage'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { Payment, RateBook } from '@/types/finance'
import SalarySheet from './SalarySheet.vue'

/**
 * PN-02 (хвост 1022): «евро за год» — строкой в листе зарплаты у валютного оклада, пришёл он или нет: `fxYearDelta` по
 * книге курсов, нажатие — лист курса (`FxRateSheet`). Тенговый оклад и книга короче года — строки нет. Числа — как в
 * `lib/fxDelta.fx.test.ts`: 10.10.2026 — суббота, курс пятницы 09.10 — 488,23; год назад — 622,23 → −134 ₸ за евро.
 */
let app: App | null = null

const KEY = '2026-10'
const BOOK: RateBook = { EUR: { '2025-10-10': 622.23, '2026-03-10': 590, '2026-09-10': 511.4, '2026-10-09': 488.23 } }
const came: Payment = { id: 'sal-a-10', kind: 'salary', targetId: 'a', period: KEY, amount: 732_345, foreign: 1_500, currency: 'EUR', accountId: null, by: 'a', at: '2026-10-10T05:00:00.000Z', updatedAt: T0 }

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open(opts: { euro?: boolean; book?: RateBook; role?: 'member' | 'viewer'; payments?: Payment[]; person?: 'a' | 'b' } = {}) {
  // Книга курсов — с устройства: стор читает её при создании (`FX_BOOK_KEY`), демо нет — книга не синтетическая.
  if (opts.book) writeStorage(FX_BOOK_KEY, { book: opts.book, covered: {} })
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(opts.role ?? 'member', 'a'))
  const finance = useFinanceStore()
  const doc = planFamilyDoc({ payments: opts.payments ?? [] })
  // Ильяс: 1 500 € с января 2025 (курс версии 505 — запасной, книга старше).
  if (opts.euro) doc.people[0] = { ...doc.people[0], salary: 0, salaryVersions: [{ from: '2025-01', amount: 1_500, currency: 'EUR', rate: 505 }] }
  finance.setHouseholdDoc(doc, 1)
  const lines = monthSalaries(finance.monthPlanOf(KEY), { people: finance.people, payments: finance.payments })
  const line = ref<SalaryLine | null>(lines.find((s) => s.person === (opts.person ?? 'a')) ?? null)
  expect(line.value).not.toBeNull()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(SalarySheet, { monthKey: KEY, line: line.value, onClose: () => (line.value = null) }) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return { finance, line }
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const press = async (el: HTMLElement | null) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  for (let i = 0; i < 4; i++) await nextTick()
}

describe('PN-02: «евро за год» в листе зарплаты', () => {
  it('валютный оклад, ждём: строка «евро за год −134 ₸» в карточке «Когда / Хватает»; нажатие — лист «Курс евро», лист зарплаты закрыт', async () => {
    const { line } = await open({ euro: true, book: BOOK })
    const row = q('[role="dialog"] [data-fx-year]')
    expect(row).not.toBeNull()
    // Подпись и число — соседние span без текста между ними: сравниваем без пробелов.
    expect(txt(row).replace(/\s/g, '')).toBe(`евро за год ${moneySigned(-134)}`.replace(/\s/g, ''))
    // В той же карточке, что «Когда» и «Хватает» (одна карточка, строки через линию).
    expect(row!.parentElement).toBe(q('[role="dialog"] [data-salary-status]')!.parentElement)
    expect(q('[role="dialog"] [data-salary-exchanges]')).toBeNull()

    await press(row)
    expect(line.value).toBeNull()
    expect(dialogs()).toHaveLength(1)
    expect(txt(dialogs()[0])).toContain('Курс евро')
    expect(txt(dialogs()[0])).not.toContain('Хватает')
  })

  it('валютный оклад, пришла: строка есть и после отметки (вместе с «обменяно … из …»); тенговый оклад — строки нет', async () => {
    await open({ euro: true, book: BOOK, payments: [came] })
    expect(q('[role="dialog"] [data-salary-exchanges]')).not.toBeNull()
    expect(txt(q('[role="dialog"] [data-fx-year]'))).toContain('евро за год')

    app?.unmount()
    document.body.innerHTML = ''
    await open({ book: BOOK })
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(q('[role="dialog"] [data-fx-year]')).toBeNull()
    expect(txt(q('[role="dialog"]'))).not.toContain('за год')
  })

  it('книга короче года (нет курса год назад) — строки нет; viewer строку видит (чтение, кнопок у него нет)', async () => {
    await open({ euro: true, book: { EUR: { '2026-10-09': 488.23 } } })
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(q('[role="dialog"] [data-fx-year]')).toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open({ euro: true, book: BOOK, role: 'viewer' })
    expect(txt(q('[role="dialog"] [data-fx-year]'))).toContain('евро за год')
    expect([...document.querySelectorAll('[role="dialog"] button')].map((b) => txt(b))).not.toContain('Пришла зарплата')
    expect(q('[role="dialog"] [data-salary-edit]')).toBeNull()
  })
})
