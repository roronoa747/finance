import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import type { SyncDoc } from '../src/types/finance'
import { at, fakeServer, phone, setOnline, type FakeServer } from './support/family'

/**
 * Блок 5 паритета — оболочка (PV-20…PV-23): два телефона на одном фейковом сервере
 * (`support/family`). Браузерная проверка — на стенде §6.
 */
describe('e2e / PV Блок 5 — оболочка на двух телефонах', () => {
  const T0 = '2026-09-01T00:00:00.000Z'
  let server: FakeServer

  function seed(): SyncDoc {
    return {
      ...defaultSyncDoc(),
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
      goals: [
        { id: 'trip', name: 'Отпуск', need: 1_000_000, seed: 200_000, have: 200_000, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 },
      ],
      categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: T0 }],
    }
  }

  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-09-26T07:00:00Z')
    setOnline(true)
    server = fakeServer(seed())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('PV-21 — «Начать бюджет заново»', () => {
    it('A начал заново → у B (приложение открыто, фоновый pull) пустой документ и мастер', async () => {
      const A = await phone(server)
      const B = await phone(server)
      expect(on(B).store.setupDone).toBe(true)

      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)
      expect(server.data.people).toEqual([])
      expect(server.data.resetAt).toBe('2026-09-26T07:00:00.000Z')

      await on(B).store.pullHousehold(B.client)
      expect(B.store.householdDoc.goals).toEqual([])
      expect(B.store.setupDone).toBe(false)
    })

    it('приложение B было закрыто: первый круг при открытии — полный синк — не заливает старое обратно', async () => {
      const A = await phone(server)
      const B = await phone(server)

      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)

      // Раньше: пустой сервер = «первый выход в облако», B отправлял свой полный документ.
      await on(B).store.syncHousehold(B.client)
      expect(B.store.householdDoc.people).toEqual([])
      expect(B.store.setupDone).toBe(false)
      expect(server.data.people).toEqual([])
      expect(server.data.goals).toEqual([])

      await on(A).store.syncHousehold(A.client)
      expect(A.store.householdDoc.goals).toEqual([])
    })

    it('A уже прошёл мастер после сброса — у B только новое, старые цели и настройка не «воскресают»', async () => {
      const A = await phone(server)
      const B = await phone(server)

      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)
      at('2026-09-26T07:05:00Z')
      A.store.setPerson('a', { name: 'Ильяс', salary: 800_000, payday: 10, onboardedAt: '2026-09-26T07:05:00.000Z' })
      A.store.addGoal({ name: 'Машина', need: 5_000_000, monthly: 100_000, hue: 'blue' })
      await A.store.syncHousehold(A.client)

      at('2026-09-26T09:00:00Z')
      await on(B).store.syncHousehold(B.client)
      expect(B.store.householdDoc.goals.map((g) => g.name)).toEqual(['Машина'])
      expect(B.store.householdDoc.people.map((p) => [p.id, p.salary])).toEqual([['a', 800_000]])
      expect(B.store.householdDoc.categories).toEqual([])
      expect(server.data.goals.map((g) => g.name)).toEqual(['Машина'])
    })
  })
})
