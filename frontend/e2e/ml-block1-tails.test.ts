// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, h, nextTick } from 'vue'
import NewObligationSheet from '../src/components/capital/NewObligationSheet.vue'
import { FX_BOOK_KEY } from '../src/lib/storage'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { freeByFact, liveSpendCategories } from '../src/lib/finance'
import { parseMoney } from '../src/lib/money'
import { markedOps, matchCandidates } from '../src/lib/statements/matching'
import { assignIds, normalizeMerchant, spendTotals } from '../src/lib/statements/model'
import type { MerchantRule, Operation } from '../src/lib/statements/types'
import { authAs, planFamilyDoc } from '../src/test/planFamily'

/**
 * Блок 1 «мелочи» (ML-13): хвосты §4 `идея-и-редизайн`, закрытые блоком, — сценарии на семье `planFamilyDoc` через
 * настоящий стор и функции расчёта. Раскладка уменьшает «Свободно» (951), две строки продавца — одна трата (967),
 * отменённая подписка — трата (952), кредит без ставки держит остаток (958), кандидат зарплаты не зависит от порядка
 * строк (959), сюрприз правится и удаляется (955), «9,99 $» → 10 (1000). Числа — ручной расчёт в комментариях.
 */

const MONTH = '2026-10'
const T = '2026-10-04T07:00:00.000Z'
const UPLOADS = [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-31' }]

const op = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false, ...extra,
})

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(T))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function family() {
  setActivePinia(createPinia())
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  return store
}

/** «Свободно» месяца по выписке Ильяса: строки → отметки → итоги разделов → `freeByFact`. */
function freeOf(store: ReturnType<typeof useFinanceStore>, rows: Operation[], declined: string[] = []) {
  const doc = store.householdDoc
  const categories = liveSpendCategories(doc.spendCategories) as Parameters<typeof freeByFact>[2]
  const marked = markedOps(rows, doc, [], 'a', declined)
  const totals = spendTotals(rows, 'a', 'month', MONTH, T, { marked, categories })
  return freeByFact(doc, totals, categories, MONTH, UPLOADS)
}

describe('Блок 1 «мелочи» — хвосты на семье', () => {
  it('951 (ML-02): остаток месяца 100 000 разложен в «Отпуск» — «Свободно» меньше на 60 000: взнос «Отпуска» 40 000 уже в плане', () => {
    const store = family()
    const before = freeByFact(store.householdDoc, [], [], MONTH, []).amount
    store.recordAllocation({ source: 'rest', sourceId: MONTH, period: MONTH, by: 'a', total: 100_000, parts: [{ target: 'trip', amount: 100_000 }] })
    expect(freeByFact(store.householdDoc, [], [], MONTH, []).amount).toBe(before - 60_000)
  })

  it('967 (ML-03): курсы 15 000 — два перевода продавцу, «Оплатил» одним — трата 15 000, а не 0 и не 30 000', () => {
    const store = family()
    const courses = store.addObligation({ name: 'Курсы', day: 5, category: 'd4', amount: 15_000 })
    const rows = assignIds([
      op('2026-10-05', -15_000, 'PEREVOD KURSY', { categoryId: 'sc_subscriptions' }),
      op('2026-10-06', -15_000, 'PEREVOD KURSY', { categoryId: 'sc_subscriptions' }),
    ])
    store.markPaid('obligation', courses, 'a', { period: MONTH, opId: rows[0].id, source: 'statement' })
    expect(freeOf(store, rows).spent).toBe(15_000)
  })

  it('952 (ML-03): Netflix 4 990 ждёт ответа — не трата; подписку отменили — строка трата 4 990', () => {
    const store = family()
    const netflix = store.addObligation({ name: 'Netflix', day: 3, category: 'd4', amount: 4_990 })
    const rows = assignIds([op('2026-10-03', -4_990, 'NETFLIX.COM', { categoryId: 'sc_subscriptions' })])
    expect(freeOf(store, rows).spent).toBe(0)
    store.removeObligation(netflix)
    expect(freeOf(store, rows).spent).toBe(4_990)
  })

  it('958 (ML-05): кредит из выписки без ставки — «Оплатил» 50 000, остаток держится 500 000', () => {
    const store = family()
    const credit = store.addCredit({ name: 'Из выписки', principal: 500_000, annualRate: 0, rateUnknown: true, payment: 50_000, day: 10 })
    store.markPaid('credit', credit, 'a', { period: MONTH })
    expect(store.credits.find((c) => c.id === credit)?.principal).toBe(500_000)
  })

  it('959 (ML-06): перевод 690 000 перед зарплатой — кандидат «зарплата · октябрь» один и тот же при любом порядке строк', () => {
    const store = family()
    const [other, salary] = assignIds([op('2026-10-09', 690_000, 'Перевод от Дана К.'), op('2026-10-10', 700_000, 'ТОО Ромашка', { kind: 'income' })])
    const rule: MerchantRule = { id: 'r', match: { merchant: normalizeMerchant('ТОО Ромашка') }, to: { payment: { kind: 'salary', targetId: 'a' } }, by: 'a', updatedAt: T }
    const pick = (list: Operation[]) => matchCandidates(list, store.householdDoc, [rule], 'a').map((c) => [c.opId, c.period])
    expect(pick([other, salary])).toEqual([[salary.id, MONTH]])
    expect(pick([salary, other])).toEqual([[salary.id, MONTH]])
  })

  it('955 (ML-07): сюрприз Аруне — цена исправлена, другой удалён; в общем документе следов нет', () => {
    const store = family()
    const perfume = store.addGift({ forSlot: 'b', name: 'Духи', price: 40_000 })
    const tickets = store.addGift({ forSlot: 'b', name: 'Билеты', price: 25_000 })
    store.updateGift(perfume.id, { price: 35_000 })
    store.removeGift(tickets.id)
    expect(store.gifts.map((g) => [g.name, g.price])).toEqual([['Духи', 35_000]])
    expect(JSON.stringify(store.householdDoc)).not.toContain('Духи')
  })

  it('1000 (ML-09): подписка «9,99 $» — версия 10 $, не 999 $', () => {
    const store = family()
    const spotify = store.addObligation({ name: 'Spotify', day: 12, category: 'd4', amount: parseMoney('9,99'), fx: { currency: 'USD', rate: 470 } })
    expect(store.obligations.find((o) => o.id === spotify)?.versions).toEqual([{ from: '2000-01', amount: 10, currency: 'USD', rate: 470 }])
  })

  it('1000 (ML-09, возврат приёмки): в форме подписки набрано по символу «9.99» точкой — «9,99», сохраняется 10 $, не 999 $', async () => {
    localStorage.setItem(FX_BOOK_KEY, JSON.stringify({ book: { USD: { '2026-10-03': 471.2 } }, covered: {} }))
    const store = family()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp({ render: () => h(NewObligationSheet, { open: true }) })
    app.use((store as unknown as { _p: ReturnType<typeof createPinia> })._p)
    app.mount(root)
    const flush = async () => { for (let i = 0; i < 4; i++) await nextTick() }
    await flush()
    const name = document.querySelector('input') as HTMLInputElement
    name.value = 'Spotify'
    name.dispatchEvent(new Event('input'))
    ;(document.querySelector('button[aria-label="USD"]') as HTMLButtonElement).click()
    await flush()
    const amount = document.querySelector('input[inputmode]') as HTMLInputElement
    amount.focus()
    for (const ch of '9.99') {
      const at = amount.selectionStart ?? amount.value.length
      amount.value = amount.value.slice(0, at) + ch + amount.value.slice(at)
      amount.setSelectionRange(at + 1, at + 1)
      amount.dispatchEvent(new Event('input'))
      await flush()
    }
    expect(amount.value).toBe('9,99')
    expect(document.body.textContent).toContain('Округлим до 10 $')
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Добавить')!.click()
    await flush()
    expect(store.obligations.find((o) => o.name === 'Spotify')?.versions).toEqual([{ from: '2000-01', amount: 10, currency: 'USD', rate: 471.2 }])
    app.unmount()
    root.remove()
  })
})
