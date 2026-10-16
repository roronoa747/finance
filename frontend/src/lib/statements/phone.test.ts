import { describe, expect, it } from 'vitest'
import { replacedByStatement } from './phone'
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
    const res = replacedByStatement(two, [ph('p1', '2026-10-14', -5000, 'Magnum'), ph('p2', '2026-10-17', -5000, 'Magnum')], NO_SPAN)
    // p2 дальше дня — ни одна строка его не берёт; p1 — одна пара на две строки.
    expect(ids(res)).toEqual(['p1'])
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
