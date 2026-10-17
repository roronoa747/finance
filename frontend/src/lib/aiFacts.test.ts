import { describe, expect, it } from 'vitest'
import { buildReviewFacts, factsLines, REVIEW_FACTS_MAX } from './aiFacts'
import {
  debtsOverview,
  derivedCredits,
  dreamShift,
  firstDebt,
  goalTerm,
  habitImages,
  imageLine,
  interestImage,
  monthPlan,
  shiftSpan,
  spendCompare,
  stepCandidates,
  stepEffectText,
  termSnapOf,
  type MonthPlanCtx,
  type UploadPeriod,
} from './finance'
import { monthBy } from './dates'
import { money } from './money'
import type { HabitId, HabitTotal, SpendTotal } from './statements/types'
import { defaultSyncDoc } from '@/stores/finance'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { PersonId, ReviewFact, SpendPlan, SyncDoc } from '@/types/finance'

/**
 * AU-11: факты и кандидаты разбора v2 против прямых вызовов `finance.ts` (правило 6: своих чисел у фактов нет).
 *
 * Семья `planFamilyDoc` (Ильяс 700 000 + Аруна 500 000), октябрь 2026; планы трат: Ильяс — продукты 400 000 и кафе
 * 47 000, Аруна — продукты 300 000. Выписки Ильяса покрывают июль–сентябрь целиком и октябрь до 15-го: кафе 90 000 в
 * каждом закрытом месяце («обычно» 90 000 > плана) и 77 000 в октябре (выше плана на 30 000 — «мечта сдвинулась»);
 * такси — 95 000 в каждом из трёх закрытых месяцев (образ). Снимок начала октября — план без выписок.
 */

const KEY = '2026-10'
const plan = (by: PersonId, categoryId: string, amount: number): SpendPlan => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
const total = (period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `a:month:${period}:${categoryId}`, by: 'a', kind: 'month', period, categoryId, amount, ops: 4, updatedAt: T0,
})
const ht = (period: string, habit: HabitId, count: number, amount: number): HabitTotal => ({
  id: `a:${period}:${habit}`, by: 'a', period, habit, count, amount, updatedAt: T0,
})
const CLOSED = ['2026-07', '2026-08', '2026-09']
const UPLOADS: UploadPeriod[] = [{ slot: 'a', period_from: '2026-07-01', period_to: '2026-10-15' }]

function family(extra: Partial<SyncDoc> = {}): SyncDoc {
  const base = planFamilyDoc({
    spendPlans: [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 300_000)],
    spendTotals: [
      ...CLOSED.flatMap((m) => [total(m, 'sc_food', 380_000), total(m, 'sc_cafe', 90_000), total(m, 'sc_taxi', 95_000)]),
      total(KEY, 'sc_food', 400_000),
      total(KEY, 'sc_cafe', 77_000),
    ],
    habitTotals: CLOSED.map((m) => ht(m, 'taxi', 30, 95_000)),
    ...extra,
  })
  const snapCtx: MonthPlanCtx = { key: KEY, totals: [], spendCategories: [], uploads: [] }
  const snap = { ...termSnapOf(monthPlan({ ...base, credits: derivedCredits(base.credits, base.payments ?? []) }, snapCtx), '2026-10-01T03:00:00.000Z'), updatedAt: T0 }
  return { ...base, termSnaps: [snap], ...extra }
}

const stateOf = (doc: SyncDoc) => ({ ...doc, credits: derivedCredits(doc.credits ?? [], doc.payments ?? []), book: null })
const ctxOf = (doc: SyncDoc): MonthPlanCtx => ({ key: KEY, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: UPLOADS })
const build = (doc: SyncDoc, reason: 'month' | 'salary' | 'refresh' = 'refresh') => buildReviewFacts(doc, KEY, { uploads: UPLOADS, reason })
const find = (facts: ReviewFact[], about: string | RegExp) =>
  facts.find((f) => (typeof about === 'string' ? f.about === about : about.test(f.about)))

describe('buildReviewFacts — факты разбора v2 (AU-11)', () => {
  it('доход, платежи, остаток — числа `monthPlan`, value — `money(raw)`', () => {
    const doc = family()
    const p = monthPlan(stateOf(doc), ctxOf(doc))
    const { facts } = build(doc).payload
    expect(find(facts, 'доход месяца')).toMatchObject({ value: money(1_200_000), raw: p.income.total })
    expect(find(facts, 'платежи месяца')).toMatchObject({ value: money(p.duesTotal), raw: 323_000 })
    expect(find(facts, 'остаётся в месяце после платежей, трат и целей')).toMatchObject({ raw: p.rest, value: money(p.rest) })
    // Доход тот же, что в сентябре, платежей новых нет — фактов разницы нет.
    expect(find(facts, /доход (больше|меньше)/)).toBeUndefined()
    expect(find(facts, /новый платёж/)).toBeUndefined()
  })

  it('доход меньше прошлого и новый платёж — к сентябрю (`monthChanges`)', () => {
    const base = family()
    // С октября оклад Аруны 400 000 вместо 500 000 (версии оклада); спортзал с октября — 25 000.
    const people = base.people.map((p) =>
      p.id === 'b' ? { ...p, salary: 400_000, salaryVersions: [{ from: '2000-01', amount: 500_000 }, { from: KEY, amount: 400_000 }] } : p,
    )
    const gym = { id: 'gym', name: 'Спортзал', note: '', day: 12, category: 'd4' as const, versions: [{ from: KEY, amount: 25_000 }], updatedAt: T0 }
    const doc = family({ obligations: [...base.obligations, gym], people })
    const now = monthPlan(stateOf(doc), ctxOf(doc)).income.total
    const prev = monthPlan(stateOf(doc), { ...ctxOf(doc), key: '2026-09' }).income.total
    expect([prev, now]).toEqual([1_200_000, 1_100_000])
    const { facts } = build(doc).payload
    expect(find(facts, 'доход меньше прошлого месяца на')).toMatchObject({ value: money(100_000), raw: 100_000 })
    expect(find(facts, /доход больше/)).toBeUndefined()
    expect(find(facts, 'новый платёж «Спортзал»')).toMatchObject({ value: money(25_000), raw: 25_000 })
  })

  it('мечты очереди (до 3): срок месяцем, сдвиг с причиной, сколько осталось — `goalTerm` и `dreamShift`', () => {
    const doc = family()
    const state = stateOf(doc)
    const ctx = ctxOf(doc)
    const p = monthPlan(state, ctx)
    const { facts } = build(doc).payload
    const car = p.queue.find((q) => q.goalId === 'car')!
    const term = goalTerm(car, doc.goals.find((g) => g.id === 'car')!, KEY)
    const carTerm = find(facts, /^мечта «Машина» — срок$/)!
    expect(carTerm.raw).toBe(term.doneMonth)
    expect(carTerm.value).toBe(monthBy(term.doneMonth!, KEY))
    expect(find(facts, 'осталось собрать на мечту «Машина»')).toMatchObject({ raw: term.remaining, value: money(term.remaining) })
    // Первая мечта очереди — «главная».
    const first = p.queue.find((q) => q.kind === 'goal')!
    expect(find(facts, new RegExp(`^главная мечта «${doc.goals.find((g) => g.id === first.goalId)!.name}» — срок$`))).toBeDefined()
    // Кафе выше плана на 30 000 → машина +15 дней (как в `dreamShift.test.ts`).
    const shift = dreamShift(state, ctx, doc.termSnaps![0], 'car')!
    expect(shift.days).toBe(15)
    expect(find(facts, /^срок мечты «Машина» за месяц отодвинулся \(кафе и рестораны выше плана\) на$/)).toMatchObject({ raw: 15, value: shiftSpan(15) })
  })

  it('долги: «без долгов» — `debtsOverview().freeMonth`, первый долг — `firstDebt` со ставкой', () => {
    const doc = family()
    const state = stateOf(doc)
    const { facts } = build(doc).payload
    const free = debtsOverview({ ...state, plans: doc.plans }, KEY).freeMonth!
    expect(find(facts, 'без долгов — срок')).toMatchObject({ raw: free, value: monthBy(free, KEY) })
    const first = firstDebt(state)!
    expect(find(facts, `первым закрываем «${first.name}» — самая высокая ставка`)).toMatchObject({ raw: 40, value: '40 %' })
  })

  it('подушка — `cushionCover`: на сколько месяцев хватит', () => {
    const doc = family({
      goals: [...planFamilyDoc().goals, { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 600_000, have: 600_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }],
    })
    const f = find(build(doc).payload.facts, 'подушки хватит на')
    expect(f).toBeDefined()
    expect(typeof f!.raw).toBe('number')
    expect(f!.value).toMatch(/месяц/)
  })

  it('главный раздел трат: факт, обычно, план, доля дохода — строка `spendCompare`', () => {
    const doc = family()
    const row = spendCompare(stateOf(doc), ctxOf(doc)).rows.find((r) => r.categoryId === 'sc_cafe')!
    const { facts } = build(doc).payload
    const cat = `«${row.name}»`
    expect(find(facts, `траты на ${cat} в этом месяце`)).toMatchObject({ raw: 77_000, value: money(77_000) })
    expect(find(facts, `обычно у вас на ${cat} в месяц`)).toMatchObject({ raw: row.usual, value: money(90_000) })
    expect(find(facts, `план на ${cat} в месяц`)).toMatchObject({ raw: 47_000 })
    expect(find(facts, `${cat} — доля дохода`)).toMatchObject({ raw: row.share, value: `${row.share} %` })
  })

  it('главный образ — крупнейший из привычки и процентов: такси 95 000 > процентов в месяц', () => {
    const doc = family()
    const state = stateOf(doc)
    const habit = habitImages(state, KEY)[0]!
    const interest = interestImage(state)!
    expect(habit.monthly).toBeGreaterThan(interest.perMonth)
    const { facts } = build(doc).payload
    expect(find(facts, /^привычка «.+» — в месяц$/)).toMatchObject({ raw: 95_000, value: money(95_000) })
    expect(find(facts, /^во что складывается привычка/)).toMatchObject({ value: imageLine(habit), raw: [habit.months] })
    expect(find(facts, /проценты банку/)).toBeUndefined()
  })

  it('без привычек — проценты банку образом (`interestImage`)', () => {
    const doc = family({ habitTotals: [] })
    const img = interestImage(stateOf(doc))!
    const { facts } = build(doc).payload
    expect(find(facts, 'проценты банку в месяц')).toMatchObject({ raw: img.perMonth })
    expect(find(facts, 'во что складываются проценты банку за год')).toMatchObject({ value: imageLine(img), raw: [img.yearly] })
  })

  it('перенос образа уже сделан — «уже переносим …», а не строка образа', () => {
    const doc = family({
      habitTotals: CLOSED.map((m) => ht(m, 'delivery', 10, 40_000)),
      imageMoves: [{ id: 'mv', categoryId: 'sc_delivery', goalId: 'cushion', amount: 20_000, by: 'a', at: T0, updatedAt: T0 }],
    })
    const img = habitImages(stateOf(doc), KEY)[0]
    const { facts } = build(doc).payload
    if (img?.moved) {
      expect(find(facts, /^уже переносим из/)).toMatchObject({ raw: img.moved })
      expect(find(facts, /^во что складывается/)).toBeUndefined()
    }
  })

  it('повод «месяц» — итог закрытого сентября (выписки покрывают); другой повод — нет', () => {
    const doc = family()
    const past = monthPlan(stateOf(doc), { ...ctxOf(doc), key: '2026-09' })
    const month = build(doc, 'month').payload.facts
    // Сентябрь Ильяса: продукты 380 000 + кафе 90 000 + такси 95 000 = 565 000.
    expect(find(month, 'прошлый месяц — потрачено')).toMatchObject({ raw: 565_000, value: money(565_000) })
    expect(find(month, 'прошлый месяц — план трат')).toMatchObject({ raw: past.spendTotal })
    expect(find(build(doc, 'salary').payload.facts, /прошлый месяц/)).toBeUndefined()
    // Выписки не покрывают сентябрь — итога нет.
    const short = buildReviewFacts(doc, KEY, { uploads: [{ slot: 'a', period_from: '2026-09-10', period_to: '2026-10-15' }], reason: 'month' })
    expect(find(short.payload.facts, /прошлый месяц/)).toBeUndefined()
  })

  it('кандидаты = `stepCandidates`: id c1…, сумма — `money`, эффект — `stepEffectText`; byId — сам кандидат', () => {
    const doc = family()
    const direct = stepCandidates(stateOf(doc), ctxOf(doc))
    const { payload, byId } = build(doc)
    expect(payload.candidates.map((c) => c.id)).toEqual(direct.map((_, i) => `c${i + 1}`))
    payload.candidates.forEach((c, i) => {
      expect(byId.get(c.id)).toEqual(direct[i])
      expect(c.kind).toBe(direct[i]!.kind)
      expect(c.value).toBe(money(direct[i]!.shift.amount))
      expect(c.effect).toBe(stepEffectText(direct[i]!))
    })
  })

  it('сито: в about нет цифр; id по порядку f1…; не больше 30; value каждого денежного факта — `money(raw)`', () => {
    const { payload } = build(family(), 'month')
    expect(payload.facts.length).toBeGreaterThan(8)
    expect(payload.facts.length).toBeLessThanOrEqual(REVIEW_FACTS_MAX)
    payload.facts.forEach((f, i) => {
      expect(f.id).toBe(`f${i + 1}`)
      expect(f.about, f.about).not.toMatch(/\d/)
      if (f.value.endsWith('₸') && typeof f.raw === 'number') expect(f.value).toBe(money(f.raw))
      if (typeof f.raw === 'string') expect(f.raw).toMatch(/^\d{4}-\d{2}$/)
    })
    for (const c of payload.candidates) expect(c.about, c.about).not.toMatch(/\d/)
    // Размер тела — несколько КБ (ручка берёт до 32 КБ, ТЗ — до 8 КБ).
    expect(JSON.stringify(payload).length).toBeLessThan(8 << 10)
  })

  it('сито на случайных именах: имя участника не выходит ни в одном about и value', () => {
    for (const name of ['Дана', 'Тимур', 'Әлия', 'Мария-Луиза']) {
      const base = family()
      const doc = family({
        people: base.people.map((p) => (p.id === 'a' ? { ...p, name } : p)),
        credits: base.credits.map((c) => (c.id === 'cc' ? { ...c, name: `Кредитка ${name}` } : c)),
        goals: base.goals.map((g) => (g.id === 'car' ? { ...g, name: `Машина для ${name}` } : g)),
        obligations: [...base.obligations, { id: 'gift', name: `Подарок ${name}`, note: '', day: 3, category: 'd4' as const, versions: [{ from: KEY, amount: 15_000 }], updatedAt: T0 }],
      })
      const text = JSON.stringify(build(doc, 'month').payload)
      expect(text, name).not.toContain(name)
      expect(text).toContain('участник 1')
    }
  })

  it('пустая семья — без падений, мало фактов и без кандидатов', () => {
    const { payload, byId } = buildReviewFacts(defaultSyncDoc(), KEY, { reason: 'month' })
    expect(payload.facts.length).toBeLessThanOrEqual(2)
    expect(payload.candidates).toEqual([])
    expect(byId.size).toBe(0)
  })
})

describe('factsLines — «что ушло» строками', () => {
  it('about: value; шаги — с суммой и эффектом', () => {
    const lines = factsLines({
      facts: [{ id: 'f1', about: 'доход месяца', value: '1 200 000 ₸', raw: 1_200_000 }],
      candidates: [{ id: 'c1', kind: 'move', about: 'из плана «Кафе» в мечту «Море»', value: '40 000 ₸', effect: 'на 2 недели раньше' }],
    })
    expect(lines).toEqual(['доход месяца: 1 200 000 ₸', 'шаг — из плана «Кафе» в мечту «Море»: 40 000 ₸ · на 2 недели раньше'])
  })
})
