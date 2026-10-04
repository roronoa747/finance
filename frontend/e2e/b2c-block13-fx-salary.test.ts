import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient, FxRatesResponse } from '../src/api/client'
import { accountBalance, budgetAmounts, duesTotals, fxToTenge, fxYearDelta, monthDues, rateOn, salaryAt, salaryTenge } from '../src/lib/finance'
import { FX_BOOK_KEY } from '../src/lib/storage'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useFxStore } from '../src/stores/fx'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import Money from '../src/views/Money.vue'
import Statements from '../src/views/Statements.vue'
import SalaryRow from '../src/components/SalaryRow.vue'
import type { Currency } from '../src/types/finance'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 13 «Зарплата в валюте» (B2C-83): два телефона и viewer на фейковом сервере, понедельник 12 октября
 * 2026. Курсы — фейк ручки `GET /api/fx-rates` (таблица Нацбанка ниже, разреженная: книга берёт последний
 * день ≤ нужного). Ильяс получает 1 500 € с октября 2025 (задним числом), приход — на евро-счёт, два обмена
 * частями; Аруна заводит Netflix $15. Нажатия — методами стора, экраны — SSR (`screen`); браузер — на стенде.
 */

// Нацбанк: 10.10.2025 (пт) — 622,23; 10.09.2026 (чт) — 511,40; 09.10.2026 (пт) — 488,23; 12.10.2026 (пн) — 489.
const NB: Partial<Record<Currency, Record<string, number>>> = {
  EUR: { '2025-10-10': 622.23, '2026-03-10': 590, '2026-09-10': 511.4, '2026-10-09': 488.23, '2026-10-12': 489 },
  USD: { '2026-10-09': 470.5, '2026-10-12': 471 },
}
const fxRates = vi.fn(async (code: string, from: string, to: string): Promise<FxRatesResponse> => ({
  code,
  rates: Object.fromEntries(Object.entries(NB[code as Currency] ?? {}).filter(([d]) => d >= from && d <= to)),
  partial: false,
}))

type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot), fxRates } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  await rates({ pinia, client, store })
  return { pinia, client, store }
}

/** Книга курсов телефона — как движок синка: валюты документа за 13 месяцев. */
async function rates(p: Phone) {
  setActivePinia(p.pinia)
  await useFxStore().ensureDocRates(p.client)
}

async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
    await rates(p)
  }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const ctx = (p: Phone) => {
  setActivePinia(p.pinia)
  return { book: useFxStore().book, payments: p.store.payments, exchanges: p.store.fxExchanges }
}
const ilyas = (p: Phone) => p.store.people.find((x) => x.id === 'a')!

describe('e2e / B2C Блок 13 — зарплата в валюте на двух телефонах', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    fxRates.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Ильяс: 1 500 € с октября 2025 (курс версии — Нацбанк того дня), Аруна видит после синка. */
  async function euroSalary() {
    const A = await phone(server, st, 'a')
    A.store.amendSalary('a', '2025-10', 1_500, undefined, { currency: 'EUR', rate: 622.23 })
    // Новая валюта в документе — движок синка догружает книгу.
    await rates(A)
    const B = await phone(server, st, 'b')
    await sync(A, B)
    return { A, B }
  }

  it('часть 1 — оклад в евро задним числом: тенге месяцев по курсу дня зарплаты, «Доход» и строка года у обоих', async () => {
    const { A, B } = await euroSalary()
    // Книга загрузила евро (у Аруны тоже — валюта пришла с документом).
    expect(fxRates).toHaveBeenCalledWith('EUR', expect.any(String), '2026-10-12')
    for (const p of [A, B]) {
      const c = ctx(p)
      // Сентябрь: 1 500 × 511,40 = 767 100 ₸; октябрь (10.10 — суббота, курс 09.10): 1 500 × 488,23 = 732 345 ₸.
      expect(salaryAt(ilyas(p), '2026-09', c.book)).toBe(767_100)
      expect(salaryTenge(ilyas(p), '2026-10', c).tenge).toBe(732_345)
      // Доход семьи: 732 345 + 500 000 = 1 232 345 ₸.
      expect(budgetAmounts({ ...p.store.householdDoc, book: c.book }, '2026-10').income).toBe(1_232_345)
      // Год: 1 500 × (488,23 − 622,23) = −201 000 ₸.
      expect(fxYearDelta(ilyas(p), '2026-10', c.book)).toMatchObject({ perUnit: -134, tenge: -201_000 })
      const html = text(await screen(p.pinia, Money, '/money'))
      expect(html).toContain('1 500 €')
      expect(html).toContain('≈ 732 345 ₸')
      expect(html).toContain('евро −134 ₸ за год · −201 000 ₸')
      expect(html).toContain('1 232 345 ₸')
    }
  })

  it('часть 2 — приход на евро-счёт и два обмена: остатки, тенге зарплаты месяца; viewer видит без «Обменял»', async () => {
    const { A, B } = await euroSalary()
    setActivePinia(A.pinia)
    const eur = A.store.addFxAccount('EUR')
    // Пришло 1 500 € сегодня: тенге записи — по курсу дня прихода 1 500 × 489 = 733 500 ₸.
    expect(A.store.markSalary('a', { accountId: eur })).toMatchObject({ foreign: 1_500, currency: 'EUR', amount: 733_500, accountId: eur })
    const html0 = text(await screen(A.pinia, Statements, '/week'))
    expect(html0).toContain('обменяно 0 € из 1 500 € · ≈ 732 345 ₸')
    expect(html0).toContain('Обменял')

    // Обмены: 500 € по 515 = 257 500 ₸ и 300 € по 512,5 = 153 750 ₸ — на Kaspi Gold.
    setActivePinia(A.pinia)
    A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 500, rate: 515, period: '2026-10' })
    A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 300, rate: 512.5, period: '2026-10' })
    const V = await phone(server, st, 'a', 'viewer')
    await sync(A, B, V)

    for (const p of [A, B, V]) {
      const c = ctx(p)
      // Евро-счёт: 1 500 − 800 = 700 € → 700 × 489 (сегодня) = 342 300 ₸; Kaspi: 2 000 000 + 257 500 + 153 750 = 2 411 250 ₸.
      expect(p.store.accounts.find((a) => a.id === eur)).toMatchObject({ foreignAmount: 700, amount: 342_300 })
      expect(p.store.accounts.find((a) => a.id === 'card')!.amount).toBe(2_411_250)
      // Тенге зарплаты: 257 500 + 153 750 + 700 × 488,23 (день зарплаты) = 341 761 → 753 011 ₸; доход 1 253 011 ₸.
      expect(salaryTenge(ilyas(p), '2026-10', c)).toMatchObject({ tenge: 753_011, exchanged: 800, left: 700 })
      expect(budgetAmounts({ ...p.store.householdDoc, book: c.book }, '2026-10').income).toBe(1_253_011)
    }
    expect(text(await screen(A.pinia, Statements, '/week'))).toContain('обменяно 800 € из 1 500 € · ≈ 753 011 ₸')
    // Viewer: решений «Недели» нет (Р-50), в «Деньгах» — строка года, «Обменял» нигде.
    const viewer = text(await screen(V.pinia, Money, '/money')) + text(await screen(V.pinia, Statements, '/week'))
    expect(viewer).toContain('евро −134 ₸ за год')
    expect(viewer).not.toContain('Обменял')
    // Остаток счёта в тенге не зависит от того, чей телефон: сверка с формулой.
    setActivePinia(A.pinia)
    const raw = A.store.householdDoc.accounts.find((a) => a.id === eur)!
    expect(accountBalance(raw, A.store.payments, { exchanges: A.store.fxExchanges, book: useFxStore().book, day: '2026-10-12' })).toBe(342_300)
  })

  it('часть 3 — Netflix $15 у Аруны: в платежах месяца по курсу 10-го (суббота → 09.10), «Оплатил» пишет эти тенге', async () => {
    const { A, B } = await euroSalary()
    setActivePinia(B.pinia)
    B.store.addObligation({ name: 'Netflix', day: 10, category: 'd4', amount: 15, fx: { currency: 'USD', rate: 471 } })
    await rates(B)
    expect(fxRates).toHaveBeenCalledWith('USD', expect.any(String), '2026-10-12')
    const nf = B.store.obligations.find((o) => o.name === 'Netflix')!
    // 15 × 470,5 = 7 057,5 → 7 058 ₸; платежи месяца: аренда 220 000 + 7 058 = 227 058 ₸ + кредиты.
    setActivePinia(B.pinia)
    const dues = monthDues({ obligations: B.store.obligations, credits: B.store.credits, payments: B.store.payments, book: useFxStore().book }, '2026-10')
    expect(dues.find((d) => d.targetId === nf.id)!.amount).toBe(7_058)
    const before = duesTotals(dues)!.total
    expect(B.store.markPaid('obligation', nf.id, 'b', { accountId: null })).toMatchObject({ period: '2026-10', amount: 7_058 })
    await sync(B, A)
    const html = text(await screen(A.pinia, Money, '/money'))
    expect(html).toContain('Netflix')
    expect(html).toContain('10-го · 15 $')
    expect(html).toContain('7 058 ₸')
    setActivePinia(A.pinia)
    const after = monthDues({ obligations: A.store.obligations, credits: A.store.credits, payments: A.store.payments, book: useFxStore().book }, '2026-10')
    expect(duesTotals(after)!.total).toBe(before)
  })

  it('часть 4 — два телефона Ильяса офлайн: обмены не теряются, отмена (надгробие) доходит до второго', async () => {
    const { A } = await euroSalary()
    setActivePinia(A.pinia)
    const eur = A.store.addFxAccount('EUR')
    A.store.markSalary('a', { accountId: eur })
    const A2 = await phone(server, st, 'a')
    await sync(A, A2)
    // Офлайн: на первом — 100 € по 510, на втором — 200 € по 511; синк по очереди (второй — через 409 и слияние).
    setActivePinia(A.pinia)
    A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 100, rate: 510, period: '2026-10' })
    setActivePinia(A2.pinia)
    const second = A2.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 200, rate: 511, period: '2026-10' })!
    await sync(A)
    await sync(A2, A)
    for (const p of [A, A2]) {
      setActivePinia(p.pinia)
      expect(p.store.fxExchanges.filter((x) => !x.deletedAt).map((x) => x.foreign).sort()).toEqual([100, 200])
      // 1 500 − 300 = 1 200 €.
      expect(p.store.accounts.find((a) => a.id === eur)!.foreignAmount).toBe(1_200)
    }
    // Отмена второго обмена на первом телефоне — у второго он тоже отменён.
    setActivePinia(A.pinia)
    A.store.undoExchange(second.id)
    await sync(A, A2)
    setActivePinia(A2.pinia)
    expect(A2.store.fxExchanges.find((x) => x.id === second.id)!.deletedAt).toBeTruthy()
    expect(A2.store.accounts.find((a) => a.id === eur)!.foreignAmount).toBe(1_400)
  })

  it('часть 5 (приёмка) — ручной курс евро-счёта на телефоне без книги после прихода и обменов: € прежний у всех, с книгой — тенге по Нацбанку', async () => {
    const { A, B } = await euroSalary()
    setActivePinia(A.pinia)
    const eur = A.store.addFxAccount('EUR')
    A.store.markSalary('a', { accountId: eur })
    A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 500, rate: 515, period: '2026-10' })
    A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 300, rate: 512.5, period: '2026-10' })
    await sync(A, B)
    // Второй телефон Ильяса — без книги (банк недоступен, кэша нет): в листе счёта поле курса руками.
    storage.delete(FX_BOOK_KEY)
    const real = fxRates.getMockImplementation()!
    fxRates.mockImplementation(async (code: string) => ({ code, rates: {}, partial: false }))
    const A3 = await phone(server, st, 'a')
    fxRates.mockImplementation(real)
    setActivePinia(A3.pinia)
    expect(rateOn(useFxStore().book, 'EUR', '2026-10-12')).toBeNull()
    const seen = A3.store.accounts.find((a) => a.id === eur)!
    expect(seen.foreignAmount).toBe(700)
    // Как `AccountSheet.onAccountRate`: курс 480 — база в валюте пишется видимым остатком (`70fe2d7`). Часы
    // идут: новый якорь сверки позже прихода и обменов (в одну миллисекунду с ними они бы считались дважды).
    at('2026-10-12T07:05:00Z')
    A3.store.updateAccount(eur, { rate: 480, foreignAmount: seen.foreignAmount, amount: fxToTenge(seen.foreignAmount!, 480), rateAt: new Date().toISOString() })
    expect(A3.store.accounts.find((a) => a.id === eur)).toMatchObject({ foreignAmount: 700, amount: 336_000 })
    await sync(A3, A, B)
    // С книгой (A, B): 700 € × 489 (сегодня) = 342 300 ₸ — ручной курс в расчёт не идёт.
    for (const p of [A, B]) {
      setActivePinia(p.pinia)
      expect(p.store.accounts.find((a) => a.id === eur)).toMatchObject({ foreignAmount: 700, amount: 342_300 })
    }
  })

  it('часть 6 (B2C-79-а) — отмена одного из двух обменов: остатки и тенге зарплаты до тенге у обоих; снятая отметка — строка видна, отмена работает', async () => {
    const { A, B } = await euroSalary()
    setActivePinia(A.pinia)
    const eur = A.store.addFxAccount('EUR')
    A.store.markSalary('a', { accountId: eur })
    const first = A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 500, rate: 515, period: '2026-10' })!
    const second = A.store.addExchange({ by: 'a', accountId: eur, toAccountId: 'card', foreign: 300, rate: 512.5, period: '2026-10' })!
    await sync(A, B)
    // Лист обменов, «Отменить» → «Отменить» (подтверждение) у 500 € по 515.
    setActivePinia(A.pinia)
    A.store.undoExchange(first.id)
    await sync(A, B)
    for (const p of [A, B]) {
      const c = ctx(p)
      // Евро-счёт: 1 500 − 300 = 1 200 € × 489 = 586 800 ₸; Kaspi: 2 000 000 + 153 750 = 2 153 750 ₸.
      expect(p.store.accounts.find((a) => a.id === eur)).toMatchObject({ foreignAmount: 1_200, amount: 586_800 })
      expect(p.store.accounts.find((a) => a.id === 'card')!.amount).toBe(2_153_750)
      // 153 750 + 1 200 × 488,23 = 585 876 → 739 626 ₸; доход 739 626 + 500 000 = 1 239 626 ₸.
      expect(salaryTenge(ilyas(p), '2026-10', c)).toMatchObject({ tenge: 739_626, exchanged: 300, left: 1_200 })
      expect(budgetAmounts({ ...p.store.householdDoc, book: c.book }, '2026-10').income).toBe(1_239_626)
    }
    expect(text(await screen(A.pinia, Statements, '/week'))).toContain('обменяно 300 € из 1 500 € · ≈ 739 626 ₸')

    // Отметку сняли (Н-6): обмен жив, строка без «из» и без «Обменял»; тенге месяца — оклад по-прежнему 1 500 €.
    setActivePinia(A.pinia)
    A.store.unmarkPaid('salary', 'a', '2026-10')
    expect(A.store.fxExchanges.find((x) => x.id === second.id)!.deletedAt).toBeFalsy()
    expect(salaryTenge(ilyas(A), '2026-10', ctx(A)).tenge).toBe(739_626)
    // Строка зарплаты — как в листе «До зарплаты» (`PaydaySummary`).
    const unmarked = text(await screen(A.pinia, SalaryRow, '/money', { personId: 'a', period: '2026-10' }))
    expect(unmarked).toContain('обменяно 300 € · ≈ 739 626 ₸')
    expect(unmarked).not.toContain('Обменял')
    // Отмена работает и без отметки: всё возвращается — евро-счёт 0 €, Kaspi 2 000 000 ₸, у второго телефона тоже.
    setActivePinia(A.pinia)
    A.store.undoExchange(second.id)
    await sync(A, B)
    for (const p of [A, B]) {
      setActivePinia(p.pinia)
      expect(p.store.accounts.find((a) => a.id === eur)).toMatchObject({ foreignAmount: 0, amount: 0 })
      expect(p.store.accounts.find((a) => a.id === 'card')!.amount).toBe(2_000_000)
    }
    expect(text(await screen(A.pinia, SalaryRow, '/money', { personId: 'a', period: '2026-10' }))).not.toContain('обменяно')
  })
})
