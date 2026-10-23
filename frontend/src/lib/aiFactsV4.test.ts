import { describe, expect, it } from 'vitest'
import { buildReviewFactsV4, REVIEW_FACTS_MAX } from './aiFacts'
import { derivedCredits, monthPlan, reviewCards, whereSplit, type MonthPlanCtx, type UploadPeriod } from './finance'
import { money } from './money'
import { spendTotals } from './statements/model'
import type { Operation, ReviewFind, SpendTotal } from './statements/types'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Goal, PersonId, SyncDoc } from '@/types/finance'

/**
 * FB-16 (бэклог «Фидбек», Р-26, Р-28): факты и карточки разбора v4 — числа берутся из карточек и «Куда ушло» (`finance.ts`),
 * в теле нет имён людей из переводов, имён участников, дат операций и 6+ цифр; находки партнёра не уходят.
 *
 * Семья `planFamilyDoc` (Ильяс и Аруна), октябрь 2026; выписки обоих — с 1 июля по 15 октября. Ильяс: «Магнум» каждый
 * месяц, в октябре — перевод «Замире Ш.» 90 000, снятие наличных 40 000, трата без раздела 30 000; мечта названа именем
 * участника («Ильяс — на море»).
 */

const KEY = '2026-10'
const UPLOADS: UploadPeriod[] = [
  { slot: 'a', period_from: '2026-07-01', period_to: '2026-10-15' },
  { slot: 'b', period_from: '2026-07-01', period_to: '2026-10-15' },
]
let n = 0
const op = (merchant: string, amount: number, categoryId: string | null, date: string, extra: Partial<Operation> = {}): Operation => ({
  id: `f${++n}`, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const OPS = [
  ...['2026-07-07', '2026-08-04', '2026-09-08', '2026-10-06'].map((d) => op('MAGNUM', -60_000, 'sc_food', d)),
  op('Замира Ш.', -90_000, 'sc_people', '2026-10-04', { kind: 'transfer-out', counterparty: 'Замира Ш.', note: 'Перевод' }),
  op('ATM KASPI 1234567', -40_000, 'sc_cash', '2026-10-05', { kind: 'cash' }),
  op('IP ABENOVA', -30_000, null, '2026-10-03'),
]
const totalsOf = (by: PersonId, ops: Operation[]): SpendTotal[] =>
  [...new Set(ops.map((o) => o.date.slice(0, 7)))].flatMap((m) => spendTotals(ops, by, 'month', m, T0, { marked: new Set(), categories: [] }))
const partnerFind: ReviewFind = { id: `b:${KEY}:double:sport club`, by: 'b', period: KEY, kind: 'double', name: 'SPORT CLUB', categoryId: 'sc_fun', count: 2, amount: 12_000, updatedAt: T0 }

function input(extra: Partial<SyncDoc> = {}) {
  const base = planFamilyDoc()
  const goals: Goal[] = base.goals.map((g, i) => (i === 2 ? { ...g, name: 'Ильяс — на море' } : g))
  const totals = [...totalsOf('a', OPS), ...totalsOf('b', [op('MAGNUM', -70_000, 'sc_food', '2026-10-05')])]
  const doc = planFamilyDoc({ goals, spendTotals: totals, reviewFinds: [partnerFind], ...extra })
  const state = { ...doc, credits: derivedCredits(doc.credits ?? [], doc.payments ?? []), book: null }
  const ctx: MonthPlanCtx = { key: KEY, totals, spendCategories: doc.spendCategories ?? [], uploads: UPLOADS }
  return { doc, plan: { state, ctx } }
}

describe('buildReviewFactsV4 — факты и карточки', () => {
  it('карточки кода — те же, что `reviewCards`; цифры фактов — их цифры; доли «Куда ушло» — из `whereSplit`', () => {
    const { doc, plan } = input()
    const out = buildReviewFactsV4(doc, plan, OPS, 'a', 'month')
    const cards = reviewCards({ ...doc, ...plan.state }, plan.ctx, OPS, 'a')
    expect(out.cards).toEqual(cards)
    expect(out.payload.v).toBe(4)
    expect(out.payload.cards.map((c) => c.id)).toEqual(cards.map((_, i) => `c${i + 1}`))
    expect(out.payload.cards.map((c) => c.kind)).toEqual(cards.map((c) => c.kind))
    expect(out.cardById.get('c1')).toEqual(cards[0])
    const people = out.payload.facts.find((f) => f.about === 'переводы людям в этом месяце')!
    expect(people).toMatchObject({ value: money(90_000), raw: 90_000 })
    expect(out.labels.get(people.id)).toBe('в месяц · переводы людям')
    const split = whereSplit(plan.state, plan.ctx, 'a')!
    const sellers = split.parts.find((p) => p.key === 'sellers')!
    expect(out.payload.facts.find((f) => f.about === 'траты у продавцов — доля своих трат месяца')).toMatchObject({ raw: sellers.share })
    expect(out.payload.facts.length).toBeLessThanOrEqual(REVIEW_FACTS_MAX)
    // Факты месяца семьи (доход) — тоже есть.
    expect(out.payload.facts.find((f) => f.about === 'доход месяца')).toMatchObject({ raw: monthPlan(plan.state, plan.ctx).income.total })
  })

  it('граница данных (Р-28): ни имени получателя, ни имени участника, ни «ИП + фамилия», ни 6+ цифр, ни дат операций', () => {
    const { doc, plan } = input()
    const body = JSON.stringify(buildReviewFactsV4(doc, plan, OPS, 'a', 'month').payload)
    for (const no of ['Замира', 'Ильяс', 'Аруна', 'ABENOVA', '1234567', '2026-10-0']) expect(body).not.toContain(no)
    expect(body).toContain('участник 1')
    // Люди и наличные — только видом.
    expect(body).toContain('переводы людям — разобрать, кому и за что')
    expect(body).toContain('наличные без заметки — записать, на что')
  })

  it('годовая подписка подорожала: факт — разница «раз в год», подпись «дороже раз в год», как v3 (Р-19)', () => {
    const ins = { id: 'ins', name: 'Страховка', note: '', day: 5, category: 'd4' as const, every: 'year' as const, versions: [{ from: '2026-01', amount: 60_000 }], updatedAt: T0 }
    const pricier: ReviewFind = { id: `a:${KEY}:pricier:insur`, by: 'a', period: KEY, kind: 'pricier', name: 'INSUR', categoryId: null, count: 1, amount: 66_000, was: 60_000, targetId: 'ins', updatedAt: T0 }
    const { doc, plan } = input({ obligations: [...planFamilyDoc().obligations, ins], reviewFinds: [partnerFind, pricier] })
    const out = buildReviewFactsV4(doc, plan, OPS, 'a', 'month')
    const fact = out.payload.facts.find((f) => f.about === 'подписка «Страховка» стала дороже на — раз в год')!
    expect(fact).toMatchObject({ value: money(6_000), raw: 6_000 })
    expect(out.labels.get(fact.id)).toBe('дороже раз в год · Страховка')
  })

  it('`by`: находки и итоги партнёра в моё тело не идут; у партнёра — его факт', () => {
    const { doc, plan } = input()
    const mine = JSON.stringify(buildReviewFactsV4(doc, plan, OPS, 'a', 'month').payload)
    expect(mine).not.toContain('SPORT CLUB')
    const partner = buildReviewFactsV4(doc, plan, [], 'b', 'month')
    expect(partner.payload.facts.some((f) => f.about.includes('переводы людям'))).toBe(false)
  })
})
