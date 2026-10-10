import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { amountTotal, capitalGoals, capitalStats, debtsOverview, liveAccounts, liveCredits, liveGoals, netWorth, openDebt, planForecast } from '../src/lib/finance'
import { money } from '../src/lib/money'
import { monthBy } from '../src/lib/dates'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Money from '../src/views/Money.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

/**
 * Блок 2 «понятность» (PN-03…PN-06, Р-2, Р-3; эталон `capital-stats.html`): плашка Капитала на двух телефонах и у
 * viewer на фейковом сервере (`support/family`), 12 октября 2026. (а) формула «счета − долги» под числом равна
 * `netWorth` до тенге, в закрытом экране статистики нет; (б) раскрытие — доли равны плану месяца (`monthPlanOf`),
 * тождество долей, рост = тело + досрочка + взносы, «без долгов к» = `debtsOverview.freeMonth`; (в) viewer видит формулу
 * и раскрывает; (г) партнёр добавил кредит → после синка у первого выросли доля «кредиты» и переплата. Приёмка: (д) не
 * хватает на платежи — «остаётся» 0, «не хватает N», процентов нет (ux Б2); (е) партнёр выбрал план «Сначала долги» →
 * после синка у первого переплата меньше на экономию плана, срок — из плана. Экраны — SSR (`screen`), раскрытие —
 * состоянием `statsOpen` (`screenMixin`); браузер — на стенде §6.
 */
const KEY = '2026-10'

type Phone = Awaited<ReturnType<typeof phone>>

describe('e2e / понятность Блок 2 — плашка Капитала: формула и статистика', () => {
  const storage = new Map<string, string>()
  let server: FakeServer

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    // Карточка долга 40 000 в месяц — досрочка в самый дорогой долг входит в долю «кредиты» и в рост.
    server = fakeServer(planFamilyDoc({ debtCard: { monthly: 40_000, payer: 'a', updatedAt: T0 } }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    const p = await phone(server)
    setActivePinia(p.pinia)
    useAuthStore().setAuthData(authAs(role, slot))
    return p
  }
  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
  /** Текст без тегов; все пробелы (и неразрывные `plain()`) — обычным: `\s` в JS включает NBSP. */
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  const sp = (s: string) => s.replace(/\s/g, ' ')
  const digits = (s: string) => Number(s.replace(/\D/g, ''))
  /** Сумма после атрибута `data-…>` в разметке: «2 250 000 ₸» → 2250000. */
  const amountAt = (html: string, attr: string) => {
    const m = html.match(new RegExp(`${attr}[^>]*>([^<]*)<`))
    if (!m) throw new Error(`нет ${attr}`)
    return (/[−-]/.test(m[1]) ? -1 : 1) * digits(m[1])
  }
  /** Формула под числом: «счета N − долги M» → числа; без долгов — «счета N · долгов нет». */
  const formulaOf = (html: string) => {
    const m = html.match(/data-worth-formula[^>]*>([^<]*)</)
    if (!m) throw new Error('нет data-worth-formula')
    const t = text(m[1])
    const two = t.match(/счета ([\d ]+?) − долги ([\d ]+)/)
    if (two) return { assets: digits(two[1]), debt: digits(two[2]), noDebt: false }
    const one = t.match(/счета ([\d ]+?) · долгов нет/)
    if (!one) throw new Error(`формула не разобрана: ${t}`)
    return { assets: digits(one[1]), debt: 0, noDebt: true }
  }
  /** Строка доли `data-stat-row="key"` — её сумма и проценты. */
  const rowOf = (html: string, key: string) => {
    const start = html.indexOf(`data-stat-row="${key}"`)
    expect(start, `строка ${key}`).toBeGreaterThan(-1)
    const ends = ['data-stat-row="', 'data-short', 'data-growth', 'data-debt-free'].map((m) => html.indexOf(m, start + 1)).filter((i) => i > start)
    const row = html.slice(start, ends.length ? Math.min(...ends) : undefined)
    return { amount: amountAt(row, 'data-stat-amount'), pct: digits(row.match(/data-stat-pct[^>]*>([^<]*)</)![1]) }
  }
  /** Сумма строки доли без процентов (при нехватке колонки процентов нет). */
  const rowAmount = (html: string, key: string) => {
    const start = html.indexOf(`data-stat-row="${key}"`)
    expect(start, `строка ${key}`).toBeGreaterThan(-1)
    return amountAt(html.slice(start), 'data-stat-amount')
  }
  const rows = (html: string) => [...html.matchAll(/data-stat-row="([a-z]+)"/g)].map((m) => m[1])
  const statsOf = (p: Phone) => capitalStats(p.store.monthPlanOf(KEY), { ...p.store.planState(), plans: p.store.plans }, KEY)
  const opened = (p: Phone) => screen(p.pinia, Money, '/money', undefined, [screenMixin({ statsOpen: true })])
  const worthOf = (p: Phone) => netWorth(liveAccounts(p.store.accounts), liveCredits(p.store.credits), liveGoals(p.store.goals))
  const assetsOf = (p: Phone) => amountTotal(liveAccounts(p.store.accounts)) + capitalGoals(p.store.goals, p.store.accounts).total

  it('(а) формула «счета − долги» под числом = netWorth до тенге; подсказки «?» нет; закрытый экран — без статистики', async () => {
    const A = await as('member', 'a')
    const html = await screen(A.pinia, Money, '/money')
    const f = formulaOf(html)
    // Счета 2 000 000 + цели вне счетов 650 000 (подушка 400 000, отпуск 50 000, машина 200 000); кредиты 1 540 000.
    expect(f).toEqual({ assets: 2_650_000, debt: 1_540_000, noDebt: false })
    expect(f.assets).toBe(assetsOf(A))
    expect(f.debt).toBe(openDebt(A.store.credits))
    expect(amountAt(html, 'data-worth')).toBe(worthOf(A))
    expect(f.assets - f.debt).toBe(amountAt(html, 'data-worth'))
    expect(html).not.toContain('Что такое капитал')
    expect(html).not.toContain('data-worth-hint')
    expect(html).toMatch(/data-capital[^>]*aria-expanded="false"|aria-expanded="false"[^>]*data-capital/)
    for (const attr of ['data-stat-row', 'data-growth', 'data-debt-free', 'data-overpay', 'data-capital-stats-body']) expect(html, attr).not.toContain(attr)
    // Гвард тишины «Денег» (Money.test.ts:321) — те же слова и в закрытой плашке.
    for (const gone of ['Доход', 'остаток по плану', 'Подробнее', 'До зарплаты']) expect(text(html), gone).not.toContain(gone)
  })

  it('(б) раскрытие — четыре доли = план месяца, тождество долей, рост = тело + досрочка + взносы, «без долгов к» = debtsOverview', async () => {
    const A = await as('member', 'a')
    const plan = A.store.monthPlanOf(KEY)
    const s = statsOf(A)
    const html = await opened(A)
    expect(html).toMatch(/data-capital[^>]*aria-expanded="true"|aria-expanded="true"[^>]*data-capital/)
    expect(rows(html)).toEqual(['credits', 'payments', 'goals', 'rest'])
    // Пересчёт из плана прямо здесь: кредиты — платежи по кредитам из графика + досрочка карточки; платежи — остальной
    // график; в цели — что очередь даёт целям и фондам; остаётся — остальное.
    const credits = plan.dues.filter((d) => d.kind === 'credit').reduce((a, d) => a + d.amount, 0) + plan.queue.filter((q) => q.kind === 'debt').reduce((a, q) => a + q.given, 0)
    const payments = plan.dues.filter((d) => d.kind === 'obligation').reduce((a, d) => a + d.amount, 0)
    const goals = plan.queue.filter((q) => q.kind !== 'debt').reduce((a, q) => a + q.given, 0)
    // 58 000 + 25 000 + 20 000 + 40 000 = 143 000; аренда 220 000; доход 1 200 000.
    expect(credits).toBe(143_000)
    expect(payments).toBe(220_000)
    expect(plan.income.total).toBe(1_200_000)
    expect(rowOf(html, 'credits').amount).toBe(credits)
    expect(rowOf(html, 'payments').amount).toBe(payments)
    expect(rowOf(html, 'goals').amount).toBe(goals)
    expect(rowOf(html, 'rest').amount).toBe(Math.max(0, 1_200_000 - credits - payments - goals))
    const shown = ['credits', 'payments', 'goals', 'rest'].map((k) => rowOf(html, k))
    expect(shown.reduce((a, r) => a + r.amount, 0)).toBe(Math.max(1_200_000, credits + payments + goals))
    expect(Math.abs(shown.reduce((a, r) => a + r.pct, 0) - 100)).toBeLessThanOrEqual(1)
    for (const [i, k] of (['credits', 'payments', 'goals', 'rest'] as const).entries()) expect(shown[i].pct, k).toBe(s.parts.find((p) => p.key === k)!.pct)
    // Рост: тело кредита 30 500 + кредитки 15 000 + рассрочки 20 000 + досрочка 40 000 + взносы; на экране до тысяч.
    expect(s.growth).toBe(65_500 + 40_000 + goals)
    expect(text(html)).toContain(sp(`Капитал растёт на ~${money(Math.round(s.growth / 1000) * 1000)} в месяц`))
    const o = debtsOverview({ ...A.store.planState(), plans: A.store.plans }, KEY)
    expect(o.freeMonth).not.toBeNull()
    expect(s.debtFree.month).toBe(o.freeMonth)
    expect(text(html)).toContain(`Без долгов ${monthBy(o.freeMonth!)} · ещё ${s.debtFree.salaries} зарплат`)
    expect(s.overpay.amount).toBeGreaterThan(0)
    expect(text(html)).toContain(sp(`Переплата ${money(s.overpay.amount!)}`))
    expect(text(html)).toMatch(/· [\d,]+ зарплат/)
    expect(html).not.toContain('data-short')
  })

  it('(в) viewer — формула видна и статистика раскрывается так же (читает)', async () => {
    const A = await as('member', 'a')
    const V = await as('viewer', 'b')
    const closed = await screen(V.pinia, Money, '/money')
    expect(formulaOf(closed)).toEqual(formulaOf(await screen(on(A).pinia, Money, '/money')))
    expect(closed).not.toContain('data-stat-row')
    const html = await opened(on(V))
    expect(rows(html)).toEqual(['credits', 'payments', 'goals', 'rest'])
    expect(rowOf(html, 'credits').amount).toBe(143_000)
    expect(text(html)).toContain('Без долгов')
  })

  it('(г) партнёр добавил кредит → после синка у первого формула, доля «кредиты» и переплата изменились', async () => {
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    const before = statsOf(on(A))
    const beforeHtml = await opened(A)
    expect(rowOf(beforeHtml, 'credits').amount).toBe(143_000)

    on(B)
    at('2026-10-12T07:01:00Z')
    // Рассрочка на телефон 600 000 под 30 % по 60 000 в месяц.
    B.store.addCredit({ name: 'Телефон', principal: 600_000, annualRate: 0.3, payment: 60_000, day: 12 })
    await B.store.syncHousehold(B.client)
    await on(A).store.syncHousehold(A.client)
    expect(A.store.credits.some((c) => c.name === 'Телефон')).toBe(true)

    const after = statsOf(A)
    const html = await opened(A)
    expect(formulaOf(html).debt).toBe(1_540_000 + 600_000)
    expect(amountAt(html, 'data-worth')).toBe(worthOf(A))
    expect(rowOf(html, 'credits').amount).toBe(after.parts.find((p) => p.key === 'credits')!.amount)
    expect(rowOf(html, 'credits').amount).toBeGreaterThan(143_000)
    expect(rowOf(html, 'credits').pct).toBeGreaterThan(rowOf(beforeHtml, 'credits').pct)
    expect(after.overpay.amount).toBeGreaterThan(before.overpay.amount!)
    expect(text(html)).toContain(sp(`Переплата ${money(after.overpay.amount!)}`))
  })

  it('без долгов — формула «счета N · долгов нет», три доли и строка «Долгов нет»', async () => {
    server.data.credits = []
    const A = await as('member', 'a')
    const html = await opened(A)
    expect(formulaOf(html)).toEqual({ assets: 2_650_000, debt: 0, noDebt: true })
    expect(amountAt(html, 'data-worth')).toBe(2_650_000)
    expect(rows(html)).toEqual(['payments', 'goals', 'rest'])
    expect(text(html)).toContain('Долгов нет')
    expect(html).not.toContain('data-overpay')
  })

  it('(д) приёмка: не хватает на платежи — «остаётся» 0, подпись «не хватает N», процентов нет (ux Б2), полоска из четырёх долей', async () => {
    const base = planFamilyDoc()
    // Оклады 100 000 и 50 000: платежи 220 000 и кредиты 143 000 больше дохода 150 000.
    server = fakeServer(planFamilyDoc({ people: base.people.map((p) => ({ ...p, salary: p.id === 'a' ? 100_000 : 50_000 })), debtCard: { monthly: 40_000, payer: 'a', updatedAt: T0 } }))
    const A = await as('member', 'a')
    const s = statsOf(A)
    expect(s.income).toBe(150_000)
    expect(s.short).toBeGreaterThan(0)
    expect(s.parts.some((p) => p.pct > 100)).toBe(true)
    const closed = await screen(A.pinia, Money, '/money')
    expect(closed).not.toContain('data-short')
    const html = await opened(A)
    expect(rows(html)).toEqual(['credits', 'payments', 'goals', 'rest'])
    expect(rowAmount(html, 'rest')).toBe(0)
    expect(text(html)).toContain(sp(`не хватает ${money(s.short)}`))
    expect(html).not.toContain('data-stat-pct')
    // Тождество долей: показанное в сумме = кредиты + платежи + в цели — больше дохода, полоска заполнена целиком.
    const shown = ['credits', 'payments', 'goals', 'rest'].map((k) => rowAmount(html, k))
    expect(shown.reduce((a, b) => a + b, 0)).toBe(s.parts.reduce((a, p) => a + p.amount, 0))
    expect(shown.reduce((a, b) => a + b, 0)).toBeGreaterThan(150_000)
    expect(rowAmount(html, 'payments')).toBe(220_000)
  })

  it('(е) приёмка: партнёр выбрал план «Сначала долги» → после синка у первого переплата меньше на экономию плана, срок — из плана', async () => {
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    const before = statsOf(on(A))
    expect(before.overpay.amount).toBeGreaterThan(0)
    expect(A.store.activePlan).toBeFalsy()

    on(B)
    at('2026-10-12T07:02:00Z')
    const plan = B.store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 0 }, 'b')
    expect(plan).not.toBeNull()
    await B.store.syncHousehold(B.client)
    await on(A).store.syncHousehold(A.client)
    const active = A.store.plans.find((p) => p.id === plan!.id)
    expect(active?.status).toBe('active')

    const state = { ...A.store.planState(), plans: A.store.plans }
    const saved = planForecast(active!, state, KEY).savedInterest
    expect(saved).toBeGreaterThan(0)
    const after = statsOf(A)
    expect(after.overpay.amount).toBe(Math.max(0, before.overpay.amount! - saved!))
    expect(after.overpay.amount).toBeLessThan(before.overpay.amount!)
    expect(after.debtFree.month).toBe(debtsOverview(state, KEY).freeMonth)
    const html = await opened(A)
    expect(text(html)).toContain(sp(`Переплата ${money(after.overpay.amount!)}`))
    expect(text(html)).toContain(`Без долгов ${monthBy(after.debtFree.month!)}`)
    // Платежи по графику планом не меняются; доля «кредиты» с досрочками плана — не меньше прежней.
    expect(rowOf(html, 'payments').amount).toBe(220_000)
    expect(rowOf(html, 'credits').amount).toBeGreaterThanOrEqual(143_000)
  })
})
