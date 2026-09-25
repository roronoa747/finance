import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import type { Payment } from '@/types/finance'
import { money, plain } from '@/lib/money'
import { monthIn } from '@/lib/dates'
import { planFact, planForecast, planSchedule } from '@/lib/finance'
import { authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import DebtPlan from './DebtPlan.vue'

describe('views/DebtPlan.vue — экран плана «Сначала долги»', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const family = (extra = {}) => {
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc({ plans: [planOf()], ...extra }), 1)
    return store
  }
  const cancelButton = />\s*Отменить план\s*</

  describe('PV-15', () => {
    it('без плана — «Плана нет» и ссылка на калькулятор', async () => {
      family({ plans: [] })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Плана нет')
      expect(html).toContain('href="/capital?advice=strategy"')
      expect(html).not.toMatch(cancelButton)
    })

    it('с планом — дата выбора, цели на паузе с их взносами, подушка; участник может отменить', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('План «Сначала долги»')
      expect(html).toContain('Выбран 10 сентября')
      for (const [name, monthly] of [['Отпуск', 40_000], ['Машина', 60_000]] as const) {
        const row = html.slice(html.indexOf(`>${name}<`))
        expect(row.slice(0, row.indexOf('</button>'))).toContain(money(monthly))
      }
      const pausedSection = html.slice(html.indexOf('Что не ушло в цели'), html.indexOf('Подушка плана'))
      expect(pausedSection).toContain('>Отпуск<')
      expect(pausedSection).not.toContain('>Подушка<')
      expect(html).toContain('Подушка плана — «Подушка»: взносы продолжаются.')
      expect(html).toMatch(cancelButton)
    })

    it('viewer — всё видно, «Отменить план» нет (Р-12)', async () => {
      useAuthStore().setAuthData(authAs('viewer', 'b'))
      family()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('>Отпуск<')
      expect(html).not.toMatch(cancelButton)
    })
  })

  describe('PV-17 — месяцы, выигрыш, паузы, график, история', () => {
    // «Машина» не останавливается — на паузе один «Отпуск» (40 000); шаг — 40 000 в кредитку.
    const prepay = (id: string, p: Partial<Payment>): Payment => ({
      id, kind: 'prepay', targetId: 'cc', period: '2026-09', amount: 40_000, principal: 40_000, accountId: 'card',
      by: 'a', at: '2026-09-20T05:00:00.000Z', updatedAt: '2026-09-20T05:00:00.000Z', saved: 9_000, mode: 'term', planId: 'plan', ...p,
    })
    const payments = [
      prepay('p1', {}),
      prepay('p2', { period: '2026-10', at: '2026-10-18T05:00:00.000Z', updatedAt: '2026-10-18T05:00:00.000Z', saved: 7_000 }),
    ]
    const setup = (extra = {}) => {
      vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
      useAuthStore().setAuthData(authAs('member'))
      const store = useFinanceStore()
      store.setHouseholdDoc(planFamilyDoc({ plans: [planOf({ keptGoalIds: ['car'] })], payments, ...extra }), 1)
      return store
    }
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \n\t\r]+/g, ' ')

    it('план и факт по месяцам: сентябрь и октябрь с фактом, текущий выделен', async () => {
      setup()
      const html = await renderScreen(DebtPlan, '/plan')
      const table = text(html.slice(html.indexOf('План и факт по месяцам'), html.indexOf('Что не ушло в цели')))
      expect(table).toContain(`сен 2026 ${money(40_000)} ${money(40_000)} Кредитка`)
      expect(table).toContain(`окт 2026 ${money(40_000)} ${money(40_000)} Кредитка`)
      expect(html).toMatch(/font-semibold text-brand">окт 2026</)
    })

    it('что не ушло в цели: «Отпуск» — взнос × 2 месяца паузы, дата сдвинулась на 2 мес.; «Машина» не на паузе', async () => {
      setup()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain(`${money(80_000)} не внесено, дата сдвинулась на 2 мес.`)
      expect(html.slice(html.indexOf('Что не ушло в цели'))).not.toContain('>Машина<')
    })

    it('выигрыш: при выборе — снимок плана, сейчас — planForecast от факта, уже сэкономили — planFact', async () => {
      const store = setup()
      const html = text(await renderScreen(DebtPlan, '/plan'))
      const plan = store.activePlan!
      expect(html).toContain(`При выборе ожидали не отдадим банку ${money(180_000)} , долги с процентами закроются в январе 2028`)
      const now = planForecast(plan, store.planState(), '2026-10')
      expect(html).toContain(
        `Сейчас (от факта) ещё не отдадим банку ${money(now.savedInterest!)} , долги с процентами закроются в ${monthIn(now.debtFreeMonth!)}`,
      )
      expect(planFact(plan, store.payments, store.credits).savedInterest).toBe(16_000)
      expect(html).toContain(`Уже сэкономили ${money(16_000)}`)
    })

    it('график платежей долга: свёрнут; развёрнутый — досрочки «по плану» = planSchedule', async () => {
      const store = setup()
      const closed = await renderScreen(DebtPlan, '/plan')
      expect(closed).toContain('График платежей «Кредитка»')
      expect(closed).not.toContain('по плану ')
      const html = await renderScreen(DebtPlan, '/plan', undefined, [screenMixin({ scheduleOpen: true })])
      const rows = planSchedule(store.activePlan!, store.planState(), '2026-10')!.rows
      // Октябрьский шаг уже внесён — в строке октября; дальше — шаги плана.
      expect(rows[0]).toMatchObject({ period: '2026-10', extra: 40_000 })
      for (const r of rows.filter((x) => x.extra > 0)) expect(html).toContain(`по плану ${plain(r.extra)}`)
      expect(html).toContain('ноя 2026')
    })

    it('история — живой итог: досрочка партнёра, пришедшая после отмены, в итоге отменённого плана', async () => {
      // Снимок result при отмене — 0, а досрочка B с id плана (9 000 сэкономили) пришла потом.
      const cancelled = planOf({ status: 'cancelled', endedAt: '2026-09-21T05:00:00.000Z', result: { savedInterest: 0 } })
      setup({ plans: [cancelled], payments: [payments[0]] })
      const html = text(await renderScreen(DebtPlan, '/plan'))
      expect(html).toContain(`Сентябрь 2026: отменён, сэкономили ${money(9_000)}`)
    })

    it('Р-11: долг не закрывается без плана — вместо «не отдадим банку N» «экономию не считаем»', async () => {
      const store = setup({ plans: [planOf({ keptGoalIds: ['car'], forecast: { gain: 0, savedInterest: null, debtFreeMonth: '2027-03' } })] })
      store.updateCredit('cc', { payment: 5_000 })
      store.updateCredit('loan', { payment: 20_000 })
      const html = text(await renderScreen(DebtPlan, '/plan'))
      const win = html.slice(html.indexOf('Выигрыш'), html.indexOf('Уже сэкономили'))
      expect(win).toContain('При выборе ожидали при текущем платеже долг не закрывается — экономию не считаем')
      expect(win).toContain('Сейчас (от факта) при текущем платеже долг не закрывается — экономию не считаем')
    })

    it('план закрыт в этом месяце — Callout «цели возобновились» и строка истории; в следующем месяце — только история', async () => {
      const done = planOf({ keptGoalIds: ['car'], status: 'done', endedAt: '2026-10-19T05:00:00.000Z', result: { savedInterest: 16_000 } })
      const old = planOf({
        id: 'old', status: 'cancelled', startedAt: '2026-08-05T05:00:00.000Z', endedAt: '2026-08-20T05:00:00.000Z', result: { savedInterest: 0 },
      })
      setup({ plans: [old, done] })
      const html = text(await renderScreen(DebtPlan, '/plan'))
      expect(html).toContain('Долги с процентами закрыты — цели возобновились')
      expect(html).toContain(`Сэкономили ${money(16_000)} процентов.`)
      expect(html).toContain(`Сентябрь 2026 — Октябрь 2026: сэкономили ${money(16_000)} процентов`)
      expect(html).toContain(`Август 2026: отменён, сэкономили ${money(0)}`)
      // Новые сверху.
      expect(html.indexOf('Сентябрь 2026 — Октябрь 2026')).toBeLessThan(html.indexOf('Август 2026: отменён'))
      expect(html).toContain('Плана нет')
      expect(html).not.toMatch(/Отменить план/)

      vi.setSystemTime(new Date('2026-11-02T07:00:00Z'))
      const later = text(await renderScreen(DebtPlan, '/plan'))
      expect(later).not.toContain('цели возобновились')
      expect(later).toContain('История планов')
    })
  })

  describe('PV-16 — шаг этого месяца и пропущенный месяц', () => {
    const prepay = (p: Partial<Payment>): Payment => ({
      id: 'p1', kind: 'prepay', targetId: 'cc', period: '2026-09', amount: 100_000, principal: 100_000, accountId: 'card',
      by: 'a', at: '2026-09-20T05:00:00.000Z', updatedAt: '2026-09-20T05:00:00.000Z', saved: 9_000, mode: 'term', planId: 'plan', ...p,
    })

    it('шаг — досрочка: сумма, долг, «Внести по плану» (участник)', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family()
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Шаг этого месяца')
      expect(html).toContain(money(100_000))
      expect(html).toContain('досрочно в «Кредитка»')
      expect(html).toMatch(/>\s*Внести по плану\s*</)
    })

    it('шаг внесён — «Внесено по плану», без кнопки', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family({ payments: [prepay({})] })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Внесено по плану')
      expect(html).not.toMatch(/>\s*Внести по плану\s*</)
    })

    it('шаг закрыл кредитку, сумма месяца не вся — второй шаг в «Кредит»; внесён — обе досрочки в «Внесено по плану»', async () => {
      useAuthStore().setAuthData(authAs('member'))
      // Кредитка 20 000 под 40%: последний платёж 20 667 — он и 100 000 пауз минус 20 000 внесённых.
      const credits = planFamilyDoc().credits.map((c) => (c.id === 'cc' ? { ...c, principal: 20_000 } : c))
      const first = prepay({ amount: 20_000, principal: 20_000 })
      family({ credits, payments: [first] })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain(money(100_667))
      expect(html).toContain('досрочно в «Кредит»')
      expect(html).toContain(`Уже внесено ${money(20_000)} — «Кредитка» закрыт`)
      expect(html).toMatch(/>\s*Внести по плану\s*</)

      setActivePinia(createPinia())
      useAuthStore().setAuthData(authAs('member'))
      const second = prepay({ id: 'p2', targetId: 'loan', amount: 100_667, principal: 100_667, at: '2026-09-21T05:00:00.000Z' })
      family({ credits, payments: [first, second] })
      const done = await renderScreen(DebtPlan, '/plan')
      expect(done).toContain('Внесено по плану')
      expect(done).toContain(`${money(20_000)} в «Кредитка»`)
      expect(done).toContain(`${money(100_667)} в «Кредит»`)
      expect(done).not.toMatch(/>\s*Внести по плану\s*</)
    })

    it('шаг — подушка: «Сначала подушка» и «Пополнить подушку»', async () => {
      const goals = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 100_000, seed: 100_000 } : g))
      family({ goals })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Сначала подушка')
      expect(html).toContain(`До месяца обязательных списаний не хватает ${money(223_000)}.`)
      expect(html).toMatch(/>\s*Пополнить подушку\s*</)
    })

    it('пропущенный месяц — одна строка без упрёка; досрочка в прошлом месяце или месяц старта — строки нет', async () => {
      vi.setSystemTime(new Date('2026-10-15T07:00:00Z'))
      family()
      const missed = await renderScreen(DebtPlan, '/plan')
      expect(missed).toContain('В сентябре досрочки не было — план пересчитан от факта.')
      expect(missed).not.toMatch(/пропустил|просроч|не внесли|забыли/i)

      setActivePinia(createPinia())
      family({ payments: [prepay({})] })
      expect(await renderScreen(DebtPlan, '/plan')).not.toContain('досрочки не было')

      setActivePinia(createPinia())
      vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
      family()
      expect(await renderScreen(DebtPlan, '/plan')).not.toContain('досрочки не было')
    })

    it('шаг — подушка: строки о пропуске нет — досрочек в эту пору план и не ждёт', async () => {
      vi.setSystemTime(new Date('2026-10-15T07:00:00Z'))
      const goals = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 100_000, seed: 100_000 } : g))
      family({ goals })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).toContain('Сначала подушка')
      expect(html).not.toContain('досрочки не было')
    })

    it('на паузе нет взносов (все цели, кроме подушки, «не останавливать») — шага «0 ₸» нет', async () => {
      useAuthStore().setAuthData(authAs('member'))
      family({ plans: [planOf({ keptGoalIds: ['trip', 'car'] })] })
      const html = await renderScreen(DebtPlan, '/plan')
      expect(html).not.toContain('Шаг этого месяца')
      expect(html).not.toMatch(/>\s*Внести по плану\s*</)
    })
  })

  describe('PV-16 — «Внести по плану» одним нажатием (PlanStepAction)', () => {
    const tap = (s: Record<string, unknown>) => (s.tap as () => void)()
    beforeEach(() => useAuthStore().setAuthData(authAs('member')))

    it('кредит уже оплачивали — одно нажатие: досрочка шага с того же счёта, лист не открывается', async () => {
      const store = family()
      store.markPaid('credit', 'cc', 'a', { accountId: 'card' })
      const card = store.accounts[0].amount
      const html = await renderScreen(DebtPlan, '/plan', undefined, [screenMixin({}, tap)])
      expect(store.payments.filter((p) => p.kind === 'prepay')).toEqual([
        expect.objectContaining({ targetId: 'cc', amount: 100_000, planId: 'plan', accountId: 'card', mode: 'term' }),
      ])
      expect(store.accounts[0].amount).toBe(card - 100_000)
      expect(html).not.toContain('С какого счёта')
    })

    it('оплат не было — нажатие только открывает лист «С какого счёта», ничего не записано', async () => {
      const store = family()
      const html = await renderScreen(DebtPlan, '/plan', undefined, [screenMixin({}, tap)])
      expect(store.payments).toEqual([])
      expect(html).toContain('Досрочка по плану')
      expect(html).toContain('С какого счёта')
      expect(html).toContain('Не списывать — только отметить')
    })

    it('в листе выбрали «Не списывать» — запись без счёта, остаток карты прежний', async () => {
      const store = family()
      const card = store.accounts[0].amount
      await renderScreen(DebtPlan, '/plan', undefined, [
        screenMixin({ open: true, chosen: null }, (s) => (s.confirm as () => void)()),
      ])
      expect(store.payments).toEqual([expect.objectContaining({ kind: 'prepay', planId: 'plan', accountId: null })])
      expect(store.accounts[0].amount).toBe(card)
    })
  })
})
