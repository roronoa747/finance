import { describe, expect, it } from 'vitest'
import { accountBalance, accountForeign, exchangedIn, fxToTenge, netWorth, salaryExchange, salaryToAllocate, shiftedBase } from './finance'
import { mergeDocs } from './merge'
import { defaultSyncDoc } from '@/stores/finance'
import type { Account, FxExchange, Payment, RateBook } from '@/types/finance'

// Валютный счёт и «Обменял» (B2C-79, Р-73): остаток в валюте выводится из записей (база + приходы −
// обмены после сверки), в тенге — по курсу Нацбанка из книги; тенговый счёт получает тенге обмена.
// Числа — ручной расчёт в комментариях.

const T0 = '2026-10-01T00:00:00.000Z'
const book: RateBook = { EUR: { '2026-10-02': 499.05, '2026-10-03': 502.98 } }
const day = '2026-10-04' // воскресенье — курс субботы 502,98
const eurAcc: Account = { id: 'eur', name: 'Евро-счёт', note: '', amount: 0, amountSetAt: T0, kind: 'card', currency: 'EUR', foreignAmount: 0, rate: 500, updatedAt: T0 }
const kzt: Account = { id: 'kzt', name: 'Kaspi Gold', note: '', amount: 100_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }

// Пришло 1 500 € (тенге по курсу дня прихода 502,98 = 754 470 ₸).
const salary: Payment = { id: 's1', kind: 'salary', targetId: 'a', period: '2026-10', amount: 754_470, foreign: 1_500, currency: 'EUR', accountId: 'eur', by: 'a', at: '2026-10-03T06:00:00.000Z', updatedAt: '2026-10-03T06:00:00.000Z' }
const ex = (id: string, foreign: number, rate: number, at: string, extra: Partial<FxExchange> = {}): FxExchange => ({
  id, by: 'a', accountId: 'eur', toAccountId: 'kzt', currency: 'EUR', foreign, rate, tenge: fxToTenge(foreign, rate), period: '2026-10', at, updatedAt: at, ...extra,
})
// 500 € по 515 = 257 500 ₸; 300 € по 512,5 = 153 750 ₸.
const ex1 = ex('x1', 500, 515, '2026-10-03T08:00:00.000Z')
const ex2 = ex('x2', 300, 512.5, '2026-10-03T09:00:00.000Z')

describe('валютный счёт и обмены — остатки', () => {
  it('приход и два обмена: евро 1 500 − 800 = 700 €, в тенге 700 × 502,98 = 352 086 ₸; тенговый 100 000 + 257 500 + 153 750 = 511 250 ₸', () => {
    const ctx = { exchanges: [ex1, ex2], book, day }
    expect(accountForeign(eurAcc, [salary], [ex1, ex2])).toBe(700)
    expect(accountBalance(eurAcc, [salary], ctx)).toBe(352_086)
    expect(accountBalance(kzt, [salary], ctx)).toBe(511_250)
    // Капитал до тенге: 352 086 + 511 250 = 863 336 ₸.
    const shown = [eurAcc, kzt].map((a) => ({ ...a, amount: accountBalance(a, [salary], ctx) }))
    expect(netWorth(shown, [])).toBe(863_336)
  })

  it('до обмена: 1 500 € × 502,98 = 754 470 ₸; без книги — ручной курс счёта 1 500 × 500 = 750 000 ₸', () => {
    expect(accountBalance(eurAcc, [salary], { book, day })).toBe(754_470)
    expect(accountBalance(eurAcc, [salary])).toBe(750_000)
  })

  it('сверка остатка после обмена не удваивает: ввели 700 € — 700, обмены до сверки не вычитаются', () => {
    const reconciled = { ...eurAcc, foreignAmount: 700, amountSetAt: '2026-10-03T10:00:00.000Z' }
    expect(accountForeign(reconciled, [salary], [ex1, ex2])).toBe(700)
    // Обмен после сверки — вычитается: 700 − 200 = 500 €.
    expect(accountForeign(reconciled, [salary], [ex1, ex2, ex('x3', 200, 510, '2026-10-03T11:00:00.000Z')])).toBe(500)
    // Тенговый тоже: сверили 300 000 после первого обмена — второй (позже) добавляется: 300 000 + 153 750.
    const kztSet = { ...kzt, amount: 300_000, amountSetAt: '2026-10-03T08:30:00.000Z' }
    expect(accountBalance(kztSet, [], { exchanges: [ex1, ex2] })).toBe(453_750)
  })

  it('отмена обмена (надгробие) возвращает остатки: 1 500 − 500 = 1 000 €; тенговый 100 000 + 257 500', () => {
    const undone = { ...ex2, deletedAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z' }
    expect(accountForeign(eurAcc, [salary], [ex1, undone])).toBe(1_000)
    expect(accountBalance(kzt, [], { exchanges: [ex1, undone] })).toBe(357_500)
  })

  it('«не записывать на счёт» — валюта уходит, тенговые счета не растут', () => {
    const nowhere = ex('x4', 100, 510, '2026-10-03T09:30:00.000Z', { toAccountId: null })
    expect(accountForeign(eurAcc, [salary], [nowhere])).toBe(1_400)
    expect(accountBalance(kzt, [], { exchanges: [nowhere] })).toBe(100_000)
  })

  it('обменяно за месяц и строка «обменяно 800 € из 1 500 €»; тенговая зарплата — null', () => {
    expect(exchangedIn([ex1, ex2], 'a', '2026-10')).toBe(800)
    expect(exchangedIn([ex1, ex2], 'b', '2026-10')).toBe(0)
    expect(salaryExchange([salary], [ex1, ex2], 'a', '2026-10')).toMatchObject({ currency: 'EUR', came: 1_500, exchanged: 800, left: 700 })
    // Обменяли больше пришедшего — необменянного 0, не минус.
    expect(salaryExchange([salary], [ex1, ex2, ex('x5', 900, 510, '2026-10-03T12:00:00.000Z')], 'a', '2026-10')!.left).toBe(0)
    const kztSalary: Payment = { ...salary, id: 's2', foreign: undefined, currency: undefined, amount: 700_000 }
    expect(salaryExchange([kztSalary], [], 'a', '2026-10')).toBeNull()
  })

  it('сдвиг тенгового счёта (взнос в цель) видит обмены: остаток 357 500, снять 400 000 нельзя — база 100 000 − 357 500', () => {
    expect(shiftedBase(kzt, [], -400_000, { exchanges: [ex1] })).toBe(100_000 - 357_500)
  })
})

describe('слияние обменов', () => {
  const docWith = (fxExchanges: FxExchange[]) => ({ ...defaultSyncDoc(), fxExchanges })

  it('два обмена с двух телефонов офлайн — оба остаются', () => {
    const merged = mergeDocs(docWith([ex1]), docWith([ex2]))
    expect(merged.fxExchanges!.map((x) => x.id).sort()).toEqual(['x1', 'x2'])
  })

  it('надгробие сильнее правки', () => {
    const tomb = { ...ex1, deletedAt: '2026-10-03T12:00:00.000Z', updatedAt: '2026-10-03T12:00:00.000Z' }
    const edit = { ...ex1, rate: 516, tenge: fxToTenge(500, 516), updatedAt: '2026-10-03T13:00:00.000Z' }
    expect(mergeDocs(docWith([tomb]), docWith([edit])).fxExchanges![0].deletedAt).toBeTruthy()
    expect(mergeDocs(docWith([edit]), docWith([tomb])).fxExchanges![0].deletedAt).toBeTruthy()
  })

  it('старый документ без ключа — обмены другой стороны не теряются', () => {
    const old = { ...defaultSyncDoc() } as ReturnType<typeof defaultSyncDoc>
    delete old.fxExchanges
    expect(mergeDocs(old, docWith([ex1])).fxExchanges).toHaveLength(1)
  })
})

describe('карточка «Пришла зарплата» на «Неделе»', () => {
  const people = [{ id: 'a' as const, name: 'Ильяс', salary: 700_000, payday: 3, updatedAt: T0, salaryVersions: [{ from: '2025-10', amount: 1_500, currency: 'EUR' as const, rate: 505.5 }] }]
  const now = { day: 4, key: '2026-10' }

  it('валютная зарплата, отмеченная руками, держит карточку (сначала «Обменял»); тенговая ручная — нет', () => {
    expect(salaryToAllocate({ people, payments: [salary] }, 'a', now)?.record.id).toBe('s1')
    const kztManual: Payment = { ...salary, foreign: undefined, currency: undefined, amount: 700_000 }
    expect(salaryToAllocate({ people, payments: [kztManual] }, 'a', now)).toBeNull()
  })
})
