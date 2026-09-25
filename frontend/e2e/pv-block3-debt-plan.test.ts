import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { activePlan, budgetAmounts } from '../src/lib/finance'
import { money } from '../src/lib/money'
import type { Goal, SyncDoc } from '../src/types/finance'
import Goals from '../src/views/Goals.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Budget from '../src/views/Budget.vue'
import Overview from '../src/views/Overview.vue'
import DebtPlan from '../src/views/DebtPlan.vue'
import { at, fakeServer, phone, screen, setOnline, type FakeServer } from './support/family'

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
    /** Строка «Куда уходит» / легенды: сумма после названия. */
    const amountAfter = (html: string, label: string) => {
      const at = html.indexOf(label)
      if (at < 0) return null
      const m = html.slice(at + label.length).match(/(\d[\d\s\u00a0\u202f]*?)[\s\u00a0\u202f]*₸/)
      return m ? Number(m[1].replace(/\D/g, '')) : null
    }

    it('A выбирает план → у B цели на паузе и «Досрочно по плану», «Свободно» прежнее; A отменяет → у B всё вернулось', async () => {
      const A = await phone(server)
      const B = await phone(server)
      const freeBefore = budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5

      at('2026-09-24T08:00:00Z')
      on(A).store.choosePlan({ keptGoalIds: [], cushionGoalId: 'cushion', months: 24, lump: 0 }, 'a')
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)

      const goals = await screen(B.pinia, Goals, '/goals')
      const trip = goals.slice(goals.indexOf('>Отпуск<'))
      expect(trip.slice(0, trip.indexOf('</div>'))).toContain('На паузе ради плана')
      const cushion = goals.slice(goals.indexOf('>Подушка<'))
      expect(cushion.slice(0, cushion.indexOf('</div>'))).not.toContain('На паузе ради плана')
      expect(await screen(B.pinia, GoalDetail, '/goals/car')).toContain(`Взнос ${money(60_000)} идёт в досрочку`)

      const budget = await screen(B.pinia, Budget, '/budget')
      expect(amountAfter(budget, '>Досрочно по плану</div>')).toBe(100_000)
      const overview = await screen(B.pinia, Overview, '/')
      expect(amountAfter(overview, '>Досрочно по плану</span>')).toBe(100_000)
      expect(budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits }).d5).toBe(freeBefore)
      expect(await screen(B.pinia, DebtPlan, '/plan')).toContain('План «Сначала долги»')

      at('2026-09-24T09:00:00Z')
      on(A).store.cancelPlan()
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(await screen(B.pinia, Goals, '/goals')).not.toContain('На паузе ради плана')
      expect(await screen(B.pinia, Budget, '/budget')).not.toContain('Досрочно по плану')
      expect(await screen(B.pinia, DebtPlan, '/plan')).toContain('Плана нет')
      expect(B.store.plans).toHaveLength(1)
      expect(B.store.plans[0].status).toBe('cancelled')
    })
  })
})
