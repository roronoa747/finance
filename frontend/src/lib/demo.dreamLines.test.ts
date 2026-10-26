import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { startDemo } from './demo'
import { monthKey } from './dates'
import { dreamShift, firstDebt, returnTermShift, shiftLabel } from './finance'
import { useFinanceStore } from '@/stores/finance'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function demoAt(day: string) {
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
  return useFinanceStore()
}

/**
 * AU-08 (Р-6, Р-7, Р-13): демо на своих данных — у героя «Поездка в Японию» метка «+2 недели · кафе и рестораны выше
 * плана» (снимок дал на 40 000 больше, при 100 000 в месяц — 12 дней) и «Вернуть срок» в любой день месяца; «Долги» —
 * первым Автокредит (19 % дороже ремонта 14 %); «Хватит?» на всё, что на счетах, — строка «тесно …».
 */
describe('демо — мечта и строки', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-16T06:00:00Z', '2026-10-31T15:00:00Z', '2027-02-28T06:00:00Z']) {
    it(`метка героя и «Вернуть срок» — ${day}`, async () => {
      const f = await demoAt(day)
      const { state, ctx } = f.planInput(monthKey())
      const snap = f.termSnapFor(monthKey())
      expect(f.heroGoal?.id).toBe('g-trip')
      const shift = dreamShift(state, ctx, snap, 'g-trip')
      expect(shift).toEqual({ days: 12, reason: 'spend', name: 'Кафе и рестораны' })
      expect(shiftLabel(shift!)).toBe('+2\u00a0недели · кафе и рестораны выше плана')
      expect(returnTermShift(state, ctx, snap, 'g-trip')).toMatchObject({ kind: 'move', shift: { from: 'rest', to: { goalId: 'g-trip' }, amount: 40_000 } })
      expect(firstDebt(f.planState())).toEqual({ name: 'Автокредит', rate: 19 })
    })
  }
})
