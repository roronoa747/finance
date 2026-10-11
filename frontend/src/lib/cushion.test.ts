import { describe, expect, it } from 'vitest'
import { cushionCover, DEFAULT_MONEY_SETTINGS, monthPlan, type MonthPlanCtx, type MonthPlanState, type PlanQueueItem } from './finance'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Goal, MoneySettings, SyncDoc } from '@/types/finance'

/**
 * PN-19 (понятность Р-12): подушка — «нужно» из строки плана месяца, «хватит на N месяцев» одной десятой
 * (правило 6 — числа в комментариях).
 */

const settings: MoneySettings = { ...DEFAULT_MONEY_SETTINGS, updatedAt: T0 }
const cushion = (p: Partial<Goal> = {}): Goal => ({
  id: 'pot', name: 'Подушка', need: 0, seed: 0, have: 0, monthly: 0, hue: 'teal', planPct: 0, movements: [], template: 'cushion', fund: 'cushion', updatedAt: T0, ...p,
})
const row = (need: number): PlanQueueItem => ({
  id: 'pot', kind: 'fund', fund: 'cushion', goalId: 'pot', name: 'Подушка', payer: null, want: 0, given: 0, paused: false, have: 0, need, put: 0, doneMonth: null,
})

describe('cushionCover — «хватит на N месяцев»', () => {
  it('нужно — из строки плана; 360 000 при тратах 300 000 → 1,2 месяца', () => {
    // Порог 3 × 300 000 = 900 000 — строка плана; месяц трат 900 000 / 3 = 300 000; 360 000 / 300 000 = 1,2.
    const c = cushionCover(row(900_000), cushion({ have: 360_000 }), settings)
    expect(c).toEqual({ need: 900_000, have: 360_000, monthSpend: 300_000, monthsNeeded: 3, months: 1.2 })
  })

  it('одна десятая: 350 000 / 300 000 = 1,166… → 1,2, не 1 и не 1,17', () => {
    expect(cushionCover(row(900_000), cushion({ have: 350_000 }), settings).months).toBe(1.2)
  })

  it('свой порог: 2 месяца — делитель 2', () => {
    // 600 000 / 2 = 300 000 в месяц; 150 000 / 300 000 = 0,5.
    const c = cushionCover(row(600_000), cushion({ have: 150_000, fundMonths: 2 }), settings)
    expect(c.monthsNeeded).toBe(2)
    expect(c.monthSpend).toBe(300_000)
    expect(c.months).toBe(0.5)
  })

  it('трат нет или строки плана нет — months null', () => {
    expect(cushionCover(row(0), cushion({ have: 100_000 }), settings).months).toBeNull()
    expect(cushionCover(undefined, cushion({ have: 100_000 }), settings)).toEqual({ need: 0, have: 100_000, monthSpend: 0, monthsNeeded: 3, months: null })
  })

  it('пусто — 0 месяцев, не null', () => {
    expect(cushionCover(row(900_000), cushion(), settings).months).toBe(0)
  })

  it('с планом месяца: need — то же число, что строка «Месяца» (3 × (платежи + траты))', () => {
    const KEY = '2026-09'
    const ctx: MonthPlanCtx = { key: KEY, totals: [], spendCategories: [], uploads: [] }
    const state: MonthPlanState & SyncDoc = { ...planFamilyDoc(), goals: [cushion({ have: 323_000 })], goalOrder: null }
    const plan = monthPlan(state, ctx)
    const item = plan.queue.find((q) => q.goalId === 'pot')
    expect(item?.kind).toBe('fund')
    const c = cushionCover(item, state.goals[0], settings)
    expect(c.need).toBe(item!.need)
    expect(c.need).toBe(3 * (plan.duesTotal + plan.spendTotal))
    expect(c.monthSpend).toBe(plan.duesTotal + plan.spendTotal)
  })
})
