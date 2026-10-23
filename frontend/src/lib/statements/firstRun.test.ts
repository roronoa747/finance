import { describe, expect, it } from 'vitest'
import type { PdfRow } from './pdf'
import { parseStatement } from './parsers'
import { assignIds, normalizeMerchant } from './model'
import type { MerchantRule, Operation } from './types'
import { QUESTION_LIMIT, recurringOf, beyondLimit, detectIncome, detectRecurring, firstRunQuestions, foundPayments, paymentOpOfMonth, salaryOpOfMonth } from './firstRun'

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

describe('PN-24: еженедельный доход в первом запуске', () => {
  it('четыре прихода по пятницам — rhythm week, weekday 5, сумма — за неделю', () => {
    const ops = assignIds([
      op('2026-09-04', 150_000, 'ТОО Смена'),
      op('2026-09-11', 150_000, 'ТОО Смена'),
      op('2026-09-18', 155_000, 'ТОО Смена'),
      op('2026-09-25', 150_000, 'ТОО Смена'),
    ])
    expect(detectIncome(ops)[0]).toMatchObject({ amount: 150_000, regular: true, rhythm: 'week', weekday: 5, count: 4 })
  })

  it('пропущенная неделя не ломает; месячный и два прихода — без ритма', () => {
    const gap = assignIds([op('2026-09-04', 150_000, 'A'), op('2026-09-11', 150_000, 'A'), op('2026-09-25', 150_000, 'A'), op('2026-10-02', 150_000, 'A')])
    expect(detectIncome(gap)[0]).toMatchObject({ rhythm: 'week', weekday: 5 })
    const two = assignIds([op('2026-09-04', 150_000, 'B'), op('2026-09-11', 150_000, 'B')])
    expect(detectIncome(two)[0].rhythm).toBeUndefined()
    const monthly = assignIds([op('2026-07-10', 500_000, 'C'), op('2026-08-10', 520_000, 'C'), op('2026-09-11', 510_000, 'C')])
    expect(detectIncome(monthly)[0].rhythm).toBeUndefined()
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

  it('возврат приёмки 2 п. 2: paymentOpOfMonth — списание месяца в допуске суммы (±2 %, как правило), ближайшее; оценка — ближайшее любой суммы; первая строка месяца — не платёж', () => {
    // «Перевод с карты на карту» Freedom: все переводы одним названием, обязательство — 15 000.
    const list = assignIds([
      op('2026-09-03', -2_000, 'Перевод с карты на карту', { kind: 'transfer-out' }),
      op('2026-09-12', -280_000, 'Перевод с карты на карту', { kind: 'transfer-out' }),
      op('2026-09-20', -15_200, 'Перевод с карты на карту', { kind: 'transfer-out' }),
      op('2026-09-21', -14_990, 'Перевод с карты на карту', { kind: 'transfer-out' }),
      op('2026-08-20', -15_000, 'Перевод с карты на карту', { kind: 'transfer-out' }),
      op('2026-09-25', 15_000, 'Перевод с карты на карту', { kind: 'transfer-in' }),
      op('2026-09-22', -15_900, 'Перевод с карты на карту', { kind: 'transfer-out' }),
    ])
    expect(paymentOpOfMonth(list, 15_000, '2026-09')?.amount).toBe(-14_990)
    expect(paymentOpOfMonth(list.slice(0, 2), 15_000, '2026-09')).toBeUndefined()
    expect(paymentOpOfMonth(list, 2_540, '2026-09')).toBeUndefined()
    expect(paymentOpOfMonth(list, 15_000, '2026-10')).toBeUndefined()
    // Допуск — ровно ±2 %, как у правила платежа (критик возврата 2): 15 900 (+6 %) — не платёж 15 000.
    expect(paymentOpOfMonth(list.slice(6), 15_000, '2026-09')).toBeUndefined()
    // Приход той же суммы — не платёж.
    expect(paymentOpOfMonth(list.slice(5, 6), 15_000, '2026-09')).toBeUndefined()
    // Коммуналка-оценка: ближайшее списание месяца любой суммы — как правило платежа (`ruleHit`), иначе строка вне
    // допуска ушла бы в плановый раздел, а месяц остался бы «не оплачен» (критик возврата 2).
    expect(paymentOpOfMonth(list, 12_000, '2026-09', true)?.amount).toBe(-14_990)
    expect(paymentOpOfMonth(list, 9_500, '2026-09', true)?.amount).toBe(-14_990)
    expect(paymentOpOfMonth(list.slice(6), 15_000, '2026-09', true)?.amount).toBe(-15_900)
    expect(paymentOpOfMonth(list, 12_000, '2026-09')).toBeUndefined()
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

const T0 = '2026-10-01T00:00:00.000Z'

describe('recurringOf — «В платежи» у повтора продавца (FB-09, Р-17)', () => {
  const at = (id: string, date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Operation =>
    ({ id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...extra }) as Operation
  const APPLE = [at('a1', '2026-08-14', -4_990, 'APPLE.COM BILL'), at('a2', '2026-09-15', -4_990, 'APPLE.COM BILL'), at('a3', '2026-10-13', -4_990, 'APPLE.COM BILL')]
  const NONE = { rules: [], payments: [], today: '2026-10-20' }

  it('три строки ±3 дня — кандидат: имя коротко, сумма и день — медианы', () => {
    expect(recurringOf(APPLE[2], APPLE, NONE)).toEqual({ name: 'APPLE.COM BILL', amount: 4_990, day: 14, kind: 'subscription' })
  })
  // Возврат приёмки Блока 2: у продавца несколько подписок разной цены каждый месяц — форма той, у которой нажали.
  it('несколько подписок одного продавца — сумма и день строк в допуске суммы нажатой, не медиана всех', () => {
    const ops = ['08', '09', '10'].flatMap((m) => [
      at(`x${m}`, `2026-${m}-03`, -990, 'APPLE.COM BILL'),
      at(`y${m}`, `2026-${m}-11`, -2_490, 'APPLE.COM BILL'),
      at(`z${m}`, `2026-${m}-20`, -5_500, 'APPLE.COM BILL'),
    ])
    expect(recurringOf(ops.find((o) => o.id === 'z10')!, ops, NONE)).toMatchObject({ amount: 5_500, day: 20 })
    expect(recurringOf(ops.find((o) => o.id === 'x09')!, ops, NONE)).toMatchObject({ amount: 990, day: 3 })
  })
  it('одна строка словарного вида (свой раздел «Подписки») — кандидат; одна обычная — нет', () => {
    const one = at('k1', '2026-10-05', -2_990, 'KINOPOISK', { categoryId: 'sc_subscriptions' })
    expect(recurringOf(one, [one], NONE)).toMatchObject({ amount: 2_990, day: 5, kind: 'subscription' })
    const shop = at('m1', '2026-10-05', -8_000, 'MAGNUM ALMATY', { categoryId: 'sc_food' })
    expect(recurringOf(shop, [shop], NONE)).toBeNull()
  })
  it('не словарный продавец: две строки — повтор (вид «obligation»), старше 3 месяцев — нет', () => {
    const gym = (id: string, date: string) => at(id, date, -15_000, 'SPORT CLUB')
    expect(recurringOf(gym('g3', '2026-10-05'), [gym('g2', '2026-09-06'), gym('g3', '2026-10-05')], NONE)).toMatchObject({ day: 5, kind: 'obligation' })
    expect(recurringOf(gym('g3', '2026-10-05'), [gym('g1', '2026-05-05'), gym('g2', '2026-06-05'), gym('g3', '2026-10-05')], NONE)).toBeNull()
  })
  it('у продавца уже правило платежа — null; строка уже отметка платежа — null', () => {
    const rules = [{ id: 'r1', match: { merchant: normalizeMerchant('APPLE.COM BILL') }, to: { payment: { kind: 'obligation', targetId: 'o1', categoryId: 'sc_subscriptions' } }, updatedAt: T0 }] as MerchantRule[]
    expect(recurringOf(APPLE[2], APPLE, { ...NONE, rules })).toBeNull()
    expect(recurringOf(APPLE[2], APPLE, { ...NONE, payments: [{ opId: 'a3' }] })).toBeNull()
    expect(recurringOf(APPLE[2], APPLE, { ...NONE, payments: [{ opId: 'a3', deletedAt: T0 }] })).not.toBeNull()
  })
  it('приход, перевод человеку и внутренний — null', () => {
    expect(recurringOf(at('i1', '2026-10-10', 5_000, 'APPLE.COM BILL'), APPLE, NONE)).toBeNull()
    expect(recurringOf(at('p1', '2026-10-10', -5_000, 'Дана К.', { counterparty: 'Дана К.', kind: 'transfer-out' }), APPLE, NONE)).toBeNull()
  })
})

describe('foundPayments — «нашли N в выписке» (FB-21, Р-35)', () => {
  const at = (id: string, date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Operation =>
    ({ id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...extra }) as Operation
  const NONE = { rules: [], payments: [], today: '2026-10-20' }
  const APPLE = [at('a1', '2026-08-14', -4_990, 'APPLE.COM BILL'), at('a2', '2026-09-15', -4_990, 'APPLE.COM BILL'), at('a3', '2026-10-13', -4_990, 'APPLE.COM BILL')]
  const GYM = [at('g2', '2026-09-06', -15_000, 'SPORT CLUB'), at('g3', '2026-10-05', -15_000, 'SPORT CLUB')]
  const ONE = [at('m1', '2026-10-05', -8_000, 'MAGNUM ALMATY', { categoryId: 'sc_food' })]

  it('одна строка на группу, по сумме вниз; opId — последняя строка группы; разовый продавец — мимо', () => {
    const found = foundPayments([...APPLE, ...GYM, ...ONE], NONE)
    expect(found.map((f) => [f.name, f.amount, f.day, f.kind, f.opId])).toEqual([
      ['SPORT CLUB', 15_000, 5, 'obligation', 'g3'],
      ['APPLE.COM BILL', 4_990, 14, 'subscription', 'a3'],
    ])
    expect(new Set(found.map((f) => f.key)).size).toBe(2)
  })
  it('группа с правилом payment не выходит; уже отмеченная строка — не выходит; старше 3 месяцев — мимо', () => {
    const rules = [{ id: 'r1', match: { merchant: normalizeMerchant('APPLE.COM BILL') }, to: { payment: { kind: 'obligation', targetId: 'o1', categoryId: 'sc_subscriptions' } }, updatedAt: T0 }] as MerchantRule[]
    expect(foundPayments([...APPLE, ...GYM], { ...NONE, rules }).map((f) => f.name)).toEqual(['SPORT CLUB'])
    expect(foundPayments([...APPLE, ...GYM], { ...NONE, payments: [{ opId: 'g3' }] }).map((f) => f.name)).toEqual(['APPLE.COM BILL'])
    const old = [at('g0', '2026-05-05', -15_000, 'SPORT CLUB'), at('g1', '2026-06-05', -15_000, 'SPORT CLUB')]
    expect(foundPayments(old, NONE)).toEqual([])
  })
})
