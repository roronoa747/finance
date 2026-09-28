import { describe, it, expect } from 'vitest'
import { matchCandidates, matchCategory, matchKey, nearestPeriod, operationAt, paymentFits, recentOperations, releasedOps, ruleHit } from './matching'
import { assignIds, normalizeMerchant } from './model'
import type { MerchantRule, Operation } from './types'
import type { Credit, Obligation, Payment, Person } from '@/types/finance'
import { money } from '@/lib/money'

/** Сопоставление строк выписки с отметками (Р-6, B2C-15). */
const T = '2026-09-01T00:00:00.000Z'
const ob = (id: string, name: string, amount: number, day: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day, category: 'd1', versions: [{ from: '2000-01', amount }], updatedAt: T, ...extra,
})
const rent = ob('rent', 'Аренда', 220_000, 5)
const utilities = ob('util', 'Коммуналка', 30_000, 15, { estimate: true })
const netflix = ob('nf', 'Netflix', 4_990, 3, { category: 'd4' })
const loan: Credit = { id: 'loan', name: 'Автокредит', note: '', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T }
const people: Person[] = [
  { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T },
  { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T },
]
const state = { obligations: [rent, utilities, netflix], credits: [loan], people, payments: [] as Payment[] }

const op = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false, ...extra,
})
const ops = (...list: Omit<Operation, 'id'>[]) => assignIds(list)

describe('matchCandidates', () => {
  it('обязательство: сумма ±2 % и окно ±5 дней от дня; оценка — ±30 %; кредит — creditDueAmount ±2 % или ровно платёж', () => {
    const list = ops(
      op('2026-09-06', -220_000, 'PEREVOD ARENDA'), // аренда 5-го, день спустя
      op('2026-09-16', -33_000, 'ALSECO'), // коммуналка-оценка 30 000 +10 %
      op('2026-09-14', -58_000, 'Оплата Kaspi Кредита'), // кредит: due 58 000
      op('2026-09-15', -250_000, 'SOMETHING'), // ни на что не похоже
      op('2026-09-25', -220_000, 'LATE ARENDA'), // аренда, но 20 дней от 5-го
    )
    const out = matchCandidates(list, state, [])
    expect(out.map((c) => [c.opId === list[0].id ? 'op0' : c.opId === list[1].id ? 'op1' : 'op2', c.kind, c.targetId, c.period, c.confidence])).toEqual([
      ['op0', 'obligation', 'rent', '2026-09', 'likely'],
      ['op1', 'obligation', 'util', '2026-09', 'likely'],
      ['op2', 'credit', 'loan', '2026-09', 'likely'],
    ])
    expect(out[0]).toMatchObject({ amount: 220_000, categoryId: 'sc_rent', question: 'Похоже, это платёж по Аренда — отметить?' })
    expect(out[0].meta).toBe(`${money(220_000)} · 6 сентября · «PEREVOD ARENDA»`)
    expect(out[1]).toMatchObject({ categoryId: 'sc_utilities' })
    expect(out[2]).toMatchObject({ categoryId: 'sc_credit', question: 'Похоже, это платёж по Автокредит — отметить?' })
    // Точная сумма без оценки — ±2 %: 215 000 за аренду не подходит, 223 000 — подходит.
    expect(matchCandidates(ops(op('2026-09-05', -215_000, 'X')), state, [])).toEqual([])
    expect(matchCandidates(ops(op('2026-09-05', -223_000, 'X')), state, [])[0]?.targetId).toBe('rent')
    // Кредит: ровно платёж проходит даже когда due отличается (после досрочки остаток мал).
    const small = { ...loan, principal: 40_000 } // due = 40 000 + 1 100 = 41 100
    expect(matchCandidates(ops(op('2026-09-15', -58_000, 'K')), { ...state, credits: [small] }, [])[0]?.kind).toBe('credit')
  })

  it('зарплата — только своя (слот владельца телефона): приход ≈ оклад ±10 % в окне ±7 дней от дня; вопрос «Это зарплата <имя>?»', () => {
    const list = ops(
      op('2026-09-11', 700_000, 'ТОО Работодатель'),
      op('2026-09-19', 460_000, 'ТОО Другой'), // Дана 500 000 −8 %
      op('2026-09-30', 700_000, 'ТОО Работодатель'), // далеко от 10-го (и от 10 октября)
      op('2026-09-11', 700_000, 'ИП', { kind: 'purchase' }), // приход не переводом — не зарплата
    )
    const at = (me?: 'a' | 'b') => matchCandidates(list, state, [], me).map((c) => [c.kind, c.targetId, c.period])
    // Выписка Ильяса предлагает только его зарплату; приход 460 000 похож на оклад Даны, но её месяц
    // отмечает она сама своей выпиской (RP-10) — иначе её «Пришла зарплата» пропала бы.
    expect(at('a')).toEqual([['salary', 'a', '2026-09']])
    expect(at('b')).toEqual([['salary', 'b', '2026-09']])
    expect(at()).toEqual([])
    expect(matchCandidates(list, state, [], 'a')[0]).toMatchObject({ question: 'Это зарплата Ильяс?', meta: `${money(700_000)} · 11 сентября · поступление`, categoryId: null })

    // Оклады близки: свой приход в день зарплаты партнёра — всё равно своя зарплата, а не его.
    const close = { ...state, people: [{ ...people[0], salary: 490_000, payday: 18 }, people[1]] }
    expect(matchCandidates(ops(op('2026-09-20', 500_000, 'ТОО Работодатель')), close, [], 'a').map((c) => [c.kind, c.targetId])).toEqual([['salary', 'a']])
  })

  it('уже отмеченный месяц — без предложения; одна операция — одно предложение; одна пара «цель · месяц» — одно; внутренние и привязанные — мимо', () => {
    const paid: Payment = { id: 'p', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000, accountId: null, by: 'a', at: T, updatedAt: T }
    const list = ops(op('2026-09-06', -220_000, 'ARENDA'), op('2026-09-07', -220_000, 'ARENDA 2'))
    expect(matchCandidates(list, { ...state, payments: [paid] }, [])).toEqual([])
    // Без отметки — только первая операция берёт пару «аренда · сентябрь».
    const twice = matchCandidates(list, state, [])
    expect(twice.map((c) => c.opId)).toEqual([list[0].id])
    // Внутренний перевод и операция, уже привязанная к отметке (в том числе снятой), не предлагаются.
    const linked: Payment = { ...paid, id: 'q', opId: list[0].id, deletedAt: T }
    expect(matchCandidates(list, { ...state, payments: [linked] }, []).map((c) => c.opId)).toEqual([list[1].id])
    expect(matchCandidates(ops(op('2026-09-06', -220_000, 'ARENDA', { internal: true })), state, [])).toEqual([])
  })

  it('правило семьи «это платёж по …» → confidence rule, месяц — ближайший к дате; подписка помечена', () => {
    const list = ops(op('2026-10-02', -58_000, 'Оплата Kaspi Кредита'), op('2026-09-04', -4_990, 'NETFLIX.COM'))
    const rules: MerchantRule[] = [
      { id: 'r', match: { merchant: normalizeMerchant('Оплата Kaspi Кредита') }, to: { payment: { kind: 'credit', targetId: 'loan', categoryId: 'sc_credit' } }, by: 'a', updatedAt: T },
    ]
    const out = matchCandidates(list, state, rules)
    expect(out[0]).toMatchObject({ kind: 'credit', targetId: 'loan', period: '2026-10', confidence: 'rule', categoryId: 'sc_credit' })
    expect(out[1]).toMatchObject({ kind: 'obligation', targetId: 'nf', confidence: 'likely', subscription: true, categoryId: 'sc_subscriptions' })
    expect(matchKey(out[0])).toBe('credit:loan:2026-10')
  })

  it('правило отмечает только «такую» строку: зарплата — приход в допуске оклада, кредит — сумма своего платежа, обязательство — ±2 % суммы месяца, оценка — любой суммой списания', () => {
    const rule = (merchant: string, payment: { kind: 'salary' | 'credit' | 'obligation'; targetId: string }): MerchantRule => ({
      id: merchant, match: { merchant: normalizeMerchant(merchant) }, to: { payment: { ...payment, categoryId: null } }, by: 'a', updatedAt: T,
    })
    const cc: Credit = { id: 'cc', name: 'Кредитка', note: '', principal: 300_000, annualRate: 0.4, payment: 25_000, day: 22, updatedAt: T }
    const two = { ...state, credits: [loan, cc] }
    const rules = [
      rule('С карты другого банка', { kind: 'salary', targetId: 'a' }),
      rule('Оплата Kaspi Кредита', { kind: 'credit', targetId: 'loan' }),
      rule('PEREVOD ARENDA', { kind: 'obligation', targetId: 'rent' }),
      rule('ALSECO', { kind: 'obligation', targetId: 'util' }),
    ]
    const at = (list: ReturnType<typeof ops>, me: 'a' | 'b' = 'a') => matchCandidates(list, two, rules, me).map((c) => [c.kind, c.targetId, c.period, c.confidence])

    // Зарплата по правилу: 700 000 — отмечается сама; пополнение 5 000 тем же продавцом — не зарплата
    // (и не вопрос); исходящий перевод тому же продавцу — тоже нет.
    expect(at(ops(op('2026-10-12', 700_000, 'С карты другого банка')))).toEqual([['salary', 'a', '2026-10', 'rule']])
    expect(at(ops(op('2026-10-05', 5_000, 'С карты другого банка')))).toEqual([])
    expect(at(ops(op('2026-10-10', -700_000, 'С карты другого банка')))).toEqual([])
    // Правило «это зарплата Ильяса» на телефоне Даны не применяется: чужую зарплату не отмечаем.
    expect(at(ops(op('2026-10-12', 700_000, 'С карты другого банка')), 'b')).toEqual([])
    // Кредит по правилу: строка другого кредита (25 000, 22-го) — не платёж Автокредита, а вопрос про Кредитку.
    expect(at(ops(op('2026-09-14', -58_000, 'Оплата Kaspi Кредита')))).toEqual([['credit', 'loan', '2026-09', 'rule']])
    expect(at(ops(op('2026-09-22', -25_000, 'Оплата Kaspi Кредита')))).toEqual([['credit', 'cc', '2026-09', 'likely']])
    // Обязательство с точной суммой — ±2 % (возврат приёмки 2 п. 2): под «Переводом с карты на карту»
    // Freedom идут все переводы подряд, 300 000 — не аренда 220 000; поздний платёж — тоже платёж.
    expect(at(ops(op('2026-09-06', -223_000, 'PEREVOD ARENDA')))).toEqual([['obligation', 'rent', '2026-09', 'rule']])
    expect(at(ops(op('2026-09-06', -300_000, 'PEREVOD ARENDA')))).toEqual([])
    expect(at(ops(op('2026-09-20', -2_000, 'PEREVOD ARENDA')))).toEqual([])
    expect(at(ops(op('2026-09-28', -220_000, 'PEREVOD ARENDA')))).toEqual([['obligation', 'rent', '2026-10', 'rule']])
    // Оценка (коммуналка) суммой не ограничена — зимой уходит за 30 %; приход — не платёж.
    expect(at(ops(op('2026-09-16', -52_000, 'ALSECO')))).toEqual([['obligation', 'util', '2026-09', 'rule']])
    expect(at(ops(op('2026-09-06', 220_000, 'PEREVOD ARENDA')))).toEqual([])
  })

  it('ruleHit и paymentFits — одна проверка для отметки и раздела: сумма месяца по версиям, кредит и закрытый, нет цели — нет', () => {
    const pay = (kind: 'obligation' | 'credit', targetId: string) => ({ kind, targetId, categoryId: null })
    const [row] = ops(op('2026-09-06', -250_000, 'PEREVOD ARENDA'))
    // Аренда подорожала с сентября: сентябрь сверяется с 250 000, август — с 220 000.
    const raised = { ...rent, versions: [...rent.versions, { from: '2026-09', amount: 250_000 }] }
    const targets = { obligations: [raised], credits: [loan], people: [] }
    expect(ruleHit(row, pay('obligation', 'rent'), targets)).toMatchObject({ target: { id: 'rent' }, period: '2026-09' })
    expect(ruleHit(ops(op('2026-08-06', -250_000, 'PEREVOD ARENDA'))[0], pay('obligation', 'rent'), targets)).toBeNull()
    expect(ruleHit(row, pay('obligation', 'gone'), targets)).toBeNull()

    // paymentFits — для раздела: кредит закрыт последним платежом — строка всё равно его платёж.
    const closed = { ...loan, principal: 0 }
    const fits = paymentFits({ obligations: [rent], credits: [closed] })
    expect(fits(ops(op('2026-09-14', -58_000, 'K'))[0], pay('credit', 'loan'))).toBe(true)
    expect(fits(ops(op('2026-09-14', -5_000, 'K'))[0], pay('credit', 'loan'))).toBe(false)
    expect(fits(ops(op('2026-09-05', -220_000, 'A'))[0], pay('obligation', 'rent'))).toBe(true)
    expect(fits(ops(op('2026-09-05', -15_000, 'A'))[0], pay('obligation', 'rent'))).toBe(false)
    expect(paymentFits({ obligations: [{ ...rent, deletedAt: T }] })(ops(op('2026-09-05', -220_000, 'A'))[0], pay('obligation', 'rent'))).toBe(false)
  })

  it('releasedOps: снятая отметка с id операции освобождает её; правка отметки и повторная отметка месяца — нет', () => {
    const paid: Payment = { id: 'p1', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, accountId: null, by: 'a', at: T, updatedAt: T, source: 'statement', opId: 'op1' }
    expect([...releasedOps([paid])]).toEqual([])
    expect([...releasedOps([{ ...paid, deletedAt: T }])]).toEqual(['op1'])
    // «Другая сумма или счёт» (editPaid): надгробие + новая запись с тем же opId.
    expect([...releasedOps([{ ...paid, deletedAt: T }, { ...paid, id: 'p2', amount: 60_000 }])]).toEqual([])
    // Месяц отметили снова вручную — операция и есть этот платёж.
    const manual: Payment = { ...paid, id: 'p3', source: 'manual', opId: undefined }
    expect([...releasedOps([{ ...paid, deletedAt: T }, manual])]).toEqual([])
    // Месяц отметила другая строка выписки: платёж — она, снятая остаётся тратой (критик возврата).
    expect([...releasedOps([{ ...paid, deletedAt: T }, { ...paid, id: 'p4', opId: 'op2' }])]).toEqual(['op1'])
  })

  it('operationAt: полдень дня операции по Алматы в ISO UTC, не позже «сейчас»', () => {
    expect(operationAt('2026-09-14', Date.parse('2026-09-20T07:00:00Z'))).toBe('2026-09-14T07:00:00.000Z')
    expect(operationAt('2026-09-20', Date.parse('2026-09-20T03:00:00Z'))).toBe('2026-09-20T03:00:00.000Z')
  })

  it('nearestPeriod, matchCategory, recentOperations', () => {
    expect(nearestPeriod('2026-10-02', 30)).toEqual({ period: '2026-09', gap: 2 })
    expect(nearestPeriod('2026-02-28', 31)).toEqual({ period: '2026-02', gap: 0 })
    expect(nearestPeriod('2026-09-14', 15)).toEqual({ period: '2026-09', gap: 1 })
    expect(matchCategory('credit', loan)).toBe('sc_credit')
    expect(matchCategory('obligation', ob('x', 'X', 1, 1, { category: 'd2' }))).toBe('sc_credit')
    expect(matchCategory('obligation', ob('x', 'X', 1, 1, { category: 'd4', estimate: true }))).toBeNull()
    expect(matchCategory('salary', people[0])).toBeNull()
    const list = ops(op('2026-07-31', -1, 'old'), op('2026-08-01', -1, 'prev'), op('2026-09-20', -1, 'now'))
    expect(recentOperations(list, '2026-09').map((o) => o.merchant)).toEqual(['prev', 'now'])
  })
})
