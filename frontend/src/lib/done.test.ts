import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { budgetAmounts, capitalGoals, doneGoals, doneLabel, doneTerm, fundsOf, goalSavings, netWorth, openGoals, queueOf } from './finance'
import type { Account, Goal } from '@/types/finance'

/** PN-13 (Р-13): «Сбылось» — деньги сбывшейся ушли покупкой; очередь, фонды и капитал считают только активные. */

const T0 = '2026-09-01T00:00:00.000Z'
const goal = (id: string, have: number, extra: Partial<Goal> = {}): Goal => ({
  id, name: id, need: 1_000_000, seed: have, have, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})
const ACCOUNTS: Account[] = [{ id: 'kaspi', name: 'Kaspi Gold', note: '', amount: 800_000, kind: 'card', updatedAt: T0 }]
const ids = (q: { id: string }[]) => q.map((x) => x.id)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T08:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('openGoals / doneGoals', () => {
  const goals = [
    goal('trip', 600_000, { doneAt: '2026-07-15T10:00:00.000Z' }),
    goal('bike', 230_000, { doneAt: '2026-09-02T10:00:00.000Z' }),
    goal('car', 900_000),
    goal('back', 100_000, { doneAt: null }),
    goal('gone', 50_000, { doneAt: '2026-08-01T10:00:00.000Z', deletedAt: T0 }),
  ]
  it('активные — без doneAt (null — вернули), удалённые выпадают из обоих', () => {
    expect(ids(openGoals(goals))).toEqual(['car', 'back'])
  })
  it('сбывшиеся — новые первыми', () => {
    expect(ids(doneGoals(goals))).toEqual(['bike', 'trip'])
  })
})

describe('капитал без сбывшейся', () => {
  // Счета 800 000; цели вне счёта: Машина 900 000 + Япония 600 000 (сбылась) — в капитале только Машина.
  const goals = [goal('car', 900_000), goal('trip', 600_000, { doneAt: '2026-10-01T10:00:00.000Z' }), goal('pot', 300_000, { accountId: 'kaspi', doneAt: '2026-10-01T10:00:00.000Z' })]
  it('goalSavings и netWorth: −have сбывшейся (800 000 + 900 000 = 1 700 000)', () => {
    expect(goalSavings(goals)).toBe(900_000)
    expect(netWorth(ACCOUNTS, [], goals)).toBe(1_700_000)
  })
  it('capitalGoals: сбывшейся на счёте и вне счёта нет в «Цели · N»', () => {
    expect(capitalGoals(goals, ACCOUNTS)).toEqual({ count: 1, total: 900_000, items: [{ goalId: 'car', name: 'car', amount: 900_000, accountName: null }] })
  })
  it('старый документ без doneAt — прежние числа (800 000 + 900 000 + 600 000)', () => {
    const old = goals.map(({ doneAt: _d, ...g }) => g as Goal)
    expect(goalSavings(old)).toBe(1_500_000)
    expect(netWorth(ACCOUNTS, [], old)).toBe(2_300_000)
    expect(capitalGoals(old, ACCOUNTS).count).toBe(2)
  })
  it('бюджет месяца: «Взносы в цели» без сбывшихся — 50 000 вместо 150 000', () => {
    expect(budgetAmounts({ goals }).d3).toBe(50_000)
    expect(budgetAmounts({ goals: goals.map(({ doneAt: _d, ...g }) => g as Goal) }).d3).toBe(150_000)
  })
})

describe('очередь и фонды без сбывшейся', () => {
  it('queueOf: сбывшаяся выпадает, место в goalOrder не правится', () => {
    const goals = [goal('a', 0), goal('b', 0, { doneAt: '2026-10-01T10:00:00.000Z' }), goal('c', 0)]
    expect(ids(queueOf({ goals, goalOrder: { ids: ['b', 'a', 'c'], updatedAt: T0 } }))).toEqual(['a', 'c'])
  })
  it('fundsOf: сбывшаяся подушка — не фонд семьи', () => {
    const cushion = goal('pot', 300_000, { fund: 'cushion', doneAt: '2026-10-01T10:00:00.000Z' })
    expect(fundsOf({ goals: [cushion] }).cushion).toBeNull()
    expect(fundsOf({ goals: [{ ...cushion, doneAt: null }] }).cushion?.id).toBe('pot')
  })
})

describe('doneTerm — «за N месяцев»', () => {
  const put = (date: string, amount = 50_000) => ({ id: date, date, amount, by: 'a' as const })
  it('от первого положительного взноса до месяца doneAt: авг 2025 → окт 2026 = 14', () => {
    const g = goal('trip', 0, { doneAt: '2026-10-10T08:00:00.000Z', movements: [put('2025-09-03T05:00:00.000Z'), put('2025-08-20T05:00:00.000Z'), put('2025-07-01T05:00:00.000Z', -10_000)] })
    expect(doneTerm(g)).toBe(14)
    expect(doneLabel(doneTerm(g))).toBe('за 14 месяцев')
  })
  it('без движений — от seedSetAt; без него — 1; тот же месяц — 1', () => {
    expect(doneTerm(goal('a', 0, { doneAt: '2026-10-01T08:00:00.000Z', seedSetAt: '2026-06-15T08:00:00.000Z' }))).toBe(4)
    expect(doneTerm(goal('b', 0, { doneAt: '2026-10-01T08:00:00.000Z' }))).toBe(1)
    expect(doneTerm(goal('c', 0, { doneAt: '2026-10-09T08:00:00.000Z', movements: [put('2026-10-02T05:00:00.000Z')] }))).toBe(1)
  })
  it('словами: 1 месяц, 4 месяца, 11 месяцев', () => {
    expect([doneLabel(1), doneLabel(4), doneLabel(11)]).toEqual(['за 1 месяц', 'за 4 месяца', 'за 11 месяцев'])
  })
})
