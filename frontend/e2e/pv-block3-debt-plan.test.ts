import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { activePlan } from '../src/lib/finance'
import type { Goal, SyncDoc } from '../src/types/finance'
import { at, fakeServer, phone, setOnline, type FakeServer } from './support/family'

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
})
