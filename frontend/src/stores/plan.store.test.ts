// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from './finance'
import { useAuthStore } from './auth'
import { authAs } from '@/test/planFamily'
import { mainGoal, monthPlan } from '@/lib/finance'
import { monthKey } from '@/lib/dates'
import { useFxStore } from './fx'
import { useOperationsStore } from './operations'
import type { Goal, SyncDoc } from '@/types/finance'

/** B2C-85: стор плана месяца — очередь, «Сделать главной», фонды, плательщик, траты, пауза. */

const T0 = '2026-09-01T00:00:00.000Z'
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, name: id, need: 1_000_000, seed: 0, have: 0, monthly: 10_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})

function storeWith(doc: Partial<SyncDoc>) {
  const store = useFinanceStore()
  store.setHouseholdDoc({
    ...defaultSyncDoc(),
    people: [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 20, updatedAt: T0 },
    ],
    ...doc,
  }, 1)
  return store
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T08:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  setActivePinia(createPinia())
  useAuthStore().setAuthData(authAs('member'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('очередь и «Сделать главной»', () => {
  it('makeMain переносит наверх и не пишет main; старый main первым только до первой записи порядка', () => {
    const store = storeWith({ goals: [goal('a'), goal('b', { main: true }), goal('c')] })
    expect(store.queue.map((x) => x.id)).toEqual(['b', 'a', 'c'])
    store.makeMain('c')
    expect(store.householdDoc.goalOrder?.ids).toEqual(['c', 'b', 'a'])
    expect(store.goals.find((g) => g.id === 'c')?.main).toBeUndefined()
    expect(store.goals.find((g) => g.id === 'b')).toEqual(goal('b', { main: true }))
    expect(mainGoal(store.goals, store.goalOrder)?.id).toBe('c')
    // Ещё раз — другая цель наверх.
    store.makeMain('a')
    expect(store.queue.map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('moveInQueue — одна правка документа; повтор на то же место ничего не пишет', () => {
    const store = storeWith({ goals: [goal('a'), goal('b'), goal('c')] })
    store.moveInQueue('a', 2)
    expect(store.goalOrder?.ids).toEqual(['b', 'c', 'a'])
    const stamp = store.goalOrder?.updatedAt
    vi.setSystemTime(new Date('2026-10-04T09:00:00Z'))
    store.moveInQueue('a', 2)
    expect(store.goalOrder?.updatedAt).toBe(stamp)
  })

  it('moveWish — свой порядок желаний', () => {
    const w = (id: string) => ({ id, name: id, price: 1, by: 'a' as const, addedOn: T0, bought: false, updatedAt: T0 })
    const store = storeWith({ wishlist: [w('w1'), w('w2'), w('w3')] })
    store.moveWish('w3', 0)
    expect(store.wishes.map((x) => x.id)).toEqual(['w3', 'w1', 'w2'])
    expect(store.householdDoc.wishOrder?.ids).toEqual(['w3', 'w1', 'w2'])
  })

  it('новая цель встаёт в конец очереди и без main', () => {
    const store = storeWith({ goals: [goal('a')], goalOrder: { ids: ['a'], updatedAt: T0 } })
    const id = store.addGoal({ name: 'Машина', need: 5_000_000, monthly: 100_000, hue: 'blue' })
    expect(store.queue.map((x) => x.id)).toEqual(['a', id])
    expect(store.goals.find((g) => g.id === id)?.main).toBeUndefined()
  })
})

describe('фонды', () => {
  it('ensureFund(cushion): копилка становится «Подушкой» со всем накопленным и взносами; повтор — тот же id, без записи', () => {
    const pot = goal('pot', { name: 'Подушка', seed: 100_000, have: 150_000, movements: [{ id: 'm1', date: '2026-09-10', amount: 50_000, by: 'a' }] })
    const store = storeWith({ goals: [pot], moneySettings: { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'pot', updatedAt: T0 } })
    expect(store.ensureFund('cushion')).toBe('pot')
    const got = store.goals.find((g) => g.id === 'pot')!
    expect(got).toMatchObject({ fund: 'cushion', have: 150_000, seed: 100_000, template: 'cushion' })
    expect(got.movements).toHaveLength(1)
    const stamp = got.updatedAt
    vi.setSystemTime(new Date('2026-10-04T09:00:00Z'))
    expect(store.ensureFund('cushion')).toBe('pot')
    expect(store.goals.find((g) => g.id === 'pot')!.updatedAt).toBe(stamp)
    expect(store.goals).toHaveLength(1)
  })

  it('ensureFund(reserve): новый фонд-цель с картинкой шаблона, в конце очереди; второй вызов — тот же', () => {
    const store = storeWith({ goals: [goal('trip')] })
    const id = store.ensureFund('reserve', 800_000)
    expect(store.goals.find((g) => g.id === id)).toMatchObject({ name: 'Запас', fund: 'reserve', need: 800_000, have: 0, template: 'cushion-3' })
    expect(store.ensureFund('reserve')).toBe(id)
    expect(store.queue.map((x) => [x.id, x.kind])).toEqual([['trip', 'goal'], [id, 'fund']])
    store.setFundMonths(id, 2)
    expect(store.goals.find((g) => g.id === id)?.fundMonths).toBe(2)
  })
})

describe('плательщик, траты, пауза', () => {
  it('setPayer: обязательство, кредит, цель, карточка долга; тот же — не пишется', () => {
    const store = storeWith({
      obligations: [{ id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 200_000 }], updatedAt: T0 }],
      credits: [{ id: 'loan', name: 'Кредит', note: '', principal: 500_000, annualRate: 0.2, payment: 50_000, day: 15, updatedAt: T0 }],
      goals: [goal('trip')],
    })
    store.setPayer('obligation', 'rent', 'b')
    store.setPayer('credit', 'loan', 'b')
    store.setPayer('goal', 'trip', 'b')
    store.setPayer('debt', 'debt', 'b')
    expect(store.obligations[0].payer).toBe('b')
    expect(store.credits[0].payer).toBe('b')
    expect(store.goals[0].payer).toBe('b')
    expect(store.debtCard.payer).toBe('b')
    const stamp = store.obligations[0].updatedAt
    vi.setSystemTime(new Date('2026-10-04T09:00:00Z'))
    store.setPayer('obligation', 'rent', 'b')
    expect(store.obligations[0].updatedAt).toBe(stamp)
  })

  it('setSpendPlan — одна запись на пару участник:раздел, целые тенге', () => {
    const store = storeWith({})
    store.setSpendPlan('a', 'sc_food', 90_000.4)
    store.setSpendPlan('b', 'sc_food', 60_000)
    store.setSpendPlan('a', 'sc_food', 80_000)
    expect(store.spendPlans.map((x) => [x.id, x.amount])).toEqual([['a:sc_food', 80_000], ['b:sc_food', 60_000]])
  })

  it('pauseGoal: цель и карточка долга; снять — null', () => {
    const store = storeWith({ goals: [goal('trip')] })
    store.pauseGoal('trip', true)
    expect(store.goals[0].pausedAt).toBe('2026-10-04T08:00:00.000Z')
    store.pauseGoal('trip', false)
    expect(store.goals[0].pausedAt).toBeNull()
    store.setDebtCard({ monthly: 40_000 })
    store.pauseGoal('debt', true)
    expect(store.debtCard).toMatchObject({ monthly: 40_000, pausedAt: '2026-10-04T08:00:00.000Z' })
  })
})

describe('ревью frontend Б14, Н-4: один вход плана месяца', () => {
  it('planInput — документ с производными кредитами, книгой и загрузками; monthPlanOf = monthPlan(planInput)', () => {
    const store = storeWith({
      goals: [goal('g1', { monthly: 50_000 })],
      credits: [{ id: 'loan', name: 'Кредит', note: '', principal: 500_000, principalSetAt: T0, annualRate: 0.3, payment: 40_000, day: 15, updatedAt: T0 }],
      payments: [{ id: 'p1', kind: 'credit', targetId: 'loan', period: '2026-09', amount: 40_000, principal: 30_000, accountId: null, by: 'a', at: '2026-09-15T05:00:00.000Z', updatedAt: T0 }],
    })
    const { state, ctx } = store.planInput('2026-10')
    expect(state.credits).toEqual(store.credits)
    expect(state.credits?.[0]?.principal).toBeLessThan(500_000)
    expect(state.book).toBe(useFxStore().book)
    expect(ctx).toEqual({ key: '2026-10', totals: [], spendCategories: [], uploads: useOperationsStore().uploads })
    expect(store.monthPlanOf('2026-10')).toEqual(monthPlan(state, ctx))
  })
})

describe('ревью frontend Б15, Н-2: запись плана прошлого месяца — в том месяце', () => {
  const doc = () => ({
    goals: [goal('g1')],
    credits: [{ id: 'loan', name: 'Кредит', note: '', principal: 500_000, principalSetAt: T0, annualRate: 0.3, payment: 40_000, day: 15, updatedAt: T0 }],
  })
  const save = (period: string) => ({
    record: { source: 'salary' as const, sourceId: 'a' as const, period },
    total: 700_000,
    contributions: [{ goalId: 'g1', amount: 10_000 }],
    prepay: { creditId: 'loan', amount: 50_000 },
    parts: [{ target: 'g1', amount: 10_000 }, { target: 'prepay:loan', amount: 50_000 }],
    put: 60_000,
  })
  const moves = (store: ReturnType<typeof useFinanceStore>) => store.householdDoc.goals!.find((g) => g.id === 'g1')!.movements ?? []

  it('сентябрь в октябре: взнос — полдень 30 сентября по Алматы, досрочка — периодом сентября; «Не отложено» — тоже в сентябре', () => {
    const store = storeWith(doc())
    store.putPlan([save('2026-09')], { by: 'a', note: 'по плану' })
    expect(moves(store).map((m) => m.date)).toEqual(['2026-09-30T07:00:00.000Z'])
    expect(store.payments.filter((p) => p.kind === 'prepay').map((p) => p.period)).toEqual(['2026-09'])
    store.unputPlan('g1', '2026-09', 10_000, 'a')
    expect(moves(store).map((m) => [monthKey(new Date(m.date)), m.amount])).toEqual([['2026-09', 10_000], ['2026-09', -10_000]])
  })

  it('текущий месяц — как было: взнос сейчас, досрочка периодом этого месяца', () => {
    const store = storeWith(doc())
    store.putPlan([save('2026-10')], { by: 'a', note: 'по плану' })
    expect(moves(store).map((m) => m.date)).toEqual(['2026-10-04T08:00:00.000Z'])
    expect(store.payments.filter((p) => p.kind === 'prepay').map((p) => p.period)).toEqual(['2026-10'])
  })
})
