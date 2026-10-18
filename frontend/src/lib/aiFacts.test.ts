import { describe, expect, it } from 'vitest'
import { buildReviewFacts, factsLines, openPath, REVIEW_ACTIONS_MAX, REVIEW_FACTS_MAX, REVIEW_TEXT_MAX } from './aiFacts'
import {
  cushionCover,
  debtsOverview,
  derivedCredits,
  dreamShift,
  firstDebt,
  goalTerm,
  habitImages,
  imageLine,
  interestImage,
  moneySettingsOf,
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
import type { HabitId, HabitTotal, ReviewFind, SpendTotal } from './statements/types'
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
/** Вход плана — как `financeStore.planInput` (стор строит его так же). */
const inputOf = (doc: SyncDoc, uploads = UPLOADS) => ({ state: stateOf(doc), ctx: { ...ctxOf(doc), uploads } })
const build = (doc: SyncDoc, reason: 'month' | 'salary' | 'refresh' = 'refresh') => buildReviewFacts(doc, inputOf(doc), reason)
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

  it('платёж с суммой 0 в этом месяце (версия позже) — не «новый платёж»', () => {
    const base = family()
    const later = { id: 'later', name: 'Netflix', note: '', day: 5, category: 'd4' as const, versions: [{ from: '2026-12', amount: 30_000 }], updatedAt: T0 }
    expect(find(build(family({ obligations: [...base.obligations, later] })).payload.facts, /новый платёж/)).toBeUndefined()
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
    expect(find(facts, /^срок мечты «Машина» за месяц отодвинулся \(«Кафе и рестораны» выше плана\) на$/)).toMatchObject({ raw: 15, value: shiftSpan(15) })
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
    const state = stateOf(doc)
    const fund = doc.goals.find((g) => g.id === 'fund')!
    const cover = cushionCover(monthPlan(state, ctxOf(doc)).queue.find((q) => q.goalId === 'fund'), fund, moneySettingsOf(state))
    const f = find(build(doc).payload.facts, 'подушки хватит на')
    expect(f).toMatchObject({ raw: cover.months })
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
      // Доставка — привычка раздела «Кафе» (`HABITS`), перенос — оттуда в первую мечту семьи.
      imageMoves: [{ id: 'mv', categoryId: 'sc_cafe', goalId: 'cushion', amount: 20_000, by: 'a', at: T0, updatedAt: T0 }],
    })
    const img = habitImages(stateOf(doc), KEY)[0]!
    expect(img.moved).toBe(20_000)
    const { facts } = build(doc).payload
    expect(find(facts, /^уже переносим из/)).toMatchObject({ raw: 20_000, value: money(20_000) })
    expect(find(facts, /^во что складывается/)).toBeUndefined()
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
    const short = buildReviewFacts(doc, inputOf(doc, [{ slot: 'a', period_from: '2026-09-10', period_to: '2026-10-15' }]), 'month')
    expect(find(short.payload.facts, /прошлый месяц/)).toBeUndefined()
  })

  it('«Сделать» = `stepCandidates`: первыми, id a1…, сумма — `money`, эффект — `stepEffectText`; doById — сам кандидат', () => {
    const doc = family()
    const direct = stepCandidates(stateOf(doc), ctxOf(doc))
    const { payload, doById, byAction } = build(doc)
    expect(direct.length).toBeGreaterThan(0)
    const dos = payload.actions.filter((a) => a.kind === 'do')
    expect(dos.map((c) => c.id)).toEqual(direct.map((_, i) => `a${i + 1}`))
    dos.forEach((c, i) => {
      expect(doById.get(c.id)).toEqual(direct[i])
      expect(c.value).toBe(money(direct[i]!.shift.amount))
      expect(c.effect).toBe(stepEffectText(direct[i]!))
      expect(byAction.get(c.id)).toBeNull()
    })
  })

  it('кандидаты «досрочно» и «в подушку» — из остатка месяца: about без цифр и имён, сумма и эффект — из кода', () => {
    const base = family()
    // Остаток месяца: доход Аруны 2 000 000, плюс подушка-фонд — даёт кандидатов prepay и cushion.
    const doc = family({
      people: base.people.map((p) => (p.id === 'b' ? { ...p, name: 'Дана', salary: 2_000_000, salaryVersions: undefined } : p)),
      credits: base.credits.map((c) => ({ ...c, name: `${c.name} Дана` })),
      goals: [...base.goals, { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 0, have: 0, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }],
    })
    const direct = stepCandidates(stateOf(doc), ctxOf(doc))
    const { payload, doById } = build(doc)
    const dos = payload.actions.filter((a) => a.kind === 'do')
    const kinds = dos.map((c) => doById.get(c.id)!.kind)
    expect(kinds).toEqual(direct.map((c) => c.kind))
    expect(kinds.some((k) => k === 'prepay' || k === 'cushion')).toBe(true)
    dos.forEach((c, i) => {
      expect(c.about, c.about).not.toContain('Дана')
      expect(c.about.replace(/«[^»]*»/g, ''), c.about).not.toMatch(/\d/)
      expect(c.value).toBe(money(direct[i]!.shift.amount))
      expect(c.effect).toBe(stepEffectText(direct[i]!))
    })
    const prepay = dos.find((c) => doById.get(c.id)!.kind === 'prepay')
    if (prepay) expect(prepay.about).toMatch(/^досрочно в «.+» из остатка месяца$/)
    const cushion = dos.find((c) => doById.get(c.id)!.kind === 'cushion')
    if (cushion) expect(cushion.about).toBe('из остатка месяца в подушку')
  })

  it('длинные названия и цифры в названиях: строки ≤ 200 (иначе 400 всему разбору), цифры about — только внутри «»', () => {
    const base = family()
    const long = (s: string) => `${s} ${'очень '.repeat(25)}длинно`
    const doc = family({
      goals: base.goals.map((g) => ({ ...g, name: long(g.name) })),
      credits: base.credits.map((c) => ({ ...c, name: long(c.name) })),
      spendCategories: [{ id: 'sc_cafe', name: 'Кафе 24', updatedAt: T0 } as never],
      obligations: [...base.obligations, { id: 'gym', name: long('Спортзал 2'), note: '', day: 12, category: 'd4' as const, versions: [{ from: KEY, amount: 25_000 }], updatedAt: T0 }],
    })
    const { payload } = build(doc, 'month')
    for (const f of payload.facts) {
      expect(f.about.length, f.about).toBeLessThanOrEqual(REVIEW_TEXT_MAX)
      expect(f.value.length, f.value).toBeLessThanOrEqual(REVIEW_TEXT_MAX)
      expect(f.about.replace(/«[^»]*»/g, ''), f.about).not.toMatch(/\d/)
    }
    for (const c of payload.actions) {
      expect(c.about.length, c.about).toBeLessThanOrEqual(REVIEW_TEXT_MAX)
      expect(c.about.replace(/«[^»]*»/g, ''), c.about).not.toMatch(/\d/)
    }
    expect(find(payload.facts, /^новый платёж «Спортзал 2 очень/)).toBeDefined()
  })

  it('сито: в about нет цифр; id по порядку f1…; не больше 40; value каждого денежного факта — `money(raw)`', () => {
    const { payload } = build(family(), 'month')
    expect(payload.facts.length).toBeGreaterThan(8)
    expect(payload.facts.length).toBeLessThanOrEqual(REVIEW_FACTS_MAX)
    payload.facts.forEach((f, i) => {
      expect(f.id).toBe(`f${i + 1}`)
      expect(f.about, f.about).not.toMatch(/\d/)
      if (f.value.endsWith('₸') && typeof f.raw === 'number') expect(f.value).toBe(money(f.raw))
      if (typeof f.raw === 'string') expect(f.raw).toMatch(/^\d{4}-\d{2}$/)
    })
    for (const c of payload.actions) expect(c.about, c.about).not.toMatch(/\d/)
    // Размер тела — несколько КБ (ручка берёт до 48 КБ, ТЗ — до 8 КБ).
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

  it('пустая семья — без падений, мало фактов, без действий и находок', () => {
    const { payload, doById, openById, findings } = buildReviewFacts(defaultSyncDoc(), inputOf(defaultSyncDoc(), []), 'month')
    expect(payload.v).toBe(3)
    expect(payload.facts.length).toBeLessThanOrEqual(2)
    expect(payload.actions).toEqual([])
    expect(doById.size + openById.size + findings.length).toBe(0)
  })
})

/**
 * RZ-03: факты находок и сценария, действия «Открыть», `openPath`. К семье AU-11 — итоги находок двух участников:
 * аптека — утечка в июле и августе, в октябре — новое регулярное «Fitness Lab», подорожавший «Кинопоиск», двойное
 * «Sport Club» и верхушка «Кафе» с покупкой 40 000 (кафе 77 000 при обычных 90 000 — не выше: «раздуло» нет).
 */
describe('buildReviewFacts v3 — находки и действия (RZ-03)', () => {
  const rf = (by: PersonId, period: string, kind: ReviewFind['kind'], key: string, rest: Partial<ReviewFind> = {}): ReviewFind => ({
    id: `${by}:${period}:${kind}:${key}`, by, period, kind, name: key.toUpperCase(), categoryId: null, count: 1, amount: 1_000, updatedAt: T0, ...rest,
  })
  const FINDS: ReviewFind[] = [
    rf('a', '2026-07', 'leak', 'apteka plus', { name: 'APTEKA PLUS', categoryId: 'sc_health', count: 7, amount: 10_500 }),
    rf('b', '2026-08', 'leak', 'apteka plus', { name: 'APTEKA PLUS', categoryId: 'sc_health', count: 9, amount: 13_500 }),
    rf('a', KEY, 'recurring', 'fitness lab', { name: 'FITNESS LAB 24', categoryId: 'sc_fun', count: 2, amount: 15_000 }),
    rf('a', KEY, 'pricier', 'kinopoisk', { name: 'KINOPOISK', count: 1, amount: 2_990, was: 2_490, targetId: 'kino' }),
    rf('b', KEY, 'double', 'sport club', { name: 'SPORT CLUB', categoryId: 'sc_fun', count: 2, amount: 12_000 }),
  ]
  const kino = { id: 'kino', name: 'Кинопоиск', note: '', day: 5, category: 'd4' as const, versions: [{ from: '2026-01', amount: 2_490 }], updatedAt: T0 }
  const withFinds = (extra: Partial<SyncDoc> = {}) => {
    const base = family()
    return family({ reviewFinds: FINDS, obligations: [...base.obligations, kino], ...extra })
  }
  const digitsOutsideNames = (s: string) => /\d/.test(s.replace(/«[^»]*»/g, ''))

  it('факты каждого вида находки и сценария первыми; raw согласован с value; about без цифр вне «»', () => {
    const doc = withFinds()
    const { payload, findings } = build(doc, 'month')
    // Утечка и двойное — по 144 000 в год: порядок находок сохраняется.
    expect(findings.map((f) => f.kind)).toEqual(['recurring', 'leak', 'double', 'pricier'])
    const facts = payload.facts
    // Утечка: (10 500 + 13 500) / 2 = 12 000 в месяц, 8 раз, 144 000 за год; образ — доля главной мечты.
    expect(find(facts, 'частые траты у «APTEKA PLUS» — в месяц')).toMatchObject({ value: money(12_000), raw: 12_000 })
    expect(find(facts, 'частые траты у «APTEKA PLUS» — раз в месяц')).toMatchObject({ value: '8 раз', raw: 8 })
    expect(find(facts, 'частые траты у «APTEKA PLUS» — за год')).toMatchObject({ value: money(144_000), raw: 144_000 })
    expect(find(facts, /^частые траты у «APTEKA PLUS» за год — доля мечты «.+»$/)?.value).toMatch(/^\d+ %$/)
    expect(find(facts, 'новое регулярное списание «FITNESS LAB 24», которого нет в плане — в месяц')).toMatchObject({ raw: 15_000 })
    expect(find(facts, 'новое регулярное списание «FITNESS LAB 24», которого нет в плане — за год')).toMatchObject({ raw: 180_000, value: money(180_000) })
    expect(find(facts, 'подписка «Кинопоиск» стала дороже: было')).toMatchObject({ raw: 2_490 })
    expect(find(facts, 'подписка «Кинопоиск» стала дороже: стало')).toMatchObject({ raw: 2_990 })
    expect(find(facts, 'списание «SPORT CLUB» прошло дважды одной суммой')).toMatchObject({ raw: 12_000 })
    // Сценарий — по самой дорогой из утечек, новых и двойных: «Fitness Lab» 180 000 в год → 15 000 в месяц в мечту.
    const s = find(facts, /^если убрать «FITNESS LAB 24» — мечта «.+» раньше на$/)!
    expect(s.value).toBe(shiftSpan(s.raw as number))
    // Находки — первыми, факты v2 — после.
    expect(facts[0]!.about).toMatch(/^новое регулярное списание/)
    expect(find(facts, 'доход месяца')).toBeDefined()
    for (const f of facts) {
      expect(digitsOutsideNames(f.about), f.about).toBe(false)
      if (f.value.endsWith('₸') && typeof f.raw === 'number') expect(f.value).toBe(money(f.raw))
    }
  })

  it('«раздуло» покупкой: факт прироста и что раздуло; «Открыть» — траты раздела', () => {
    const doc = withFinds({
      spendTotals: [...family().spendTotals!.filter((t) => !(t.period === KEY && t.categoryId === 'sc_cafe')), { id: `a:month:${KEY}:sc_cafe`, by: 'a', kind: 'month', period: KEY, categoryId: 'sc_cafe', amount: 150_000, ops: 9, updatedAt: T0 }],
      reviewFinds: [...FINDS, rf('a', KEY, 'top', 'sc_cafe', { name: '', categoryId: 'sc_cafe', count: 9, amount: 150_000, top: [{ name: 'Restoran 7', amount: 40_000 }] })],
    })
    const { payload, openById } = build(doc)
    expect(find(payload.facts, 'траты на «Кафе и рестораны» выше обычного на')).toMatchObject({ raw: 60_000 })
    expect(find(payload.facts, 'что раздуло «Кафе и рестораны»: «Restoran 7»')).toMatchObject({ raw: 40_000, value: money(40_000) })
    const cat = payload.actions.find((a) => a.about === 'открыть траты «Кафе и рестораны»')!
    expect(openById.get(cat.id)).toEqual({ kind: 'cat', id: 'sc_cafe', name: 'Кафе и рестораны' })
  })

  it('действия: «Сделать» первыми, «Открыть» — по одному на предмет, без дублей, ≤ 9, about без цифр; byAction — находка', () => {
    const doc = withFinds()
    const { payload, openById, byAction, findings } = build(doc)
    const kinds = payload.actions.map((a) => a.kind)
    expect(kinds.indexOf('open')).toBeGreaterThan(kinds.lastIndexOf('do'))
    expect(payload.actions.length).toBeLessThanOrEqual(REVIEW_ACTIONS_MAX)
    const opens = payload.actions.filter((a) => a.kind === 'open')
    const targets = opens.map((a) => openById.get(a.id)!)
    expect(new Set(targets.map((t) => `${t.kind}:${t.id}`)).size).toBe(targets.length)
    expect(targets).toContainEqual({ kind: 'seller', id: 'apteka plus', name: 'APTEKA PLUS', categoryId: 'sc_health' })
    expect(targets).toContainEqual({ kind: 'obligation', id: 'kino', name: 'Кинопоиск' })
    expect(targets.some((t) => t.kind === 'goal')).toBe(true)
    for (const a of opens) {
      expect(a.value + a.effect).toBe('')
      expect(digitsOutsideNames(a.about), a.about).toBe(false)
      expect(a.about).toMatch(/^открыть (траты|покупки у|подписку|мечту|долг) «/)
      expect(findings).toContain(byAction.get(a.id))
    }
    expect(opens.map((a) => a.about)).toContain('открыть покупки у «APTEKA PLUS»')
    // Сценарий ведёт на мечту и стоит за находкой сценария.
    const goal = opens.find((a) => openById.get(a.id)!.kind === 'goal')!
    expect((byAction.get(goal.id) as { name: string }).name).toBe('FITNESS LAB 24')
  })

  it('без мечты — сценарий досрочкой: «процентов меньше» и «долг закроется раньше»; «Открыть» — долг', () => {
    const doc = withFinds({ goals: [] })
    const { payload, openById } = build(doc)
    expect(find(payload.facts, /^если убрать «FITNESS LAB 24» — процентов банку меньше на$/)).toBeDefined()
    expect(payload.actions.some((a) => openById.get(a.id)?.kind === 'credit')).toBe(true)
  })

  it('много находок — всего фактов ≤ 40, фактам v2 остаётся место; действий ≤ 9', () => {
    const many = Array.from({ length: 12 }, (_, i) => rf('a', KEY, 'double', `club ${'abcdefghijkl'[i]}`, { name: `CLUB ${'ABCDEFGHIJKL'[i]}`, count: 2, amount: 3_000 + i }))
    const { payload } = build(withFinds({ reviewFinds: [...FINDS, ...many] }), 'month')
    expect(payload.facts.length).toBeLessThanOrEqual(REVIEW_FACTS_MAX)
    expect(find(payload.facts, 'доход месяца')).toBeDefined()
    expect(find(payload.facts, /^главная мечта/)).toBeDefined()
    expect(payload.actions.length).toBe(REVIEW_ACTIONS_MAX)
  })

  it('сито: имена участников в названиях находок — «участник N»; длинные названия ≤ 40 в «»', () => {
    const doc = withFinds({ reviewFinds: [...FINDS.slice(0, 2).map((f) => ({ ...f, name: `Аптека Ильяса ${'очень '.repeat(10)}` }))] })
    const text = JSON.stringify(build(doc).payload)
    expect(text).not.toContain('Ильяс')
    // Название обрезано до 40 знаков с «…» (до замены имени).
    expect(build(doc).payload.facts.some((f) => /«Аптека участник 1 очень[^»]*…»/.test(f.about))).toBe(true)
  })

  it('размер тела на семье с находками — ≤ 8 КБ', () => {
    expect(JSON.stringify(build(withFinds(), 'month').payload).length).toBeLessThan(8 << 10)
  })
})

describe('openPath — адреса «Открыть» (Р-18)', () => {
  it('раздел, мечта, долг, платёж, продавец (с разделом и без)', () => {
    expect(openPath({ kind: 'cat', id: 'sc_cafe', name: 'Кафе' })).toBe('/month?cat=sc_cafe')
    expect(openPath({ kind: 'goal', id: 'trip', name: 'Отпуск' })).toBe('/goals/trip')
    expect(openPath({ kind: 'credit', id: 'loan', name: 'Кредит' })).toBe('/money/debts?credit=loan')
    expect(openPath({ kind: 'obligation', id: 'kino', name: 'Кинопоиск' })).toBe('/money?obligation=kino')
    expect(openPath({ kind: 'seller', id: 'apteka plus', name: 'APTEKA', categoryId: 'sc_health' })).toBe('/money/history?cat=sc_health')
    expect(openPath({ kind: 'seller', id: 'apteka plus', name: 'APTEKA' })).toBe('/money/history')
  })
})

describe('factsLines — «что ушло» строками', () => {
  it('v2: about: value; шаги — с суммой и эффектом', () => {
    const lines = factsLines({
      facts: [{ id: 'f1', about: 'доход месяца', value: '1 200 000 ₸', raw: 1_200_000 }],
      candidates: [{ id: 'c1', kind: 'move', about: 'из плана «Кафе» в мечту «Море»', value: '40 000 ₸', effect: 'на 2 недели раньше' }],
    })
    expect(lines).toEqual(['доход месяца: 1 200 000 ₸', 'шаг — из плана «Кафе» в мечту «Море»: 40 000 ₸ · на 2 недели раньше'])
  })

  it('v3: факты, шаги и «открыть — …»', () => {
    const lines = factsLines({
      v: 3,
      facts: [{ id: 'f1', about: 'доход месяца', value: '1 200 000 ₸', raw: 1_200_000 }],
      actions: [
        { id: 'a1', kind: 'do', about: 'из остатка месяца в подушку', value: '40 000 ₸', effect: '' },
        { id: 'a2', kind: 'open', about: 'открыть траты «Кафе»', value: '', effect: '' },
      ],
    })
    expect(lines).toEqual(['доход месяца: 1 200 000 ₸', 'шаг — из остатка месяца в подушку: 40 000 ₸', 'открыть — траты «Кафе»'])
  })
})
