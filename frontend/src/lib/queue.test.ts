import { describe, expect, it } from 'vitest'
import { DEBT_CARD, fundsOf, mainGoal, moveId, moveWithin, payerOf, queueOf, wishQueue } from './finance'
import type { Credit, Goal, Person, WishItem } from '@/types/finance'

/** B2C-85: очередь целей и желаний (Р-84), фонды (Р-82), плательщик (Р-80). */

const T1 = '2026-10-01T05:00:00.000Z'
const T2 = '2026-10-02T05:00:00.000Z'
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, name: id, need: 1_000_000, seed: 0, have: 0, monthly: 10_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T1, ...extra,
})
const loan = (extra: Partial<Credit> = {}): Credit => ({
  id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, annualRate: 0.2, payment: 50_000, day: 15, updatedAt: T1, ...extra,
})
const wish = (id: string, extra: Partial<WishItem> = {}): WishItem => ({ id, name: id, price: 1, by: 'a', addedOn: T1, bought: false, updatedAt: T1, ...extra })
const ids = (q: { id: string }[]) => q.map((x) => x.id)

describe('queueOf — очередь денег', () => {
  it('порядок из goalOrder; живые не в списке — в конец по документу; удалённые и незнакомые выпадают', () => {
    const goals = [goal('a'), goal('b'), goal('c'), goal('gone', { deletedAt: T2 }), goal('new')]
    const q = queueOf({ goals, goalOrder: { ids: ['c', 'gone', 'x', 'a', 'c'], updatedAt: T1 } })
    expect(ids(q)).toEqual(['c', 'a', 'b', 'new'])
  })

  it('порядка нет — старый main (поздний) первым; порядок записан — main больше не поднимает', () => {
    const goals = [goal('a'), goal('b', { main: true, updatedAt: T1 }), goal('c', { main: true, updatedAt: T2 })]
    expect(ids(queueOf({ goals }))).toEqual(['c', 'a', 'b'])
    expect(ids(queueOf({ goals, goalOrder: { ids: ['a', 'b', 'c'], updatedAt: T2 } }))).toEqual(['a', 'b', 'c'])
    // Пустой список ids — как нет порядка.
    expect(ids(queueOf({ goals, goalOrder: { ids: [], updatedAt: T2 } }))).toEqual(['c', 'a', 'b'])
  })

  it('фонды и карточка долга — в очереди; долга с процентами нет — карточки нет', () => {
    const goals = [goal('trip'), goal('res', { fund: 'reserve' }), goal('pot')]
    const doc = { goals, credits: [loan()], moneySettings: { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'pot', updatedAt: T1 } }
    const q = queueOf({ ...doc, goalOrder: { ids: ['res', DEBT_CARD, 'trip'], updatedAt: T1 } })
    expect(q.map((x) => [x.id, x.kind])).toEqual([['res', 'fund'], [DEBT_CARD, 'debt'], ['trip', 'goal'], ['pot', 'fund']])
    expect(q.find((x) => x.id === 'pot')).toMatchObject({ fund: 'cushion' })
    // Без порядка карточка — в конце; долг закрыт или беспроцентный — карточки нет даже в порядке.
    expect(ids(queueOf({ goals: [goal('trip')], credits: [loan()] }))).toEqual(['trip', DEBT_CARD])
    expect(ids(queueOf({ goals: [goal('trip')], credits: [loan({ principal: 0 })], goalOrder: { ids: [DEBT_CARD, 'trip'], updatedAt: T1 } }))).toEqual(['trip'])
    expect(ids(queueOf({ goals: [goal('trip')], credits: [loan({ annualRate: 0 })] }))).toEqual(['trip'])
  })

  it('mainGoal — первая цель очереди, не фонд и не долг', () => {
    const goals = [goal('res', { fund: 'reserve' }), goal('trip'), goal('car')]
    expect(mainGoal(goals, { ids: ['res', 'car', 'trip'], updatedAt: T1 })?.id).toBe('car')
    expect(mainGoal(goals)?.id).toBe('trip')
    expect(mainGoal([goal('res', { fund: 'cushion' })])).toBeNull()
  })
})

describe('fundsOf — фонды семьи', () => {
  it('копилка Блока 11 — «Подушка», пока нет помеченной; помеченная побеждает; двойной фонд — первый по id', () => {
    const settings = { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'pot', updatedAt: T1 }
    expect(fundsOf({ goals: [goal('pot')], moneySettings: settings })).toEqual({ reserve: null, cushion: goal('pot') })
    const marked = goal('c2', { fund: 'cushion' })
    expect(fundsOf({ goals: [goal('pot'), marked], moneySettings: settings }).cushion?.id).toBe('c2')
    const r = fundsOf({ goals: [goal('r2', { fund: 'reserve' }), goal('r1', { fund: 'reserve' }), goal('r0', { fund: 'reserve', deletedAt: T2 })] })
    expect(r.reserve?.id).toBe('r1')
    expect(fundsOf({ goals: [goal('pot', { deletedAt: T2 })], moneySettings: settings }).cushion).toBeNull()
  })
})

describe('wishQueue и moveId', () => {
  it('желания — свой порядок, новые в конец, удалённые выпадают', () => {
    const wishlist = [wish('w1'), wish('w2'), wish('w3', { deletedAt: T2 }), wish('w4')]
    expect(ids(wishQueue({ wishlist, wishOrder: { ids: ['w2', 'w3', 'w1'], updatedAt: T1 } }))).toEqual(['w2', 'w1', 'w4'])
    expect(ids(wishQueue({ wishlist }))).toEqual(['w1', 'w2', 'w4'])
  })

  it('moveId: перенос на место, за краями — к краю, чужой id — как было', () => {
    expect(moveId(['a', 'b', 'c', 'd'], 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
    expect(moveId(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveId(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a'])
    expect(moveId(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b'])
    expect(moveId(['a', 'b'], 'x', 0)).toEqual(['a', 'b'])
  })
})

describe('B2C-87: герой — первая цель очереди, перенос среди целей', () => {
  it('mainGoal: фонд наверху (и неотмеченная копилка potGoalId) — герой следующая цель', () => {
    const goals = [goal('pot'), goal('res', { fund: 'reserve' }), goal('trip'), goal('car')]
    const order = { ids: ['res', 'pot', 'car', 'trip'], updatedAt: T1 }
    const settings = { potGoalId: 'pot' } as Parameters<typeof mainGoal>[2]
    expect(mainGoal(goals, order, settings)?.id).toBe('car')
    // Без настроек копилка — обычная цель: так и было до B2C-87 (герой «Мечт» был бы копилкой).
    expect(mainGoal(goals, order)?.id).toBe('pot')
    expect(mainGoal([goal('res', { fund: 'reserve' })], null)).toBeNull()
  })

  it('moveWithin: цели переставляются среди целей, фонды и карточка долга стоят на месте', () => {
    const ids = ['trip', 'res', DEBT_CARD, 'car', 'pot', 'flat']
    const goals = ['trip', 'car', 'flat']
    expect(moveWithin(ids, goals, 'flat', 0)).toEqual(['flat', 'res', DEBT_CARD, 'trip', 'pot', 'car'])
    expect(moveWithin(ids, goals, 'trip', 2)).toEqual(['car', 'res', DEBT_CARD, 'flat', 'pot', 'trip'])
    expect(moveWithin(ids, goals, 'res', 0)).toEqual(ids)
  })
})

describe('payerOf — кто платит (Р-80)', () => {
  const people: Person[] = [
    { id: 'a', name: 'Ильяс', salary: 1, payday: 10, updatedAt: T1 },
    { id: 'b', name: 'Аруна', salary: 1, payday: 20, updatedAt: T1 },
  ]
  it('свой payer → who обязательства → первый участник', () => {
    expect(payerOf({ payer: 'b', who: 'a' }, people)).toBe('b')
    expect(payerOf({ payer: null, who: 'b' }, people)).toBe('b')
    expect(payerOf({}, people)).toBe('a')
  })
  it('плательщика нет в семье (удалён, слот c) — следующая ветка; участников нет — null', () => {
    expect(payerOf({ payer: 'c', who: 'b' }, people)).toBe('b')
    expect(payerOf({ payer: 'a' }, [{ ...people[0], deletedAt: T2 }, people[1]])).toBe('b')
    expect(payerOf({ payer: 'a' }, [])).toBeNull()
  })
})
