import { describe, expect, it } from 'vitest'
import { dreamShift, monthPlan, shiftLabel, termSnapOf, type MonthPlanCtx, type UploadPeriod } from './finance'
import type { SpendTotal } from './statements/types'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { PersonId, SpendPlan, SyncDoc, TermSnap } from '@/types/finance'

/**
 * AU-04: снимок срока и «мечта сдвинулась» против ручного расчёта (правило 6 — числа в комментариях).
 *
 * Семья `planFamilyDoc`, октябрь: доход 700 000 + 500 000 = 1 200 000; платежи — аренда 220 000 + кредит 58 000 +
 * кредитка 25 000 + рассрочка 20 000 = 323 000. Планы трат: Ильяс — продукты 400 000 и кафе 47 000, Аруна — продукты
 * 300 000 → 747 000. Свободно 1 200 000 − 323 000 − 747 000 = 130 000 — ровно взносы очереди: подушка 30 000, отпуск
 * 40 000, машина 60 000 (последняя). Снимок начала месяца — по плану: машина получает 60 000.
 * Выписка Ильяса за октябрь: продукты 400 000, кафе 77 000 → траты по факту 477 000 > плана 447 000 на 30 000 →
 * свободно 100 000 → машина получает 30 000: недобор 30 000 при темпе 60 000 → 30 000 / 60 000 × 30,4 = 15,2 → 15 дней.
 */

const KEY = '2026-10'
const plan = (by: PersonId, categoryId: string, amount: number): SpendPlan => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
const total = (by: PersonId, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:month:${KEY}:${categoryId}`, by, kind: 'month', period: KEY, categoryId, amount, ops: 1, updatedAt: T0,
})
const PLANS = [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 300_000)]
const UPLOADS: UploadPeriod[] = [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-15' }]

const family = (extra: Partial<SyncDoc> = {}) => planFamilyDoc({ spendPlans: PLANS, ...extra })
const ctxOf = (extra: Partial<MonthPlanCtx> = {}): MonthPlanCtx => ({ key: KEY, totals: [], spendCategories: [], uploads: [], ...extra })
const factCtx = (cafe: number) => ctxOf({ totals: [total('a', 'sc_food', 400_000), total('a', 'sc_cafe', cafe)], uploads: UPLOADS })
/** Снимок начала месяца — план без выписок. */
const snapOf = (doc: SyncDoc): TermSnap => ({ ...termSnapOf(monthPlan(doc, ctxOf()), '2026-10-01T03:00:00.000Z'), updatedAt: T0 })

describe('termSnapOf — снимок плана месяца', () => {
  it('доход, платежи, цели очереди с given и doneMonth', () => {
    const doc = family()
    const p = monthPlan(doc, ctxOf())
    expect(p.free).toBe(130_000)
    const snap = termSnapOf(p, 'at')
    expect(snap).toMatchObject({ id: KEY, at: 'at', income: 1_200_000 })
    expect(snap.dueIds.sort()).toEqual(['cc', 'inst', 'loan', 'rent'])
    expect(snap.goals.map((g) => [g.goalId, g.given])).toEqual([['cushion', 30_000], ['trip', 40_000], ['car', 60_000]])
    expect(snap.goals.every((g) => g.doneMonth !== null)).toBe(true)
  })
})

describe('monthPlan — byFact', () => {
  it('без флага и с false — прежние числа; с флагом — траты max(план, факт), порог фонда от плана', () => {
    const doc = family()
    const base = monthPlan(doc, factCtx(77_000))
    expect(monthPlan(doc, { ...factCtx(77_000), byFact: false })).toEqual(base)
    expect(base.spendTotal).toBe(747_000)
    const fact = monthPlan(doc, { ...factCtx(77_000), byFact: true })
    // Ильяс 477 000 по факту, Аруна без выписки — план 300 000.
    expect(fact.spendTotal).toBe(777_000)
    expect(fact.free).toBe(100_000)
    expect(fact.queue.filter((q) => q.kind !== 'debt').map((q) => q.given)).toEqual([30_000, 40_000, 30_000])
    // Доход = платежи + траты + очередь + остаток − нехватка.
    expect(fact.duesTotal + fact.spendTotal + fact.queueTotal + fact.rest - fact.short).toBe(fact.income.total)
  })
  it('факт меньше плана — план (метка не обещает «ближе» от недотраты)', () => {
    const fact = monthPlan(family(), { ...factCtx(10_000), byFact: true })
    expect(fact.spendTotal).toBe(747_000)
  })
})

describe('dreamShift — сдвиг мечты к снимку', () => {
  it('кафе выше плана на 30 000 при взносе 60 000 → +15 дней, причина — раздел', () => {
    const doc = family()
    const shift = dreamShift(doc, factCtx(77_000), snapOf(doc), 'car')
    expect(shift).toEqual({ days: 15, reason: 'spend', name: 'Кафе и рестораны' })
    expect(shiftLabel(shift!)).toBe('+2 недели · кафе и рестораны выше плана')
    // Отпуск и подушка выше в очереди — их не задело.
    expect(dreamShift(doc, factCtx(77_000), snapOf(doc), 'trip')).toBeNull()
  })
  it('новый платёж после снимка → «due» с именем', () => {
    const doc = family()
    const snap = snapOf(doc)
    // Спортзал 25 000: свободно 105 000 → машина 35 000, недобор 25 000 → 25 000 / 60 000 × 30,4 = 12,7 → 13 дней.
    const gym = { id: 'gym', name: 'Спортзал', note: '', day: 12, category: 'd4' as const, versions: [{ from: '2000-01', amount: 25_000 }], updatedAt: T0 }
    const shift = dreamShift(family({ obligations: [...doc.obligations, gym] }), ctxOf(), snap, 'car')
    expect(shift).toEqual({ days: 13, reason: 'due', name: 'Спортзал' })
    expect(shiftLabel(shift!)).toBe('+2 недели · новый платёж «Спортзал»')
  })
  it('отложили сверх плана → ближе, причина «put»', () => {
    const doc = family()
    const snap = snapOf(doc)
    // В машину отложили 120 000 при плане 60 000: ближе на 60 000 / 60 000 × 30,4 = 30 дней.
    const goals = doc.goals.map((g) => (g.id === 'car' ? { ...g, movements: [{ id: 'm1', date: '2026-10-11', amount: 120_000, by: 'a' as const }] } : g))
    const shift = dreamShift(family({ goals }), ctxOf(), snap, 'car')
    expect(shift).toEqual({ days: -30, reason: 'put' })
    expect(shiftLabel(shift!)).toBe('на 4 недели ближе · отложили больше')
  })
  it('сдвиг меньше недели → null', () => {
    const doc = family()
    // Кафе выше плана на 13 000: 13 000 / 60 000 × 30,4 = 6,6 → 7 — уже метка; на 12 000 → 6,08 → 6 — нет.
    expect(dreamShift(doc, factCtx(59_000), snapOf(doc), 'car')).toBeNull()
    expect(dreamShift(doc, factCtx(60_000), snapOf(doc), 'car')).toMatchObject({ days: 7 })
  })
  it('нет снимка, снимок другого месяца, цели нет в снимке, цель на паузе — null', () => {
    const doc = family()
    const snap = snapOf(doc)
    expect(dreamShift(doc, factCtx(77_000), null, 'car')).toBeNull()
    expect(dreamShift(doc, factCtx(77_000), { ...snap, id: '2026-09' }, 'car')).toBeNull()
    expect(dreamShift(doc, factCtx(77_000), { ...snap, goals: snap.goals.filter((g) => g.goalId !== 'car') }, 'car')).toBeNull()
    const paused = doc.goals.map((g) => (g.id === 'car' ? { ...g, pausedAt: T0 } : g))
    expect(dreamShift(family({ goals: paused }), factCtx(77_000), snap, 'car')).toBeNull()
  })
  it('доход меньше снимка → «less»; месяцы — от 9 недель', () => {
    const doc = family()
    const snap = { ...snapOf(doc), income: 1_300_000 }
    // Снимок обещал машине 60 000 + доход выше; сейчас машине 30 000 из-за кафе (30 000) — а падение дохода 100 000 крупнее.
    expect(dreamShift(doc, factCtx(77_000), snap, 'car')).toEqual({ days: 15, reason: 'less' })
    expect(shiftLabel({ days: 70, reason: 'less' })).toBe('+2 месяца · в мечту меньше')
    expect(shiftLabel({ days: 8, reason: 'spend', name: 'Кафе' })).toBe('+1 неделя · кафе выше плана')
  })
})
