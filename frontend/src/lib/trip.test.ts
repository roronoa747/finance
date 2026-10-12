import { describe, expect, it } from 'vitest'
import { tripOps, tripSpent, tripStatus, tripTotal } from './finance'
import type { Operation } from '@/lib/statements/types'
import type { Person, TripSpend } from '@/types/finance'

// Поездка с бюджетом (PN-30, Р-14): статус по датам, свои траты за даты, итог семьи из записей участников.

const T = '2026-10-01T05:00:00.000Z'
const trip = { from: '2026-10-10', to: '2026-10-15' }
const op = (id: string, date: string, amount: number, p: Partial<Operation> = {}): Operation => ({
  id, bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant: id, categoryId: null, internal: false, ...p,
})
const none = new Set<string>()

describe('tripStatus', () => {
  it('до, в первый и последний день — во время, после; без дат — none', () => {
    expect(tripStatus(trip, '2026-10-09')).toBe('before')
    expect(tripStatus(trip, '2026-10-10')).toBe('during')
    expect(tripStatus(trip, '2026-10-15')).toBe('during')
    expect(tripStatus(trip, '2026-10-16')).toBe('after')
    expect(tripStatus({}, '2026-10-12')).toBe('none')
    expect(tripStatus({ from: '2026-10-10', to: null }, '2026-10-12')).toBe('none')
  })
})

describe('tripOps / tripTotal', () => {
  const ops = [
    op('before', '2026-10-09', -1_000),
    op('first', '2026-10-10', -2_000),
    op('mid', '2026-10-12', -3_000),
    op('last', '2026-10-15', -4_000),
    op('after', '2026-10-16', -5_000),
    op('income', '2026-10-12', 50_000),
    op('own', '2026-10-12', -6_000, { internal: true }),
    op('rent', '2026-10-11', -220_000),
    op('hotel', '2026-10-13', -70_000),
  ]

  it('границы дат включительно; поступления и переводы между своими не входят; новые первыми', () => {
    expect(tripOps(ops, trip, none, none).map((o) => o.id)).toEqual(['last', 'hotel', 'mid', 'rent', 'first'])
  })

  it('платежи по отметкам (`marked`) и снятые с поездки (`excluded`) не входят', () => {
    const list = tripOps(ops, trip, new Set(['rent']), new Set(['hotel']))
    expect(list.map((o) => o.id)).toEqual(['last', 'mid', 'first'])
    expect(tripTotal(list)).toEqual({ amount: 9_000, ops: 3 })
  })

  it('без дат — пусто', () => {
    expect(tripOps(ops, { from: null, to: null }, none, none)).toEqual([])
    expect(tripTotal([])).toEqual({ amount: 0, ops: 0 })
  })
})

describe('tripSpent', () => {
  const people: Person[] = [
    { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T },
    { id: 'b', name: 'Аруна', salary: 0, payday: 10, updatedAt: T },
  ]
  const spend = (by: 'a' | 'b', amount: number, p: Partial<TripSpend> = {}): TripSpend => ({
    id: `g-trip:${by}`, goalId: 'g-trip', by, amount, ops: 1, updatedAt: T, ...p,
  })

  it('сумма двух участников; бюджет — свой, пусто — сумма мечты', () => {
    const goal = { id: 'g-trip', need: 1_200_000, budget: 500_000 }
    const list = [spend('a', 120_000), spend('b', 80_000), { ...spend('a', 999), id: 'other:a', goalId: 'other' }]
    expect(tripSpent(goal, list, people)).toEqual({
      total: 200_000,
      byPerson: [{ person: 'a', name: 'Ильяс', amount: 120_000 }, { person: 'b', name: 'Аруна', amount: 80_000 }],
      budget: 500_000,
    })
    expect(tripSpent({ ...goal, budget: null }, list, people).budget).toBe(1_200_000)
  })

  it('без трат участник не в строке; надгробие не считается; записей нет — 0', () => {
    const goal = { id: 'g-trip', need: 1_000 }
    expect(tripSpent(goal, [spend('a', 0), spend('b', 5_000)], people).byPerson.map((x) => x.person)).toEqual(['b'])
    expect(tripSpent(goal, [spend('a', 7_000, { deletedAt: T })], people).total).toBe(0)
    expect(tripSpent(goal, undefined, people)).toEqual({ total: 0, byPerson: [], budget: 1_000 })
  })
})
