import { describe, expect, it } from 'vitest'
import {
  STEP_MIN, cushionCover, dreamShift, monthPlan, moneySettingsOf, prepayOutcome, returnTermShift, spendCompare, shiftMade, stepCandidates, termSnapOf,
  type MonthPlanCtx, type UploadPeriod,
} from './finance'
import type { SpendTotal } from './statements/types'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { PersonId, PlanShift, SpendPlan, SyncDoc, TermSnap } from '@/types/finance'

/**
 * AU-05: сдвиг месяца `planShifts` в `monthPlan` и кандидаты «Сделать» против ручного расчёта (правило 6).
 *
 * Семья `planFamilyDoc`, октябрь: доход 1 200 000, платежи 323 000. Планы трат: Ильяс — продукты 400 000, кафе 47 000;
 * Аруна — продукты 250 000 → 697 000. Свободно 180 000: подушка 30 000, отпуск 40 000, машина 60 000 → остаток 50 000.
 * Машина: нужно 3 000 000, есть 200 000 → осталось 2 800 000 при 60 000 в месяц: 47 взносов (47 × 60 000 = 2 820 000) —
 * собрана в месяце прогона 46 → 2030-08.
 */

const KEY = '2026-10'
const plan = (by: PersonId, categoryId: string, amount: number): SpendPlan => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
const total = (by: PersonId, period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops: 1, updatedAt: T0,
})
const PLANS = [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 250_000)]
const shift = (extra: Partial<PlanShift>): PlanShift => ({
  id: 's1', period: KEY, by: 'a', from: 'rest', to: { goalId: 'car' }, amount: 20_000, at: T0, updatedAt: T0, ...extra,
})
const family = (extra: Partial<SyncDoc> = {}) => planFamilyDoc({ spendPlans: PLANS, ...extra })
const ctxOf = (extra: Partial<MonthPlanCtx> = {}): MonthPlanCtx => ({ key: KEY, totals: [], spendCategories: [], uploads: [], ...extra })
const given = (doc: SyncDoc, id: string, ctx = ctxOf()) => monthPlan(doc, ctx).queue.find((q) => (q.goalId ?? q.kind) === id)!

describe('monthPlan — сдвиги месяца (planShifts)', () => {
  const base = monthPlan(family(), ctxOf())

  it('без сдвигов — исходные числа', () => {
    expect(base.free).toBe(180_000)
    expect(base.rest).toBe(50_000)
    expect(given(family(), 'car').doneMonth).toBe('2030-08')
  })
  it('из раздела: план строки −N, мечта +N, остаток прежний', () => {
    const p = monthPlan(family({ planShifts: [shift({ from: { spend: 'a', categoryId: 'sc_cafe' } })] }), ctxOf())
    expect(p.spend.find((s) => s.by === 'a')!.rows.find((r) => r.categoryId === 'sc_cafe')!.plan).toBe(27_000)
    expect(p.spendTotal).toBe(677_000)
    expect(p.queue.find((q) => q.goalId === 'car')!.given).toBe(80_000)
    expect(p.rest).toBe(50_000)
    expect(p.duesTotal + p.spendTotal + p.queueTotal + p.rest - p.short).toBe(p.income.total)
  })
  it('из остатка: мечта +N, остаток −N', () => {
    const p = monthPlan(family({ planShifts: [shift({})] }), ctxOf())
    expect(p.queue.find((q) => q.goalId === 'car')!.given).toBe(80_000)
    expect(p.rest).toBe(30_000)
    expect(p.spendTotal).toBe(697_000)
  })
  it('в долг: карточка долга +N', () => {
    const before = given(family(), 'debt').given
    const p = monthPlan(family({ planShifts: [shift({ to: 'debt' })] }), ctxOf())
    expect(p.queue.find((q) => q.kind === 'debt')!.given).toBe(before + 20_000)
    expect(p.rest).toBe(30_000)
  })
  it('«Траты» на «Месяце» — тот же план: строка раздела `spendCompare` урезана сдвигом, как строка участника (критик)', () => {
    const doc = family({ planShifts: [shift({ from: { spend: 'a', categoryId: 'sc_food' } })] })
    const rows = spendCompare(doc, ctxOf()).rows
    expect(rows.find((r) => r.categoryId === 'sc_food')!.plan).toBe(630_000) // 400 000 − 20 000 + 250 000
    expect(rows.reduce((s, r) => s + (r.plan ?? 0), 0)).toBe(monthPlan(doc, ctxOf()).spendTotal)
  })
  it('сдвиг чужого месяца, надгробие, раздел без строки плана — не применяются', () => {
    for (const s of [
      shift({ period: '2026-09' }),
      shift({ deletedAt: T0 }),
      shift({ from: { spend: 'b', categoryId: 'sc_cafe' } }), // у Аруны нет плана кафе — весь сдвиг мимо
    ]) {
      expect(monthPlan(family({ planShifts: [s] }), ctxOf())).toEqual(base)
    }
  })
  it('строка не ниже 0; мечта — не больше остатка до суммы', () => {
    const p = monthPlan(family({ planShifts: [shift({ from: { spend: 'a', categoryId: 'sc_cafe' }, amount: 60_000 })] }), ctxOf())
    expect(p.spend.find((s) => s.by === 'a')!.rows.find((r) => r.categoryId === 'sc_cafe')!.plan).toBe(0)
    const almost = family().goals.map((g) => (g.id === 'car' ? { ...g, have: 2_950_000, seed: 2_950_000 } : g))
    // Машине осталось 50 000: взнос 50 000, сдвиг 20 000 сверху не помещается.
    expect(monthPlan(family({ goals: almost, planShifts: [shift({})] }), ctxOf()).queue.find((q) => q.goalId === 'car')!.given).toBe(50_000)
  })
  it('doneMonth: добавка только в первом месяце прогона', () => {
    // Сдвиг 60 000 из продуктов: 120 000 в октябре + 60 000 дальше → 120 000 + 45 × 60 000 = 2 820 000 → месяц 45 → 2030-07.
    // Повторись добавка каждый месяц — 120 000 × 24 = 2 880 000 → месяц 23 (2028-09).
    const p = monthPlan(family({ planShifts: [shift({ from: { spend: 'a', categoryId: 'sc_food' }, amount: 60_000 })] }), ctxOf())
    const car = p.queue.find((q) => q.goalId === 'car')!
    expect(car.given).toBe(120_000)
    expect(car.doneMonth).toBe('2030-07')
    // Маленькая добавка: 80 000 + 46 × 60 000 = 2 840 000 → тот же месяц 46 — не позже прежнего.
    expect(given(family({ planShifts: [shift({})] }), 'car').doneMonth).toBe('2030-08')
  })
})

/**
 * Кандидаты: история Ильяса — август и сентябрь целиком (выписка с 1 августа по 15 октября), продукты по 300 000 →
 * обычно 300 000; октябрь — продукты 320 000. План продуктов семьи 650 000 → запас 650 000 − 320 000 = 330 000; у
 * Ильяса план больше (400 000) — источник он. Кафе: обычно 47 000 = плану — запаса нет.
 */
describe('stepCandidates', () => {
  const UPLOADS: UploadPeriod[] = [{ slot: 'a', period_from: '2026-08-01', period_to: '2026-10-15' }]
  const totalsWith = (octFood: number) => [
    total('a', '2026-08', 'sc_food', 300_000), total('a', '2026-09', 'sc_food', 300_000),
    total('a', '2026-08', 'sc_cafe', 47_000), total('a', '2026-09', 'sc_cafe', 47_000),
    total('a', KEY, 'sc_food', octFood),
  ]
  const cctx = (octFood = 320_000) => ctxOf({ totals: totalsWith(octFood), uploads: UPLOADS })

  it('три вида на семье: перенос, досрочка, подушка', () => {
    const doc = family({ goals: family().goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const } : g)) })
    const list = stepCandidates(doc, cctx())
    expect(list.map((c) => c.kind)).toEqual(['move', 'prepay', 'cushion'])
    // Первая мечта — отпуск (подушка теперь фонд): 330 000 при 40 000 в месяц → 330 / 40 × 30,4 = 250,8 → 251 день.
    expect(list[0]).toEqual({
      id: 'move:sc_food', kind: 'move',
      shift: { period: KEY, from: { spend: 'a', categoryId: 'sc_food' }, to: { goalId: 'trip' }, amount: 330_000 },
      effect: { days: 251 },
    })
    const p = monthPlan(doc, cctx())
    const cc = doc.credits.find((c) => c.id === p.queue.find((q) => q.kind === 'debt')!.creditId)!
    const o = prepayOutcome(cc, roundDown(p.rest), 'once')!
    expect(list[1]).toEqual({ id: 'prepay', kind: 'prepay', shift: { period: KEY, from: 'rest', to: 'debt', amount: roundDown(p.rest) }, effect: { months: o.monthsSaved, saved: o.saved } })
    const item = p.queue.find((q) => q.goalId === 'cushion')!
    const amount = roundDown(Math.min(p.rest, item.need - item.have - item.given))
    const cushion = doc.goals.find((g) => g.id === 'cushion')!
    expect(list[2]).toEqual({
      id: 'cushion', kind: 'cushion', shift: { period: KEY, from: 'rest', to: { goalId: 'cushion' }, amount },
      effect: { months: cushionCover(item, { ...cushion, have: cushion.have + amount }, moneySettingsOf(doc)).months },
    })
  })
  it('сумма вниз до 1 000, не меньше 5 000', () => {
    const move = (octFood: number) => stepCandidates(family(), cctx(octFood)).find((c) => c.kind === 'move')
    expect(move(637_655)!.shift.amount).toBe(12_000) // запас 12 345
    expect(move(645_000)!.shift.amount).toBe(STEP_MIN) // запас ровно 5 000
    expect(move(646_000)).toBeUndefined() // запас 4 000
  })
  it('без мечты — нет переноса; без долга — нет досрочки; подушка собрана или не заведена — нет подушки', () => {
    const paused = family().goals.map((g) => ({ ...g, pausedAt: T0 }))
    expect(stepCandidates(family({ goals: paused }), cctx()).some((c) => c.kind === 'move')).toBe(false)
    expect(stepCandidates(family({ credits: [] }), cctx()).some((c) => c.kind === 'prepay')).toBe(false)
    expect(stepCandidates(family(), cctx()).some((c) => c.kind === 'cushion')).toBe(false)
    const full = family().goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const, have: 9_000_000, seed: 9_000_000 } : g))
    expect(stepCandidates(family({ goals: full }), cctx()).some((c) => c.kind === 'cushion')).toBe(false)
  })
  it('карточка долга или подушка на паузе — кандидата нет (сдвиг в паузу остался бы в остатке; критик)', () => {
    const fund = family().goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const } : g))
    expect(stepCandidates(family({ goals: fund }), cctx()).map((c) => c.kind)).toEqual(['move', 'prepay', 'cushion'])
    const goals = fund.map((g) => (g.id === 'cushion' ? { ...g, pausedAt: T0 } : g))
    const doc = family({ goals, debtCard: { monthly: 0, pausedAt: T0, payer: null, updatedAt: T0 } })
    expect(stepCandidates(doc, cctx()).map((c) => c.kind)).toEqual(['move'])
  })
  it('перенос — не больше, чем мечта примет в этом месяце (критик)', () => {
    // Отпуску осталось 3 000 000 − 2 900 000 = 100 000, план даёт 40 000 → примет ещё 60 000 (запас продуктов — 330 000).
    const goals = family().goals.map((g) =>
      g.id === 'trip' ? { ...g, have: 2_900_000, seed: 2_900_000 } : g.id === 'cushion' ? { ...g, fund: 'cushion' as const } : g,
    )
    const move = stepCandidates(family({ goals }), cctx()).find((c) => c.kind === 'move')!
    expect(move.shift).toMatchObject({ to: { goalId: 'trip' }, amount: 60_000 })
  })
  it('выписок за месяцы «обычно» нет — переноса нет', () => {
    expect(stepCandidates(family(), ctxOf()).some((c) => c.kind === 'move')).toBe(false)
  })
})

/**
 * «Вернуть срок»: семья AU-04 (Аруна — продукты 300 000, свободно ровно 130 000), кафе Ильяса выше плана на 30 000 →
 * машине 30 000 вместо 60 000 снимка (+15 дней). История продуктов у Ильяса: август и сентябрь по 400 000 → обычно
 * 400 000, октябрь 400 000 → запас плана продуктов 700 000 − 400 000 = 300 000. Остаток месяца по факту — 0. Ильяс
 * перерасходовал (его траты по факту 477 000 > плана), урезать его план срок не вернёт — источник Аруна.
 */
describe('returnTermShift', () => {
  const tight = (extra: Partial<SyncDoc> = {}) => planFamilyDoc({ spendPlans: [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 300_000)], ...extra })
  const UPLOADS: UploadPeriod[] = [{ slot: 'a', period_from: '2026-08-01', period_to: '2026-10-15' }]
  const history = [total('a', '2026-08', 'sc_food', 400_000), total('a', '2026-09', 'sc_food', 400_000)]
  const now = [total('a', KEY, 'sc_food', 400_000), total('a', KEY, 'sc_cafe', 77_000)]
  const snapOf = (doc: SyncDoc): TermSnap => ({ ...termSnapOf(monthPlan(doc, ctxOf()), '2026-10-01T03:00:00.000Z'), updatedAt: T0 })

  it('недобор 30 000 — из плана продуктов Аруны; после сдвига мечта не дальше снимка', () => {
    const doc = tight()
    const ctx = ctxOf({ totals: [...history, ...now], uploads: UPLOADS })
    const snap = snapOf(doc)
    expect(dreamShift(doc, ctx, snap, 'car')).toMatchObject({ days: 15 })
    const c = returnTermShift(doc, ctx, snap, 'car')!
    expect(c).toEqual({
      id: 'return:car', kind: 'move',
      shift: { period: KEY, from: { spend: 'b', categoryId: 'sc_food' }, to: { goalId: 'car' }, amount: 30_000 },
      effect: { days: 15 },
    })
    const applied = tight({ planShifts: [{ ...c.shift, id: 'x', by: 'a', at: T0, updatedAt: T0 }] })
    expect(dreamShift(applied, ctx, snap, 'car')).toBeNull()
    expect(monthPlan(applied, { ...ctx, byFact: true }).queue.find((q) => q.goalId === 'car')!.given).toBe(60_000)
  })
  it('денег нет (запаса плана нет) — null; мечта не сдвинулась — null', () => {
    const doc = tight()
    const snap = snapOf(doc)
    expect(returnTermShift(doc, ctxOf({ totals: now, uploads: UPLOADS }), snap, 'car')).toBeNull()
    expect(returnTermShift(doc, ctxOf(), snap, 'car')).toBeNull()
  })
})

const roundDown = (n: number) => Math.floor(n / 1_000) * 1_000

// Ревью frontend Блока 3, Н-2: «✓ Сделано» у шага разбора — по цели и источнику, а не по одной цели.
describe('shiftMade', () => {
  const move = { period: KEY, from: { spend: 'a' as const, categoryId: 'sc_cafe' }, to: { goalId: 'car' }, amount: 20_000 }
  it('«Вернуть срок» из остатка в ту же мечту — шаг «из раздела» не сделан', () => {
    expect(shiftMade([shift({ from: 'rest' })], move)).toBe(false)
  })
  it('свой сдвиг из того же раздела в ту же мечту — сделан; другой участник, раздел, месяц или надгробие — нет', () => {
    expect(shiftMade([shift({ from: move.from, amount: 5_000 })], move)).toBe(true)
    expect(shiftMade([shift({ from: { spend: 'b', categoryId: 'sc_cafe' } })], move)).toBe(false)
    expect(shiftMade([shift({ from: { spend: 'a', categoryId: 'sc_food' } })], move)).toBe(false)
    expect(shiftMade([shift({ from: move.from, period: '2026-09' })], move)).toBe(false)
    expect(shiftMade([shift({ from: move.from, deletedAt: T0 })], move)).toBe(false)
  })
  it('остаток в подушку и долг — по своей цели', () => {
    const cushion = { period: KEY, from: 'rest' as const, to: { goalId: 'fund' }, amount: 10_000 }
    expect(shiftMade([shift({ to: { goalId: 'fund' } })], cushion)).toBe(true)
    expect(shiftMade([shift({})], cushion)).toBe(false)
    expect(shiftMade([shift({ to: 'debt' })], { ...cushion, to: 'debt' })).toBe(true)
  })
})
