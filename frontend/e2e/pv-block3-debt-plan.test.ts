import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { activePlan, budgetAmounts, planMonths, planStep } from '../src/lib/finance'
import { money } from '../src/lib/money'
import type { Goal, Payment, SyncDoc } from '../src/types/finance'
import GoalDetail from '../src/views/GoalDetail.vue'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import { useAuthStore } from '../src/stores/auth'
import { authAs } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import { at, fakeServer, phone, screen, tapPutDebt, setOnline, type FakeServer } from './support/family'

/** Цель на паузе ради плана — на экране цели: список целей теперь плитки «Мечт» без тега (B2C-18). */
/** Квадрат «План» (пивот 3, B2C-43): план включён — переключатель «Сначала долги». */
// Квадрат «План» — под «Подробнее» (Блок 14): переключатели плана месяца выше — не он.
const planOn = (html: string) => /role="switch" aria-checked="true"/.test(html)
/** Строка «закрыть кредит» в очереди «Месяца» (Блок 14, Р-82; Блок 15 — раздел «Цели и фонды»): какой долг досрочка закрывает первым. */
const debtsCard = async (p: { pinia: Pinia }) => {
  const html = await screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened: 'queue' })])
  const at = html.indexOf('data-queue="debt"')
  return at < 0 ? '' : html.slice(at, at + 700)
}

const pausedOn = async (p: { pinia: Pinia }, id: string) => (await screen(p.pinia, GoalDetail, `/goals/${id}`)).includes('На паузе ради плана')

/**
 * Блок 3 паритета — выбранный план «Сначала долги» (PV-14…PV-17): два телефона на одном
 * фейковом сервере (`support/family`). Браузерная проверка — на стенде §6.
 */
describe('e2e / PV Блок 3 — план «Сначала долги» на двух телефонах', () => {
  const T0 = '2026-09-01T00:00:00.000Z'
  let server: FakeServer

  const goal = (id: string, name: string, have: number, monthly: number): Goal => ({
    id, name, need: 3_000_000, seed: have, have, monthly, hue: 'teal', planPct: 0, movements: [], updatedAt: T0,
  })

  /** Семья стенда: три долга (два процентных), подушка полна, отпуск и машина встанут на паузу. */
  function seed(): SyncDoc {
    return {
      ...defaultSyncDoc(),
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
      categories: [
        { key: 'd1', name: 'Жильё', note: '', amount: 0, updatedAt: T0 },
        { key: 'd2', name: 'Кредиты', note: '', amount: 0, updatedAt: T0 },
        { key: 'd3', name: 'Цели', note: '', amount: 0, updatedAt: T0 },
        { key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: T0 },
      ],
      accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 2_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
      obligations: [
        { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
      ],
      credits: [
        { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
        { id: 'cc', name: 'Кредитка', note: '', principal: 300_000, principalSetAt: T0, annualRate: 0.4, payment: 25_000, day: 22, updatedAt: T0 },
        { id: 'inst', name: 'Рассрочка', note: '', principal: 240_000, principalSetAt: T0, annualRate: 0, payment: 20_000, day: 25, updatedAt: T0 },
      ],
      goals: [goal('cushion', 'Подушка', 400_000, 30_000), goal('trip', 'Отпуск', 50_000, 40_000), goal('car', 'Машина', 200_000, 60_000)],
    }
  }

  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    setOnline(true)
    server = fakeServer(seed())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('PV-14 — модель плана в документе', () => {
    it('документ старого клиента (без plans) читается; двое выбрали разные планы офлайн — после синка у обоих активен поздний', async () => {
      // Сервер хранит документ клиента до Блока 3: ключа plans нет вовсе.
      delete server.data.plans
      const A = await phone(server)
      const B = await phone(server)
      expect(A.store.plans).toEqual([])

      setOnline(false)
      at('2026-09-24T08:00:00Z')
      const planA = on(A).store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 0 }, 'a')!
      at('2026-09-24T08:30:00Z')
      const planB = on(B).store.choosePlan({ keptGoalIds: ['car'], cushionGoalId: 'cushion', months: 12, lump: 0 }, 'b')!
      expect(planA.id).not.toBe(planB.id)

      setOnline(true)
      await on(A).store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)
      await on(A).store.syncHousehold(A.client)

      for (const p of [A, B]) {
        expect(p.store.activePlan?.id).toBe(planB.id)
        expect(p.store.plans.find((x) => x.id === planA.id)?.status).toBe('cancelled')
      }
      expect(activePlan(server.data.plans)?.id).toBe(planB.id)
      expect(server.data.plans).toHaveLength(2)
    })
  })

  describe('PV-15 — выбор плана и пауза целей', () => {
    it('A выбирает план → у B цели на паузе и «Досрочно по плану», «Свободно» прежнее; A отменяет → у B всё вернулось', async () => {
      const A = await phone(server)
      const B = await phone(server)
      const freeBefore = budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5

      at('2026-09-24T08:00:00Z')
      on(A).store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 0 }, 'a')
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)

      expect(await pausedOn(B, 'trip')).toBe(true)
      expect(await pausedOn(B, 'cushion')).toBe(false)
      expect(await screen(B.pinia, GoalDetail, '/goals/car')).toContain(`Взнос ${money(60_000)} идёт в досрочку`)

      // «Досрочно по плану» — шаг месяца квадрата «План» (Бюджета нет, B2C-45).
      expect(await screen(B.pinia, Money, '/money/debts')).toContain(`${money(100_000)} досрочно`)
      expect(budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5).toBe(freeBefore)
      expect(planOn(await screen(B.pinia, Money, '/money/debts'))).toBe(true)

      at('2026-09-24T09:00:00Z')
      on(A).store.cancelPlan()
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(await pausedOn(B, 'trip')).toBe(false)
      expect(planOn(await screen(B.pinia, Money, '/money/debts'))).toBe(false)
      expect(B.store.plans).toHaveLength(1)
      expect(B.store.plans[0].status).toBe('cancelled')
    })
  })

  describe('PV-16 — шаг плана одним нажатием', () => {
    it('A вносит шаг со счёта прошлой оплаты → у B остаток и карта меньше, шаг «внесено»; следующий месяц — новый шаг', async () => {
      const A = await phone(server)
      const B = await phone(server)
      on(A).store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 0 }, 'a')
      // Кредитку уже оплачивали с карты — счёт шага не спрашивается.
      A.store.markPaid('credit', 'cc', 'a', { accountId: 'card' })
      const ccBefore = A.store.credits.find((c) => c.id === 'cc')!.principal
      const cardBefore = A.store.accounts[0].amount

      at('2026-09-24T09:00:00Z')
      const rec = A.store.applyPlanStep('a')!
      expect(rec).toMatchObject({ kind: 'prepay', targetId: 'cc', amount: 100_000, accountId: 'card', mode: 'term', period: '2026-09' })
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)

      expect(B.store.credits.find((c) => c.id === 'cc')!.principal).toBe(ccBefore - 100_000)
      expect(B.store.accounts[0].amount).toBe(cardBefore - 100_000)
      // Пивот 3 (B2C-43): шаг плана — в квадрате «План», строка «Платежей» его не печатает.
      expect(await screen(B.pinia, Money, '/money/debts')).toContain(`внесено по плану · ${money(100_000)}`)
      expect(await screen(B.pinia, Money, '/money')).not.toContain('внесено по плану')
      // Второй раз в том же месяце шаг не вносится — ни у A, ни у B.
      expect(on(A).store.applyPlanStep('a')).toBeNull()
      expect(on(B).store.applyPlanStep('b', { accountId: 'card' })).toBeNull()

      // Октябрь: новый шаг — снова 100 000 в самую дорогую кредитку; сентябрьский — в факте.
      at('2026-10-05T07:00:00Z')
      const planB = await screen(B.pinia, Money, '/money/debts')
      expect(planB).toContain('Шаг октября')
      expect(planB).toContain(`${money(100_000)} досрочно`)
      expect(planB).not.toMatch(/>\s*Шаг сделан\s*</) // Блок 16 (Р-110): кнопки шага нет — «Отложил» в «Месяце»
      expect(planB).not.toContain('досрочки не было')
      const next = on(B).store.applyPlanStep('b')!
      expect(next).toMatchObject({ period: '2026-10', targetId: 'cc', accountId: 'card' })
    })
  })

  describe('PV-17 — конец плана', () => {
    it('досрочка на весь остаток последнего процентного долга → у обоих план в истории с итогом, паузы сняты', async () => {
      // Один процентный долг — кредитка; рассрочка 0% план не держит.
      server.data.credits = server.data.credits.filter((c) => c.id !== 'loan')
      const A = await phone(server)
      const B = await phone(server)
      on(A).store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 12, lump: 0 }, 'a')
      const step = A.store.applyPlanStep('a', { accountId: 'card' })!
      expect(step.amount).toBe(100_000)
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(await pausedOn(B, 'trip')).toBe(true)

      // Остаток кредитки — одной досрочкой с телефона B.
      at('2026-09-26T07:00:00Z')
      const left = B.store.credits.find((c) => c.id === 'cc')!.principal
      on(B).store.applyPrepayment('cc', 'b', { amount: left, mode: 'term', accountId: 'card' })
      expect(B.store.activePlan).toBeNull()
      expect(B.store.plans[0]).toMatchObject({ status: 'done', result: { savedInterest: step.saved } })
      await B.store.syncHousehold(B.client)
      await on(A).store.pullHousehold(A.client)

      for (const p of [A, B]) {
        expect(p.store.activePlan).toBeNull()
        expect(p.store.plans[0].status).toBe('done')
        expect(await pausedOn(p, 'trip')).toBe(false)
        const plan = await screen(p.pinia, Money, '/money/debts')
        expect(plan).toContain('Долги с процентами закрыты — цели возобновились')
        expect(plan).toContain(`Сентябрь 2026: сэкономили ${money(step.saved ?? 0)} процентов`)
      }
    })
  })

  /**
   * Приёмка Блока 3: критерий брифа одной цепочкой, viewer, «снизить платёж», фаза подушки,
   * пропуск месяца. Нажатия — обработчиками экранов (`screenMixin`), как в браузере.
   */
  describe('Приёмка Блока 3', () => {
    const draft = { keptGoalIds: [], cushionGoalId: 'cushion', months: 24 as const, lump: 0 }

    /** Первая сумма «N ₸» после подписи. */
    const amountAfter = (html: string, label: string) => {
      const i = html.indexOf(label)
      if (i < 0) return null
      const m = html.slice(i + label.length).match(/(\d[\d\s  ]*?)[\s  ]*₸/)
      return m ? Number(m[1].replace(/\D/g, '')) : null
    }
    /** Кусок экрана от одной подписи до другой. */
    const between = (html: string, from: string, to: string) => {
      const i = html.indexOf(from)
      const j = html.indexOf(to, i)
      if (i < 0 || j < 0) throw new Error(`нет «${i < 0 ? from : to}» в разметке`)
      return html.slice(i, j)
    }
    /** Кнопка с подписью (текст кнопки целиком). */
    const button = (label: string) => new RegExp(`>\\s*${label}\\s*<`)
    /** Живые досрочки по плану (любому) — шаг месяца один на семью. */
    const planPrepays = (payments: Payment[]) => payments.filter((p) => p.kind === 'prepay' && !p.deletedAt && !!p.planId)

    it('критерий брифа: A выбрал план → у B пауза и «Досрочно по плану» → шаг одним нажатием → факт у обоих → отмена → история; повторный выбор в том же месяце шаг не повторяет', async () => {
      const A = await phone(server)
      const B = await phone(server)
      const freeBefore = budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5
      expect(freeBefore).toBeGreaterThan(0)

      // A выбирает план с подушкой — у B после синка отпуск и машина на паузе, подушка — нет.
      at('2026-09-24T08:00:00Z')
      const plan = on(A).store.choosePlan(draft, 'a')!
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(await pausedOn(B, 'trip')).toBe(true)
      expect(await pausedOn(B, 'car')).toBe(true)
      expect(await pausedOn(B, 'cushion')).toBe(false)
      // «Досрочно по плану» — взносы пауз (40 000 + 60 000); «Свободно» прежнее.
      expect(await screen(B.pinia, Money, '/money/debts')).toContain(`${money(100_000)} досрочно`)
      expect(budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5).toBe(freeBefore)

      // Кредитку A уже оплачивал с карты — шаг «Отложил» у строки долга в «Месяце» без листа счёта (Блок 16, Р-110).
      on(A).store.markPaid('credit', 'cc', 'a', { accountId: 'card' })
      expect(planStep(plan, A.store.planState(), '2026-09')).toMatchObject({ kind: 'prepay', creditId: 'cc', amount: 100_000, applied: null })
      const ccBefore = A.store.credits.find((c) => c.id === 'cc')!.principal
      const cardBefore = A.store.accounts[0].amount
      at('2026-09-24T09:00:00Z')
      await screen(A.pinia, Month, '/month', undefined, [tapPutDebt()])
      const steps = planPrepays(A.store.payments)
      expect(steps).toHaveLength(1)
      const rec = steps[0]
      expect(rec).toMatchObject({ targetId: 'cc', amount: 100_000, accountId: 'card', mode: 'term', planId: plan.id, period: '2026-09' })
      const saved = rec.saved ?? 0
      expect(saved).toBeGreaterThan(0)
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)

      // У B остаток кредитки и карта меньше ровно на шаг.
      expect(B.store.credits.find((c) => c.id === 'cc')!.principal).toBe(ccBefore - 100_000)
      expect(B.store.accounts[0].amount).toBe(cardBefore - 100_000)
      // Экран плана у обоих: шаг внесён, факт месяца и «Уже сэкономили» одинаковые.
      const planA = await screen(A.pinia, Money, '/money/debts')
      const planB = await screen(B.pinia, Money, '/money/debts')
      for (const html of [planA, planB]) {
        expect(html).toContain('внесено по плану')
        expect(html).not.toMatch(button('Шаг сделан'))
        expect(amountAfter(html, 'Уже сэкономили')).toBe(saved)
      }
      const monthsA = between(planA, 'Шаги по месяцам', 'При выборе ожидали')
      expect(between(planB, 'Шаги по месяцам', 'При выборе ожидали')).toBe(monthsA)
      expect(monthsA).toContain('сен 2026')
      expect(monthsA).toContain('Кредитка')
      // План и факт сентября — одна и та же сумма шага.
      expect(monthsA.split(money(100_000))).toHaveLength(3)

      // A отменяет — у B цели без паузы, «Плана нет» и история с итогом.
      at('2026-09-24T10:00:00Z')
      on(A).store.cancelPlan()
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(await pausedOn(B, 'trip')).toBe(false)
      expect(budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5).toBe(freeBefore)
      const cancelled = await screen(B.pinia, Money, '/money/debts')
      expect(planOn(cancelled)).toBe(false)
      expect(cancelled).toContain(`Сентябрь 2026: отменён, сэкономили ${money(saved)}`)
      expect(B.store.plans).toEqual([expect.objectContaining({ id: plan.id, status: 'cancelled', result: { savedInterest: saved } })])

      // Выбрали снова в том же месяце — шаг сентября уже внесён: ни второй досрочки, ни кнопки.
      at('2026-09-24T11:00:00Z')
      const again = on(A).store.choosePlan(draft, 'a')!
      expect(again.id).not.toBe(plan.id)
      expect(A.store.applyPlanStep('a')).toBeNull()
      expect(A.store.applyPlanStep('a', { accountId: 'card' })).toBeNull()
      const planAgain = await screen(A.pinia, Money, '/money/debts')
      expect(planAgain).toContain(`внесено по плану · ${money(100_000)}`)
      expect(planAgain).not.toMatch(button('Шаг сделан'))
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(B.store.activePlan?.id).toBe(again.id)
      expect(B.store.applyPlanStep('b', { accountId: 'card' })).toBeNull()
      expect(planPrepays(B.store.payments)).toHaveLength(1)
      expect(B.store.accounts[0].amount).toBe(cardBefore - 100_000)
    })

    it('viewer (Р-12): выбрать, отменить и внести шаг нельзя — документ прежний; на экранах плана и Капитала кнопок нет, тексты шага видны', async () => {
      const A = await phone(server)
      const V = await phone(server)
      on(V)
      useAuthStore().setAuthData(authAs('viewer', 'b'))
      // Без плана viewer его и не выберет.
      expect(V.store.choosePlan(draft, 'b')).toBeNull()
      expect(V.store.plans).toEqual([])

      at('2026-09-24T08:00:00Z')
      const plan = on(A).store.choosePlan(draft, 'a')!
      await A.store.syncHousehold(A.client)
      await on(V).store.pullHousehold(V.client)
      expect(V.store.activePlan?.id).toBe(plan.id)

      const doc = JSON.stringify(V.store.householdDoc)
      expect(V.store.choosePlan({ keptGoalIds: ['car'], cushionGoalId: null, months: 12, lump: 0 }, 'b')).toBeNull()
      V.store.cancelPlan()
      expect(V.store.applyPlanStep('b', { accountId: 'card' })).toBeNull()
      expect(V.store.applyPlanStep('b')).toBeNull()
      expect(JSON.stringify(V.store.householdDoc)).toBe(doc)
      expect(V.store.unsent).toBe(false)
      expect(V.store.activePlan?.id).toBe(plan.id)

      // Квадрат «План»: шаг и пауза видны; «Шаг сделан», «Изменить режим», выключение — нет (переключатель неактивен).
      const planV = await screen(V.pinia, Money, '/money/debts')
      expect(planOn(planV)).toBe(true)
      expect(planV).toMatch(/role="switch" aria-checked="true"[^>]*disabled/)
      expect(between(planV, 'Шаг сентября', 'Копить или гасить?')).toContain(`${money(100_000)} досрочно`)
      expect(planV).toContain('в «Кредитка»')
      expect(planV).not.toMatch(button('Шаг сделан'))
      expect(planV).not.toContain('Изменить режим')
      expect(planV).not.toMatch(button('Отменить план'))
      expect(await screen(V.pinia, Money, '/money')).not.toMatch(button('Шаг сделан'))
      expect(await pausedOn(V, 'trip')).toBe(true)

      // Шаг внёс участник — viewer видит «внесено», по-прежнему без кнопок.
      at('2026-09-24T09:00:00Z')
      on(A).store.applyPlanStep('a', { accountId: 'card' })
      await A.store.syncHousehold(A.client)
      await on(V).store.pullHousehold(V.client)
      expect(await screen(V.pinia, Money, '/money/debts')).toContain(`внесено по плану · ${money(100_000)}`)
    })

    it('фаза подушки: подушка ниже месяца списаний — шаг «подушка» (Ритуал, экран плана); пополнили до месяца — шаг досрочкой в самый дорогой долг', async () => {
      // Подушка 250 000 при месяце списаний 323 000 (аренда 220 000 + платежи 58 000 + 25 000 + 20 000);
      // аренда дешевеет с октября — Ритуалу есть что распределить.
      server.data.goals = server.data.goals.map((g) => (g.id === 'cushion' ? { ...g, seed: 250_000, have: 250_000 } : g))
      server.data.obligations[0].versions.push({ from: '2026-10', amount: 200_000 })
      const A = await phone(server)
      const B = await phone(server)
      at('2026-09-24T08:00:00Z')
      const plan = on(A).store.choosePlan(draft, 'a')!
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)

      // Не хватает 73 000 — из 100 000 плана в подушку 73 000.
      expect(planStep(plan, B.store.planState(), '2026-09')).toEqual({ kind: 'cushion', goalId: 'cushion', amount: 73_000, missing: 73_000 })
      // План месяца (Блок 14, Р-82): при шаге «подушка» карточке долга нечего вносить — она «по плану», не «задайте сумму».
      const ritual = await debtsCard(B)
      expect(ritual).toContain('по плану «Сначала долги»')
      // (прежний Ритуал: «Сначала подушка: не хватает N» — сумма шага в «Деньги · План» ниже)
      const cushionPlan = await screen(B.pinia, Money, '/money/debts')
      expect(cushionPlan).toContain(`сначала подушка: не хватает ${money(73_000)}`)
      expect(cushionPlan).toContain('Подушка плана')
      expect(cushionPlan).toMatch(button('Пополнить подушку'))
      expect(cushionPlan).not.toMatch(button('Шаг сделан'))
      expect(cushionPlan).not.toContain('досрочки не было')
      // Шаг подушки — подсказка: досрочку он не вносит.
      expect(on(B).store.applyPlanStep('b', { accountId: 'card' })).toBeNull()

      // B пополняет подушку до месяца списаний — у A шаг стал досрочкой в кредитку (40%).
      at('2026-09-24T09:00:00Z')
      on(B).store.contribute('cushion', 73_000, 'b')
      await B.store.syncHousehold(B.client)
      await on(A).store.pullHousehold(A.client)
      expect(A.store.goals.find((g) => g.id === 'cushion')!.have).toBe(323_000)
      const next = planStep(A.store.activePlan!, A.store.planState(), '2026-09')
      expect(next).toMatchObject({ kind: 'prepay', creditId: 'cc', applied: null })
      const amount = next.kind === 'prepay' ? next.amount : 0
      expect(amount).toBeGreaterThan(0)
      const prepayPlan = await screen(A.pinia, Money, '/money/debts')
      expect(prepayPlan).not.toContain('сначала подушка')
      expect(prepayPlan).not.toMatch(button('Шаг сделан')) // Блок 16 (Р-110): шаг — «Отложил» в «Месяце»
      expect(between(prepayPlan, 'Шаг сентября', 'Копить или гасить?')).toContain(`${money(amount)} досрочно`)
      expect(prepayPlan).toContain('в «Кредитка»')
      const ritualA = await debtsCard(A)
      expect(ritualA).not.toContain('сначала подушка')
      expect(ritualA).toContain('Кредитка')
      expect(ritualA).not.toContain('по плану «Сначала долги»')
    })

    it('пропуск месяца: план с июля, шаг июля внесён, август пропущен — в сентябре строка без упрёка, шаг — сумма одного месяца', async () => {
      // Якоря остатков — до старта плана, иначе июльская досрочка оказалась бы до сверки.
      const JUNE = '2026-06-01T00:00:00.000Z'
      server = fakeServer(JSON.parse(JSON.stringify(seed()).split(T0).join(JUNE)))
      at('2026-07-10T07:00:00Z')
      const A = await phone(server)
      const B = await phone(server)
      const plan = on(A).store.choosePlan(draft, 'a')!
      const july = A.store.applyPlanStep('a', { accountId: 'card' })!
      expect(july).toMatchObject({ period: '2026-07', targetId: 'cc', amount: 100_000 })
      await A.store.syncHousehold(A.client)

      // Август прошёл без досрочки. Сентябрь: B открывает план.
      at('2026-09-15T07:00:00Z')
      await on(B).store.pullHousehold(B.client)
      const planB = await screen(B.pinia, Money, '/money/debts')
      expect(planB).toContain('В августе досрочки не было — план пересчитан от факта.')
      expect(planB).not.toContain('В июле досрочки не было')
      expect(planMonths(plan, B.store.planState(), '2026-09')).toEqual([
        { period: '2026-07', planned: 100_000, fact: 100_000, creditId: 'cc' },
        { period: '2026-08', planned: 100_000, fact: 0, creditId: null },
        { period: '2026-09', planned: 100_000, fact: 0, creditId: 'cc' },
      ])
      const months = between(planB, 'Шаги по месяцам', 'При выборе ожидали')
      for (const m of ['июл 2026', 'авг 2026', 'сен 2026']) expect(months).toContain(m)
      // Пауза шла три месяца: отпуск 40 000 × 3.
      expect(planB).toContain(`«Отпуск»: ${money(120_000)} не внесено, дата сдвинулась на 3 мес.`)

      // Шаг сентября — сумма одного месяца: пропуск не копится.
      expect(planStep(plan, B.store.planState(), '2026-09')).toMatchObject({ kind: 'prepay', creditId: 'cc', amount: 100_000, applied: null })
      const stepCard = between(planB, 'Шаг сентября', 'Копить или гасить?')
      expect(stepCard).toContain(`${money(100_000)} досрочно`)
      expect(stepCard).not.toContain(money(200_000))
      expect(stepCard).not.toMatch(button('Шаг сделан')) // Блок 16 (Р-110)
      const september = B.store.applyPlanStep('b')!
      expect(september).toMatchObject({ period: '2026-09', targetId: 'cc', amount: 100_000, accountId: 'card', planId: plan.id })
      expect(B.store.credits.find((c) => c.id === 'cc')!.principal).toBe(300_000 - 200_000)
    })
  })
})
