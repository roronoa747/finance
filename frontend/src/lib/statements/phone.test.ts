import { describe, expect, it } from 'vitest'
import { replacedByStatement, replacementPairs } from './phone'
import type { Operation } from './types'

// Выписка заменяет траты с телефона (Р-16): пары, единственный кандидат, фантомы.

const st = (id: string, date: string, amount: number, merchant: string, bank: Operation['bank'] = 'kaspi', extra: Partial<Operation> = {}): Operation => ({
  id, bank, date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...extra,
})
const ph = (id: string, date: string, amount: number, merchant: string, bank: Operation['bank'] = 'kaspi', extra: Partial<Operation> = {}): Operation =>
  st(id, date, amount, merchant, bank, { source: 'tap', ...extra })

/** Выписка без периода — только пары (фантомы не трогаем). */
const NO_SPAN: { bank: Operation['bank']; from: string; to: string }[] = []
const ids = (s: Set<string>) => [...s].sort()

describe('replacedByStatement', () => {
  it('п. 1 — тот же продавец по normalizeMerchant, та же сумма, +1 день', () => {
    expect(ids(replacedByStatement([st('s1', '2026-10-15', -5000, 'MAGNUM ALMATY KZ')], [ph('p1', '2026-10-14', -5000, 'Magnum')], NO_SPAN))).toEqual(['p1'])
  })

  it('п. 1 с валютой — в пределах 3 %: 2989 ↔ 3030 да, 3200 нет', () => {
    const usd = (amount: number) => ph('p1', '2026-10-14', amount, 'Apple Store', 'card', { fx: { currency: 'USD', amount: 622 } })
    expect(ids(replacedByStatement([st('s1', '2026-10-14', -3030, 'APPLE STORE')], [usd(-2989)], NO_SPAN))).toEqual(['p1'])
    expect(ids(replacedByStatement([st('s1', '2026-10-14', -3200, 'APPLE STORE')], [usd(-2989)], NO_SPAN))).toEqual([])
    // Не пересчитанная (amount 0) по сумме не сходится.
    expect(ids(replacedByStatement([st('s1', '2026-10-14', -3030, 'APPLE STORE')], [usd(0)], NO_SPAN))).toEqual([])
    // Без валюты — только точная сумма.
    expect(ids(replacedByStatement([st('s1', '2026-10-14', -3030, 'Magnum')], [ph('p1', '2026-10-14', -3000, 'Magnum')], NO_SPAN))).toEqual([])
  })

  it('п. 2 — разные названия: единственный кандидат того же банка — да; два — нет; банк card — да', () => {
    const line = st('s1', '2026-10-14', -1200, 'IP AHMETOV')
    expect(ids(replacedByStatement([line], [ph('p1', '2026-10-15', -1200, 'Coffee')], NO_SPAN))).toEqual(['p1'])
    expect(ids(replacedByStatement([line], [ph('p1', '2026-10-15', -1200, 'Coffee'), ph('p2', '2026-10-14', -1200, 'Tea')], NO_SPAN))).toEqual([])
    expect(ids(replacedByStatement([line], [ph('p1', '2026-10-14', -1200, 'Apple Pay', 'card')], NO_SPAN))).toEqual(['p1'])
    // Другой банк — не кандидат.
    expect(ids(replacedByStatement([line], [ph('p1', '2026-10-14', -1200, 'Coffee', 'freedom')], NO_SPAN))).toEqual([])
    // Дальше дня — не кандидат.
    expect(ids(replacedByStatement([line], [ph('p1', '2026-10-16', -1200, 'Coffee')], NO_SPAN))).toEqual([])
  })

  it('п. 1 — касание другого узнанного банка не строка выписки, даже с тем же продавцом (критик Б1)', () => {
    // Кофе с Halyk в понедельник, Kaspi QR во вторник: две траты.
    expect(ids(replacedByStatement([st('s1', '2026-10-14', -1200, 'COFFEE BOOM')], [ph('h1', '2026-10-13', -1200, 'Coffee Boom', 'halyk')], NO_SPAN))).toEqual([])
    // Банк не узнан (card) — может быть этой строкой.
    expect(ids(replacedByStatement([st('s1', '2026-10-14', -1200, 'COFFEE BOOM')], [ph('c1', '2026-10-13', -1200, 'Coffee Boom', 'card')], NO_SPAN))).toEqual(['c1'])
  })

  it('п. 3 — фантом внутри периода убран; в последний день и другого банка — остаётся', () => {
    const span = [{ bank: 'kaspi' as const, from: '2026-10-01', to: '2026-10-15' }]
    const phone = [
      ph('inside', '2026-10-10', -900, 'Declined'),
      ph('last', '2026-10-15', -900, 'Late'),
      ph('other', '2026-10-10', -900, 'Halyk shop', 'halyk'),
      ph('card', '2026-10-10', -900, 'Some card', 'card'),
      ph('after', '2026-10-16', -900, 'Later'),
    ]
    expect(ids(replacedByStatement([], phone, span))).toEqual(['inside'])
  })

  it('приход и расход одной суммы — не пара; одна телефонная — максимум одна пара', () => {
    expect(ids(replacedByStatement([st('s1', '2026-10-14', 5000, 'Magnum', 'kaspi', { kind: 'transfer-in' })], [ph('p1', '2026-10-14', -5000, 'Magnum')], NO_SPAN))).toEqual([])
    const two = [st('s1', '2026-10-14', -5000, 'Magnum'), st('s2', '2026-10-14', -5000, 'Magnum', 'kaspi', { id: 's2' })]
    const res = replacedByStatement(two, [ph('p1', '2026-10-14', -5000, 'Magnum'), ph('p2', '2026-10-15', -5000, 'Magnum')], NO_SPAN)
    // Две строки — две пары: p1 уже занят первой строкой, вторая берёт p2 (ревью frontend Н-5: без проверки занятого
    // вторая строка снова взяла бы ближайший p1, и p2 остался бы вторым рядом).
    expect(ids(res)).toEqual(['p1', 'p2'])
  })

  it('п. 2 — фантом этой выписки не спорит с более близким касанием (кофе каждый день, ревью frontend Н-1)', () => {
    const span = [{ bank: 'kaspi' as const, from: '2026-10-01', to: '2026-10-15' }]
    const coffee = (id: string, date: string) => ph(id, date, -1200, 'Coffee')
    const line = (id: string, date: string) => st(id, date, -1200, 'IP AHMETOV')
    // A: строки 14 и 15, касания 14 и 15 — оба убраны (было: касание 15 вторым рядом со строкой 15).
    expect(ids(replacedByStatement([line('s14', '2026-10-14'), line('s15', '2026-10-15')], [coffee('p14', '2026-10-14'), coffee('p15', '2026-10-15')], span))).toEqual(['p14', 'p15'])
    // B: строка 15; касание 14 отклонено банком, касание 15 — оба убраны.
    expect(ids(replacedByStatement([line('s15', '2026-10-15')], [coffee('p14', '2026-10-14'), coffee('p15', '2026-10-15')], span))).toEqual(['p14', 'p15'])
    // C: строка 14; касание 15 после выгрузки выписки (его в ней нет) — остаётся.
    expect(ids(replacedByStatement([line('s14', '2026-10-14')], [coffee('p14', '2026-10-14'), coffee('p15', '2026-10-15')], span))).toEqual(['p14'])
  })

  it('ближайшая по дате побеждает', () => {
    const res = replacedByStatement(
      [st('s1', '2026-10-14', -5000, 'Magnum')],
      [ph('far', '2026-10-13', -5000, 'Magnum'), ph('near', '2026-10-14', -5000, 'Magnum')],
      NO_SPAN,
    )
    expect(ids(res)).toEqual(['near'])
  })

  it('без операций с телефона — пусто', () => {
    expect(replacedByStatement([st('s1', '2026-10-14', -5000, 'Magnum')], [], [{ bank: 'kaspi', from: '2026-10-01', to: '2026-10-31' }]).size).toBe(0)
  })
})

describe('replacementPairs (FB-01)', () => {
  it('операция с телефона → строка выписки, что её заменила; фантом — null', () => {
    const pairs = replacementPairs(
      [st('s1', '2026-10-14', -5000, 'MAGNUM'), st('s2', '2026-10-14', -1200, 'IP AHMETOV')],
      [ph('p1', '2026-10-14', -5000, 'Magnum'), ph('p2', '2026-10-14', -1200, 'Coffee'), ph('p3', '2026-10-10', -700, 'Lost')],
      [{ bank: 'kaspi', from: '2026-10-01', to: '2026-10-15' }],
    )
    expect([...pairs].sort()).toEqual([['p1', 's1'], ['p2', 's2'], ['p3', null]])
  })
})
