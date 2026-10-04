// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from './finance'
import { useAuthStore } from './auth'
import { mergeDocs } from '@/lib/merge'
import { authAs } from '@/test/planFamily'
import type { Person } from '@/types/finance'

/**
 * Критик Блока 13 (B2C-78, «Тесты» — стор): версия оклада с валютой пишет `currency`/`rate`; исправление
 * валютного оклада не кладёт сумму в евро в тенговый `salary`; слияние версий — как прежде (поздняя правка
 * человека целиком).
 */

const T0 = '2026-09-01T00:00:00.000Z'
// Свежий объект на тест: стор правит человека документа на месте.
const person = (): Person => ({ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 })

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T08:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  setActivePinia(createPinia())
  useAuthStore().setAuthData(authAs('member'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('стор: оклад в валюте', () => {
  it('amendSalary с валютой — версия с currency и rate; тенге — без них', () => {
    const store = useFinanceStore()
    store.setHouseholdDoc({ ...defaultSyncDoc(), people: [person()] }, 1)
    store.amendSalary('a', '2025-10', 1_500, 'переезд', { currency: 'EUR', rate: 505.5 })
    store.amendSalary('a', '2027-01', 800_000, undefined, { currency: 'KZT', rate: 1 })
    expect(store.people[0].salaryVersions).toEqual([
      { from: '2000-01', amount: 700_000 },
      { from: '2025-10', amount: 1_500, reason: 'переезд', currency: 'EUR', rate: 505.5 },
      { from: '2027-01', amount: 800_000, reason: undefined },
    ])
  })

  it('correctSalary валютного оклада правит евро версии, тенговый salary не трогает', () => {
    const store = useFinanceStore()
    store.setHouseholdDoc({ ...defaultSyncDoc(), people: [{ ...person(), salaryVersions: [{ from: '2025-10', amount: 1_500, currency: 'EUR', rate: 505.5 }] }] }, 1)
    store.correctSalary('a', 1_600)
    expect(store.people[0].salary).toBe(700_000)
    expect(store.people[0].salaryVersions).toEqual([{ from: '2025-10', amount: 1_600, currency: 'EUR', rate: 505.5 }])
  })

  it('слияние: валютная версия с другого телефона (позже) приходит целиком', () => {
    const local = { ...defaultSyncDoc(), people: [{ ...person() }] }
    const remote = {
      ...defaultSyncDoc(),
      people: [{ ...person(), salaryVersions: [{ from: '2025-10', amount: 1_500, currency: 'EUR' as const, rate: 505.5 }], updatedAt: '2026-10-02T00:00:00.000Z' }],
    }
    expect(mergeDocs(local, remote).people[0].salaryVersions).toEqual(remote.people[0].salaryVersions)
  })
})
