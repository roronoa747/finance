// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Credit } from '@/types/finance'
import { openDebt, prepayBeforeAfter } from './finance'

/** F2-05 (Р-4): «было → стало» всех долгов после досрочки — из состояния после записи. */

const credit = (id: string, principal: number, extra: Partial<Credit> = {}): Credit => ({
  id, name: id, note: '', principal, principalSetAt: T0, annualRate: 0.2, payment: 50_000, day: 10, updatedAt: T0, ...extra,
})

describe('prepayBeforeAfter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  it('один кредит: было = стало + тело взноса, saved — из записи', () => {
    expect(prepayBeforeAfter([credit('a', 800_000)], { principal: 200_000, saved: 54_321 })).toEqual({ before: 1_000_000, after: 800_000, saved: 54_321 })
  })

  it('два кредита — сумма обоих, как крупная цифра «Долгов»', () => {
    const list = [credit('a', 800_000), credit('b', 300_000)]
    const r = prepayBeforeAfter(list, { principal: 200_000, saved: 0 })
    expect(r).toEqual({ before: 1_300_000, after: 1_100_000, saved: 0 })
    expect(r.after).toBe(openDebt(list))
  })

  it('взнос закрыл кредит — он выпал из открытых, «было» всё равно верно; удалённый не считается', () => {
    const list = [credit('a', 0), credit('b', 300_000), credit('gone', 90_000, { deletedAt: T0 })]
    expect(prepayBeforeAfter(list, { principal: 200_000 })).toEqual({ before: 500_000, after: 300_000, saved: 0 })
  })

  it('через стор: «было» = openDebt до нажатия; «снизить платёж» — тот же остаток, что «сократить срок»; деньги целые', () => {
    const run = (mode: 'term' | 'payment') => {
      setActivePinia(createPinia())
      const store = useFinanceStore()
      store.setHouseholdDoc(planFamilyDoc(), 1)
      const before = openDebt(store.credits)
      const rec = store.applyPrepayment('loan', 'a', { amount: 123_457, mode, accountId: 'card' })!
      const r = prepayBeforeAfter(store.credits, rec)
      expect(r.before).toBe(before)
      expect(r.after).toBe(before - 123_457)
      expect(r.saved).toBe(rec.saved)
      for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true)
      return r
    }
    const term = run('term')
    const payment = run('payment')
    expect(payment.after).toBe(term.after)
    expect(payment.before).toBe(term.before)
  })

  it('через стор: взнос больше остатка закрыл «Кредитку» — было/стало по всем долгам', () => {
    setActivePinia(createPinia())
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(), 1)
    const before = openDebt(store.credits)
    const rec = store.applyPrepayment('cc', 'a', { amount: 999_999, mode: 'term', accountId: null })!
    expect(store.credits.find((c) => c.id === 'cc')!.principal).toBe(0)
    expect(prepayBeforeAfter(store.credits, rec)).toMatchObject({ before, after: before - 300_000 })
  })
})
