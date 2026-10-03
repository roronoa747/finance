// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { fxToTenge } from '@/lib/finance'
import { authAs } from '@/test/planFamily'
import { FX_BOOK_KEY, writeStorage } from '@/lib/storage'
import type { FxExchange, Payment, RateBook } from '@/types/finance'
import AccountSheet from './AccountSheet.vue'

/**
 * Критик Блока 13: правка ручного курса валютного счёта — новая сверка (якорь «сейчас»). Остаток в
 * валюте выводится из прихода и обменов (B2C-79), поэтому база в валюте пишется видимым остатком —
 * иначе якорь отрезал бы приход и обмены и счёт показал бы старую базу (0 €).
 */

const T0 = '2026-09-01T00:00:00.000Z'
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T08:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Пришло 1 500 €, обменяно 500 € по 515 — на евро-счёте 1 000 €.
const salary: Payment = { id: 's1', kind: 'salary', targetId: 'a', period: '2026-10', amount: 754_470, foreign: 1_500, currency: 'EUR', accountId: 'eur', by: 'a', at: '2026-10-03T06:00:00.000Z', updatedAt: '2026-10-03T06:00:00.000Z' }
const exchange: FxExchange = { id: 'x1', by: 'a', accountId: 'eur', toAccountId: 'kzt', currency: 'EUR', foreign: 500, rate: 515, tenge: 257_500, period: '2026-10', at: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z' }

async function openEur(book?: RateBook) {
  // Книга курсов — из кэша устройства, как после входа (стор fx читает его при создании).
  if (book) writeStorage(FX_BOOK_KEY, { book, covered: {} })
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(
    {
      ...defaultSyncDoc(),
      accounts: [
        { id: 'eur', name: 'Евро-счёт', note: '', kind: 'card', amount: 0, amountSetAt: T0, currency: 'EUR', foreignAmount: 0, rate: 500, updatedAt: T0 },
        { id: 'kzt', name: 'Kaspi Gold', note: '', kind: 'card', amount: 100_000, amountSetAt: T0, updatedAt: T0 },
      ],
      payments: [salary],
      fxExchanges: [exchange],
    },
    1,
  )
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(AccountSheet, { accountId: 'eur', onClose: () => {} }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  const label = (text: string) => [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes(text))
  const field = (text: string) => label(text)!.querySelector('input')!
  return { store, field, label }
}

async function edit(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('blur'))
  await nextTick()
  await nextTick()
}

describe('критик Блока 13: курс валютного счёта', () => {
  it('новый курс 510 не теряет приход и обмен: 1 000 € остаются, в тенге — по книге или курсу 1 000 × 510 = 510 000 ₸', async () => {
    const { store, field } = await openEur()
    const eur = () => store.accounts.find((a) => a.id === 'eur')!
    expect(eur().foreignAmount).toBe(1_000)
    await edit(field('Курс'), '510')
    expect(eur().rate).toBe(510)
    expect(eur().foreignAmount).toBe(1_000)
    // Книги нет — тенге по ручному курсу счёта.
    expect(eur().amount).toBe(fxToTenge(1_000, 510))
    // Тенговый счёт обмен не потерял: 100 000 + 257 500.
    expect(store.accounts.find((a) => a.id === 'kzt')!.amount).toBe(357_500)
  })
})

describe('ревью frontend Б13 Н-3: лист валютного счёта при курсе в книге', () => {
  it('курс Нацбанка есть — одна строка «≈ N ₸ по курсу Нацбанка» (1 000 × 502,98 = 502 980 ₸), без поля курса и подписи «по этому курсу»', async () => {
    const { store, label } = await openEur({ EUR: { '2026-10-03': 502.98 } })
    const dialog = document.querySelector('[role="dialog"]')!.textContent!
    expect(store.accounts.find((a) => a.id === 'eur')!.amount).toBe(502_980)
    expect(dialog).toContain('по курсу Нацбанка')
    expect(dialog).not.toContain('по этому курсу')
    expect(label('Курс')).toBeUndefined()
  })

  it('книги нет — поле ручного курса и подпись «по этому курсу», как раньше', async () => {
    const { label } = await openEur()
    expect(label('Курс')).toBeDefined()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('по этому курсу')
  })
})
