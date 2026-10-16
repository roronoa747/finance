import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { startDemo } from './demo'
import { monthKey } from './dates'
import { spendCompare } from './finance'
import { useFinanceStore } from '@/stores/finance'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * AU-03 (Р-5, Р-13): «Траты» демо на своих данных — в любой день месяца у «Кафе и рестораны» точка выше обычного и
 * «до плана» в мечту; «обычно у вас» — у ≥ 2 разделов (три полных прошлых месяца у обоих участников).
 */
describe('демо — траты в сравнении', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-16T06:00:00Z', '2026-10-31T15:00:00Z', '2027-02-28T06:00:00Z', '2027-03-01T06:00:00Z', '2027-06-15T06:00:00Z']) {
    it(day, async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(day))
      const map = new Map<string, string>()
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, String(v)),
        removeItem: (k: string) => map.delete(k),
        clear: () => map.clear(),
      })
      setActivePinia(createPinia())
      expect(startDemo()).toBe(true)
      await nextTick()
      await nextTick()
      const { state, ctx } = useFinanceStore().planInput(monthKey())
      const r = spendCompare(state, ctx)
      expect(r.usualFrom).toHaveLength(3)
      expect(r.rows.filter((x) => x.usual !== null && x.usual > 0).length).toBeGreaterThanOrEqual(2)
      expect(r.rows.filter((x) => x.over).map((x) => x.categoryId)).toEqual(['sc_cafe'])
      const cafe = r.rows.find((x) => x.categoryId === 'sc_cafe')!
      expect(cafe.advice?.amount).toBeGreaterThan(0)
      expect(cafe.advice?.goalName).toBeTruthy()
    })
  }
})
