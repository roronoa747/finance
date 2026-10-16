import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { buildMonthSummary, maskNames, summaryNumbers } from './aiSummary'
import {
  debtsOverview,
  derivedCredits,
  goalTerm,
  monthPlan,
  openGoals,
  planForecast,
  spendFact,
  untilPayday,
} from './finance'
import { defaultSyncDoc, useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { startDemo } from './demo'
import { monthKey, today } from './dates'
import type { SyncDoc } from '@/types/finance'

const T0 = '2026-09-01T00:00:00.000Z'
const NOW = new Date('2026-10-12T06:00:00.000Z')
const KEY = '2026-10'

/**
 * Семья с именами, заметками, причинами версий, желаниями и разборами — всё, что не должно уйти в модель (Р-3).
 * Тайные слова заметок — с «секрет», чтобы сито ловило любое из них.
 */
function familyDoc(): SyncDoc {
  return {
    ...defaultSyncDoc(),
    setupDoneAt: T0,
    people: [
      {
        id: 'a', name: 'Айгуль', salary: 700_000, payday: 10, updatedAt: T0,
        salaryVersions: [{ from: '2026-01', amount: 700_000, reason: 'секрет-повышение' } as never],
      },
      { id: 'b', name: 'Ерлан', salary: 500_000, payday: 25, updatedAt: T0 },
    ],
    obligations: [
      { id: 'rent', name: 'Аренда', note: 'секрет-хозяйка Галина', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
      { id: 'gift', name: 'Подарок Ерлану', note: 'секрет-сюрприз', day: 20, category: 'd4', versions: [{ from: '2000-01', amount: 15_000 }], updatedAt: T0 },
    ],
    credits: [
      { id: 'loan', name: 'Кредит Айгуль', note: 'секрет-банк', principal: 1_000_000, principalSetAt: T0, annualRate: 0.165, payment: 58_000, day: 15, updatedAt: T0 },
      { id: 'card', name: 'Кредитка', note: '', principal: 200_000, principalSetAt: T0, annualRate: 0, rateUnknown: true, payment: 20_000, day: 22, updatedAt: T0 },
    ],
    goals: [
      {
        id: 'flat', name: 'Квартира', note: 'секрет-район', need: 10_000_000, seed: 1_000_000, have: 1_000_000, monthly: 150_000,
        hue: 'teal', planPct: 0, movements: [{ id: 'm1', date: T0, amount: 1, by: 'a', note: 'секрет-взнос' }], updatedAt: T0,
      } as never,
      { id: 'wed', name: 'Свадьба ерлана', need: 3_000_000, seed: 0, have: 0, monthly: 50_000, hue: 'plum', planPct: 0, movements: [], pausedAt: T0, updatedAt: T0 },
    ],
    wishlist: [
      { id: 'w1', name: 'Секрет-кольцо', price: 900_000, by: 'a', list: 'a', bought: false, addedOn: T0, note: 'секрет-размер', updatedAt: T0 } as never,
    ],
    spendTotals: [
      { id: `a:month:${KEY}:sc_food`, by: 'a', kind: 'month', period: KEY, categoryId: 'sc_food', amount: 85_000, ops: 9, updatedAt: T0 },
      { id: `b:month:${KEY}:sc_cafe`, by: 'b', kind: 'month', period: KEY, categoryId: 'sc_cafe', amount: 32_000, ops: 4, updatedAt: T0 },
      { id: `a:month:${KEY}:_unknown`, by: 'a', kind: 'month', period: KEY, categoryId: '_unknown', amount: 12_500, ops: 3, updatedAt: T0 },
      // Раздел платежей: в «потрачено» — только неотмеченная часть (`spentOf`).
      { id: `a:month:${KEY}:sc_telecom`, by: 'a', kind: 'month', period: KEY, categoryId: 'sc_telecom', amount: 15_000, ops: 2, unmarked: 4_000, updatedAt: T0 },
    ],
    spendPlans: [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 90_000, updatedAt: T0 },
      { id: 'b:sc_cafe', by: 'b', categoryId: 'sc_cafe', amount: 30_000, updatedAt: T0 },
    ],
    allocations: [{ id: 'al', kind: 'plan', source: 'salary', sourceId: 'a', period: '2026-09', by: 'a', total: 1, parts: [], note: 'секрет-раскладка', at: T0, updatedAt: T0 } as never],
  }
}

const UPLOADS = [{ slot: 'a', period_from: '2026-10-01', period_to: '2026-10-11' }]
/** Личный документ — в сводку не передаётся вовсе; проверяем, что его строки не просочились и из общего. */
const PRIVATE = { accounts: [{ name: 'секрет-счёт' }], merchantRules: [{ merchant: 'секрет-продавец Magnum' }] }

describe('AI-07: сводка месяца без имён', () => {
  it('сито: ни имён, ни заметок, ни причин, ни желаний, ни личного документа, ни продавцов', () => {
    const s = buildMonthSummary(familyDoc(), KEY, NOW, { uploads: UPLOADS })
    const text = JSON.stringify(s)
    for (const bad of ['Айгуль', 'Ерлан', 'айгуль', 'ерлан', 'секрет', 'Секрет', 'Галина', 'кольцо', 'Magnum', PRIVATE.accounts[0].name]) {
      expect(text, bad).not.toContain(bad)
    }
    // Имена в названиях — «участник N» по слоту, с падежом («Ерлану», «ерлана»).
    expect(s.dues.items.map((x) => x.name)).toContain('Подарок участник 2')
    expect(s.debts.items.map((x) => x.name)).toContain('Кредит участник 1')
    expect(s.goals.map((x) => x.name)).toContain('Свадьба участник 2')
    expect(s.income.byPerson.map((x) => x.who)).toEqual(['участник 1', 'участник 2'])
  })

  it('сито на случайных именах: имя участника не выходит ни в одном названии', () => {
    const names = ['Дана', 'Тимур', 'Ян', 'Әлия', 'Мария-Луиза']
    for (const name of names) {
      const doc = familyDoc()
      doc.people[0] = { ...doc.people[0], name }
      doc.obligations.push({ id: 'x', name: `Кружок ${name}`, note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 7_000 }], updatedAt: T0 })
      doc.goals.push({ id: 'y', name: `${name.toUpperCase()} учёба`, need: 100_000, seed: 0, have: 0, monthly: 10_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 })
      const text = JSON.stringify(buildMonthSummary(doc, KEY, NOW))
      for (const part of name.split('-')) expect(text.toLowerCase(), name).not.toContain(part.toLowerCase())
    }
  })

  // Критик Блока 2: имя на -а/-я/-ь/-й меняет последнюю букву («Дана» → «Даны»), у части — беглая гласная
  // («Павел» → «Павла»), «ё» пишут и через «е» — сито по падежам, а не только по именительному.
  it('сито по падежам: имя участника не выходит ни в одной форме', () => {
    const forms: Record<string, string[]> = {
      Дана: ['Даны', 'Дане', 'Дану', 'Даной'],
      Мария: ['Марии', 'Марию', 'Марией'],
      Айгуль: ['Айгули', 'Айгулью'],
      Андрей: ['Андрея', 'Андрею', 'Андреем'],
      Павел: ['Павла', 'Павлу', 'Павлом'],
      Пётр: ['Петра', 'Петру', 'Пётра'],
      Алия: ['Алии', 'Алию'],
      Ася: ['Аси', 'Асе'],
      Ян: ['Яна', 'Яну', 'Яном'],
      Тимур: ['Тимура', 'Тимуру'],
    }
    for (const [name, list] of Object.entries(forms)) {
      const people = [{ id: 'a' as const, name }]
      for (const f of list) expect(maskNames(`Подарок ${f}`, people), `${name} → ${f}`).toBe('Подарок участник 1')
    }
    // И не шире: соседние слова не становятся участником.
    expect(maskNames('Алименты', [{ id: 'a', name: 'Алия' }])).toBe('Алименты')
    expect(maskNames('Данные Даны', [{ id: 'a', name: 'Дана' }])).toBe('Данные участник 1')
  })

  it('короткое имя — только целым словом: «Вы» не съедает «Выплату»', () => {
    const people = [{ id: 'a' as const, name: 'Вы' }, { id: 'b' as const, name: 'Партнёр' }]
    expect(maskNames('Выплата Вы', people)).toBe('Выплата участник 1')
    expect(maskNames('Подарок партнёру', people)).toBe('Подарок участник 2')
    expect(maskNames('Аренда', people)).toBe('Аренда')
  })

  it('каждое число — ответ своей функции finance.ts на том же документе', () => {
    const doc = familyDoc()
    const s = buildMonthSummary(doc, KEY, NOW, { uploads: UPLOADS })
    const credits = derivedCredits(doc.credits, doc.payments ?? [])
    const state = { ...doc, credits, book: null }
    const ctx = { key: KEY, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: UPLOADS }
    const plan = monthPlan(state, ctx)

    expect(s.month).toBe(KEY)
    expect(s.daysToPayday).toBe(untilPayday({ ...state }, today(NOW))!.inDays)
    expect(s.income.total).toBe(plan.income.total)
    expect(s.income.byPerson.map((x) => x.amount)).toEqual(plan.income.byPerson.map((x) => x.amount))
    expect(s.dues.total).toBe(plan.duesTotal)
    expect(s.dues.items.map((x) => x.amount)).toEqual(plan.dues.map((d) => d.amount))
    expect(s.spend.total).toBe(plan.spendTotal)
    expect(s.spend.fact).toBe(spendFact(plan.spend))
    expect([s.rest, s.short, s.free, s.saved]).toEqual([plan.rest, plan.short, plan.free, plan.putTotal])

    // Разделы — «потрачено» по разделам (критик Блока 2): участник 2 без выписки за месяц в «потрачено» не входит —
    // и в разделы тоже; раздел платежей — неотмеченной частью. Вместе с «Без раздела» — ровно `spend.fact`.
    expect(s.spend.byCategory).toEqual([
      { name: 'Продукты', amount: 85_000 },
      { name: 'Связь и интернет', amount: 4_000 },
      { name: 'Без раздела', amount: 12_500 },
    ])
    expect(s.spend.byCategory.reduce((a, x) => a + x.amount, 0)).toBe(s.spend.fact)

    const debts = debtsOverview(state, KEY)
    expect(s.debts.total).toBe(debts.total)
    expect(s.debts.items.map((x) => [x.left, x.payment, x.endMonth])).toEqual(debts.rows.map((r) => [r.left, r.payment, r.endMonth]))
    // Ставка — проценты, как пишут экраны («16,5%»); неизвестная — null, не «0 %».
    expect(s.debts.items.map((x) => x.ratePercent)).toEqual([16.5, null])

    const goals = openGoals(doc.goals)
    expect(s.goals.map((g) => [g.want, g.have, g.monthlyPut, g.doneMonth, g.paused])).toEqual(
      goals.map((g) => {
        const item = plan.queue.find((q) => q.goalId === g.id)
        const term = goalTerm(item, g, KEY)
        return [term.need, g.have, item?.given ?? 0, term.doneMonth, term.off || !!item?.paused]
      }),
    )
    // Досрочка — строка долга очереди месяца, если план её даёт; иначе null (своего счёта нет).
    const debtRow = plan.queue.find((q) => q.kind === 'debt' && !q.paused && q.given > 0)
    expect(s.prepay).toEqual(debtRow ? { name: debtRow.name, monthlyPut: debtRow.given, doneMonth: debtRow.doneMonth } : null)
    // Выключенная цель — на паузе, без срока.
    expect(s.goals.find((g) => g.name === 'Свадьба участник 2')).toMatchObject({ paused: true, doneMonth: null, monthlyPut: 0 })
  })

  it('числа сводки — целые тенге (ставки — до сотых), summaryNumbers собирает все', () => {
    const s = buildMonthSummary(familyDoc(), KEY, NOW, { uploads: UPLOADS })
    const nums = summaryNumbers(s)
    expect(nums).toContain(s.rest)
    expect(nums).toContain(16.5)
    expect(nums).toContain(1_000_000)
    for (const n of nums.filter((x) => x !== 16.5)) expect(Number.isInteger(n), String(n)).toBe(true)
  })

  it('пустой месяц: без дохода и данных — сводка строится, массивы пустые', () => {
    const s = buildMonthSummary(defaultSyncDoc(), KEY, NOW)
    expect(s.income).toEqual({ total: 0, byPerson: [] })
    expect(s.dues).toEqual({ total: 0, items: [] })
    expect(s.spend).toEqual({ total: 0, fact: null, byCategory: [] })
    expect(s.debts).toEqual({ total: 0, items: [] })
    expect(s.goals).toEqual([])
    expect(s.daysToPayday).toBeNull()
  })
})

describe('AI-07: демо-семья', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('сводка демо строится: люди — участники, цифры плана на месте', async () => {
    expect(startDemo()).toBe(true)
    await nextTick()
    await nextTick()
    const finance = useFinanceStore()
    const s = buildMonthSummary(finance.householdDoc, monthKey(), new Date(), { book: useFxStore().book, uploads: useOperationsStore().uploads })
    expect(s.month).toBe(KEY)
    expect(s.income.byPerson.map((x) => x.who)).toEqual(['участник 1', 'участник 2'])
    expect(s.rest).toBe(finance.monthPlanOf(KEY).rest)
    expect(s.debts.items.map((x) => x.name)).toEqual(['Автокредит', 'Брату'])
    expect(s.goals.map((x) => x.name)).toContain('Поездка в Японию')
    expect(JSON.stringify(s)).not.toContain('Кофемашина')
  })

  // Ревью frontend Блока 2, Н-1 и Н-4: с планом «Сначала долги» досрочка в долг — строка очереди месяца, модель её
  // видит; цель на паузе ради плана отличается от выключенной, срок у неё — после плана, как у экрана цели.
  it('досрочка по плану и цели на паузе ради плана — те же строки, что у «Месяца» и экрана цели', async () => {
    expect(startDemo()).toBe(true)
    await nextTick()
    await nextTick()
    const finance = useFinanceStore()
    const s = buildMonthSummary(finance.householdDoc, monthKey(), new Date(), { book: useFxStore().book, uploads: useOperationsStore().uploads })
    const plan = finance.monthPlanOf(KEY)
    const debt = plan.queue.find((q) => q.kind === 'debt')!
    expect(debt.planId).toBeTruthy()
    expect(debt.given).toBeGreaterThan(0)
    expect(s.prepay).toEqual({ name: debt.name, monthlyPut: debt.given, doneMonth: debt.doneMonth })
    expect(summaryNumbers(s)).toContain(debt.given)

    const car = s.goals.find((g) => g.name === 'Машина')!
    const sofa = s.goals.find((g) => g.name === 'Новый диван')!
    expect(car).toMatchObject({ paused: true, afterPlan: true })
    expect(sofa).toMatchObject({ paused: true, afterPlan: false, doneMonth: null })
    // Срок «после плана» — тот же вызов, что у экрана цели (`GoalDetail.vue`: `goalTerm` с `planForecast`).
    const g = finance.householdDoc.goals.find((x) => x.name === 'Машина')!
    const item = plan.queue.find((q) => q.goalId === g.id)
    expect(item?.paused).toBe('plan')
    const term = goalTerm(item, g, KEY, planForecast(finance.activePlan!, finance.planState(), KEY))
    expect(term.doneMonth).toBeTruthy()
    expect(car.doneMonth).toBe(term.doneMonth)
  })
})
