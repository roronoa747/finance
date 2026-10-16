import { describe, expect, it } from 'vitest'
import { affordWhy, affordWhyText, firstDebt } from './finance'
import { planFamilyDoc } from '@/test/planFamily'

/**
 * AU-07: «Хватит?» с причиной и первый долг против ручного расчёта (правило 6).
 *
 * Семья `planFamilyDoc`: на счетах 2 000 000; зарплаты — Ильяс 10-го (700 000), Аруна 20-го (500 000). 12 сентября
 * ближайшая — Аруны 20-го (порог «тесно» — 15 % от 500 000 = 75 000); платежи окна 12–20 сентября — только «Кредит»
 * 15-го (58 000): аренда 5-го уже прошла, кредитка 22-го — после зарплаты.
 */
const SEP12 = { key: '2026-09', day: 12 }
const doc = planFamilyDoc()

describe('affordWhy', () => {
  it('short: баланс уходит в минус на платеже 15-го, зарплата 20-го → 15–19-го', () => {
    // 2 000 000 − 1 950 000 = 50 000; − 58 000 = −8 000 на «Кредите».
    const why = affordWhy(doc, 1_950_000, SEP12)
    expect(why).toEqual({ kind: 'short', from: { day: 15, key: '2026-09' }, to: { day: 19, key: '2026-09' }, name: 'Кредит' })
    expect(affordWhyText(why!)).toBe('тесно 15–19-го — Кредит')
  })
  it('tight: остаток после платежей меньше 15 % прихода — окно от самого крупного платежа', () => {
    // 2 000 000 − 1 900 000 − 58 000 = 42 000 < 75 000.
    expect(affordWhy(doc, 1_900_000, SEP12)).toEqual({ kind: 'tight', from: { day: 15, key: '2026-09' }, to: { day: 19, key: '2026-09' }, name: 'Кредит' })
  })
  it('null: запас есть (ровно 15 % — уже не тесно); без счетов — причину не знаем', () => {
    // 2 000 000 − 1 867 000 − 58 000 = 75 000 = порог.
    expect(affordWhy(doc, 1_867_000, SEP12)).toBeNull()
    expect(affordWhy(doc, 100_000, SEP12)).toBeNull()
    expect(affordWhy({ ...doc, accounts: [] }, 1_950_000, SEP12)).toBeNull()
  })
  it('окно через границу месяца: 25 сентября, зарплата Ильяса 10 октября → «с 25-го до 9-го»', () => {
    // Окно 25.09–10.10: рассрочка 25.09 (20 000), аренда 05.10 (220 000). 2 000 000 − 1 990 000 − 20 000 < 0 на рассрочке.
    const why = affordWhy(doc, 1_990_000, { key: '2026-09', day: 25 })
    expect(why).toEqual({ kind: 'short', from: { day: 25, key: '2026-09' }, to: { day: 9, key: '2026-10' }, name: 'Рассрочка' })
    expect(affordWhyText(why!)).toBe('тесно с 25-го до 9-го — Рассрочка')
    // 2 000 000 − 1 770 000 = 230 000: на рассрочку хватает (210 000), на аренде 5 октября минус → «5–9-го».
    expect(affordWhyText(affordWhy(doc, 1_770_000, { key: '2026-09', day: 25 })!)).toBe('тесно 5–9-го — Аренда')
  })
})

describe('firstDebt', () => {
  it('два долга с процентами — дороже первым (кредитка 40 % выше кредита 33 %; рассрочка без процентов — мимо)', () => {
    expect(firstDebt(doc)).toEqual({ name: 'Кредитка', rate: 40 })
  })
  it('ставка неизвестна — пропуск; остался один — null', () => {
    const unknown = doc.credits.map((c) => (c.id === 'cc' ? { ...c, rateUnknown: true } : c))
    expect(firstDebt({ credits: unknown })).toBeNull()
    expect(firstDebt({ credits: doc.credits.filter((c) => c.id !== 'loan') })).toBeNull()
  })
})
