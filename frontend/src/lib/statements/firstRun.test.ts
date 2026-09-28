import { describe, expect, it } from 'vitest'
import type { PdfRow } from './pdf'
import { parseStatement } from './parsers'
import { assignIds } from './model'
import type { Operation } from './types'
import { QUESTION_LIMIT, beyondLimit, detectIncome, detectRecurring, firstRunQuestions, salaryOpOfMonth } from './firstRun'

/**
 * Первый запуск из выписки (B2C-19): доход по регулярности и размеру, повторы по продавцу и
 * словарю, виды записей, лимит вопросов. Синтетическая фикстура Kaspi — как у разбора.
 */
const fixtures = import.meta.glob<PdfRow[]>('./fixtures/*.rows.json', { eager: true, import: 'default' })
const kaspi = () => parseStatement(fixtures['./fixtures/kaspi-01.rows.json']).operations

const op = (date: string, amount: number, merchant: string, extra: Partial<Omit<Operation, 'id'>> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false, ...extra,
})

describe('firstRun — доход', () => {
  it('фикстура Kaspi: доход — крупный приход «С карты другого банка» 120 000 24-го; «Кредит Наличными» — не доход', () => {
    const list = detectIncome(kaspi())
    expect(list[0]).toMatchObject({ name: 'С карты другого банка', amount: 120_000, day: 24, regular: false })
    expect(list.map((c) => c.name)).not.toContain('Кредит Наличными')
  })

  it('регулярный приход — первым, даже если разовый крупнее; со своего вклада и займы — мимо', () => {
    const ops = assignIds([
      op('2026-07-10', 500_000, 'ТОО Рога и Копыта'),
      op('2026-08-10', 520_000, 'ТОО Рога и Копыта'),
      op('2026-09-11', 510_000, 'ТОО Рога и Копыта'),
      op('2026-08-20', 900_000, 'Продажа машины'),
      op('2026-08-01', 700_000, 'С Kaspi Депозита', { internal: true }),
      op('2026-08-05', 1_000_000, 'Кредит Наличными', { kind: 'other' }),
      op('2026-08-07', 3_000, 'Возврат', { kind: 'purchase' }),
    ])
    const list = detectIncome(ops)
    expect(list[0]).toMatchObject({ name: 'ТОО Рога и Копыта', amount: 510_000, day: 10, count: 3, regular: true })
    expect(list[1]).toMatchObject({ name: 'Продажа машины', amount: 900_000, regular: false })
    expect(list).toHaveLength(2)
  })

  it('без приходов — пусто', () => {
    expect(detectIncome(assignIds([op('2026-09-01', -1_000, 'Magnum')]))).toEqual([])
  })
})

describe('firstRun — отметка зарплаты месяца (возврат приёмки п. 7)', () => {
  it('salaryOpOfMonth: приход месяца в допуске оклада ±10 %, ближайший к окладу; вне допуска и чужой месяц — нет', () => {
    const list = assignIds([
      { bank: 'kaspi', date: '2026-09-03', amount: 4_700, kind: 'income', merchant: 'ТОО', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-09-12', amount: 32_500, kind: 'income', merchant: 'ТОО', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-09-20', amount: 29_000, kind: 'income', merchant: 'ТОО', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-08-12', amount: 30_000, kind: 'income', merchant: 'ТОО', categoryId: null, internal: false },
    ])
    expect(salaryOpOfMonth(list, 30_000, '2026-09')?.amount).toBe(29_000)
    expect(salaryOpOfMonth(list.slice(0, 1), 30_000, '2026-09')).toBeUndefined()
    expect(salaryOpOfMonth(list, 20_000, '2026-09')).toBeUndefined()
    expect(salaryOpOfMonth(list, 30_000, '2026-10')).toBeUndefined()
  })
})

describe('firstRun — повторы', () => {
  it('фикстура Kaspi: кредиты и подписки — по словарю с одного раза, по убыванию суммы; переводы людям, наличные, мелочь и разные суммы — мимо', () => {
    const list = detectRecurring(kaspi())
    const names = list.map((c) => c.name)
    expect(names.slice(0, 2)).toEqual(['Оплата Kaspi Кредита', 'Оплата Kaspi Red'])
    expect(names).toEqual(expect.arrayContaining(['Яндекс Плюс', 'Altel', 'Beeline Интернет дома', 'Kcell']))
    for (const n of ['Дана К.', 'Марат С.', 'Аппарат самообслуживания', 'Банкомат Tumar', 'Small', 'Magnum', 'ИП Береке']) expect(names).not.toContain(n)
    expect(list[0]).toMatchObject({ kind: 'credit', amount: 151_790, day: 24, count: 1, categoryId: 'sc_credit', budget: 'd2' })
    expect(list[1]).toMatchObject({ kind: 'credit', amount: 45_000, day: 9 })
    expect(list.find((c) => c.name === 'Яндекс Плюс')).toMatchObject({ kind: 'subscription', amount: 3_990, day: 5, categoryId: 'sc_subscriptions', budget: 'd4' })
    expect(list.find((c) => c.name === 'Beeline Интернет дома')).toMatchObject({ kind: 'subscription', amount: 1_175, categoryId: 'sc_telecom' })
  })

  it('прочий продавец — «другое регулярное» при двух близких списаниях в близкие дни; коммуналка — жильё с оценкой; разные суммы — нет', () => {
    const ops = assignIds([
      op('2026-07-03', -45_000, 'Детский сад Балапан'),
      op('2026-08-04', -45_500, 'Детский сад Балапан'),
      op('2026-07-20', -18_000, 'Алсеко'),
      op('2026-07-12', -4_200, 'Magnum'),
      op('2026-08-14', -12_000, 'Magnum'),
      op('2026-07-05', -300, 'Onay'),
      op('2026-08-05', -300, 'Onay'),
      op('2026-07-06', -25_000, 'Дана К.', { kind: 'transfer-out', counterparty: 'Дана К.' }),
      op('2026-08-06', -25_000, 'Дана К.', { kind: 'transfer-out', counterparty: 'Дана К.' }),
    ])
    const list = detectRecurring(ops)
    expect(list.map((c) => [c.name, c.kind, c.amount, c.day, c.budget])).toEqual([
      ['Детский сад Балапан', 'obligation', 45_000, 3, 'd4'],
      ['Алсеко', 'utilities', 18_000, 20, 'd1'],
    ])
  })
})

describe('firstRun — вопросы', () => {
  it('доход первым, повторы по сумме; не больше семи, остаток — «позже в Неделе»', () => {
    const subs = ['Netflix', 'Spotify', 'YouTube', 'IVI', 'OKKO', 'MEGOGO', 'Google One', 'iCloud', 'Airalo']
    const ops = assignIds([
      op('2026-09-10', 600_000, 'ТОО Работодатель'),
      ...subs.map((m, i) => op(`2026-09-${String(i + 2).padStart(2, '0')}`, -(1_000 + i * 500), m)),
    ])
    const q = firstRunQuestions(ops)
    expect(QUESTION_LIMIT).toBe(7)
    expect(q).toHaveLength(7)
    expect(q[0]).toMatchObject({ type: 'income', candidate: { amount: 600_000 } })
    expect(q.slice(1).map((x) => (x.type === 'recurring' ? x.candidate.amount : 0))).toEqual([5_000, 4_500, 4_000, 3_500, 3_000, 2_500])
    expect(beyondLimit(ops)).toBe(3)
    // Без дохода — семь повторов.
    const noIncome = ops.filter((o) => o.amount < 0)
    expect(firstRunQuestions(noIncome).every((x) => x.type === 'recurring')).toBe(true)
    expect(firstRunQuestions(noIncome)).toHaveLength(7)
    expect(beyondLimit(noIncome)).toBe(2)
  })
})
