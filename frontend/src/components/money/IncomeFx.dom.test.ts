// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { FX_BOOK_KEY } from '@/lib/storage'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import IncomeWidget from './IncomeWidget.vue'

/**
 * «Курс за год» в «Доходе» (B2C-82, Р-76): строка только под валютным участником, нажатие — лист
 * «Курс евро» с крупным итогом, графиком и лентой месяцев; выбор месяца меняет строку «в … по … ₸ ·
 * было бы …». Viewer видит строку и лист. Числа — ручной расчёт в комментариях.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(role: 'member' | 'viewer' = 'member') {
  // Книга: евро 10.10.2025 — 622,23; 10.03.2026 — 590; 09.10.2026 (пятница перед днём зарплаты 10.10) — 488,23.
  const book = { EUR: { '2025-10-10': 622.23, '2026-03-10': 590, '2026-10-09': 488.23 } }
  localStorage.setItem(FX_BOOK_KEY, JSON.stringify({ book, covered: {} }))
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role))
  const doc = planFamilyDoc()
  doc.people[0] = { ...doc.people[0], salaryVersions: [{ from: '2025-01', amount: 1_500, currency: 'EUR', rate: 505 }] }
  useFinanceStore().setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(IncomeWidget) })
  app.use(pinia).use(router)
  app.mount(root)
  await flush()
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const text = () => (document.body.textContent ?? '').replace(/[  ]/g, ' ')
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null

describe('«Доход» — курс за год', () => {
  it('строка только у валютного участника: «евро −134 ₸ за год · −201 000 ₸» (1 500 × 488,23 − 1 500 × 622,23)', async () => {
    await mount()
    const lines = [...document.querySelectorAll('button[aria-label^="Курс"]')]
    expect(lines).toHaveLength(1)
    expect(lines[0].textContent!.replace(/[  ]/g, ' ').trim()).toBe('евро −134 ₸ за год · −201 000 ₸')
    expect(lines[0].querySelector('span')!.className).toContain('text-destructive')
  })

  it('лист: «Курс евро», крупно −201 000 ₸, график; выбор марта — «в марте по 590 ₸ · было бы +152 655 ₸»', async () => {
    await mount()
    ;(document.querySelector('button[aria-label="Курс евро за год"]') as HTMLButtonElement).click()
    await flush()
    const d = dialog()!
    expect(d.textContent).toContain('Курс евро')
    expect(d.querySelector('svg[role="img"] path')).not.toBeNull()
    // По умолчанию — тот же месяц год назад: 1 500 × 622,23 − 732 345 = +201 000 ₸.
    expect(text()).toContain('в октябре по 622 ₸ · было бы +201 000 ₸')
    const mar = [...d.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.trim() === 'мар') as HTMLButtonElement
    mar.click()
    await flush()
    // 1 500 × 590 = 885 000 − 732 345 = +152 655 ₸.
    expect(text()).toContain('в марте по 590 ₸ · было бы +152 655 ₸')
    expect(mar.getAttribute('aria-pressed')).toBe('true')
  })

  it('viewer видит строку и лист', async () => {
    await mount('viewer')
    ;(document.querySelector('button[aria-label="Курс евро за год"]') as HTMLButtonElement).click()
    await flush()
    expect(dialog()?.textContent).toContain('Курс евро')
  })
})
