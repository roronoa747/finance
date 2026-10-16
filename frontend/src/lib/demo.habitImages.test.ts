import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { startDemo } from './demo'
import { monthKey } from './dates'
import { habitImages, interestImage, spendCompare } from './finance'
import { useFinanceStore } from '@/stores/finance'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * AU-30 (Р-13, Р-24): образы трат демо на своих данных — в любой день месяца у «Транспорта» образ такси (поездки a,
 * итоги — из его операций), у «Кафе» — доставка b (итоги руками); на «Долгах» — проценты банку за год. Точка «Кафе»
 * (AU-03) на месте: поездки «Транспорт» выше обычного не поднимают.
 */
describe('демо — образы трат', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-17T06:00:00Z', '2026-10-31T15:00:00Z', '2027-03-01T06:00:00Z']) {
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
      const finance = useFinanceStore()
      const { state, ctx } = finance.planInput(monthKey())
      const images = habitImages(state, monthKey())
      expect(images.map((i) => [i.categoryId, i.habit])).toEqual([['sc_transport', 'taxi'], ['sc_cafe', 'delivery']])
      // Цена такси — своя мечта «Машина» демо (Р-26); доставка — доля первой мечты очереди с «Перенести в мечту».
      expect(images[0].price).toMatchObject({ from: 'goal', name: 'Машина' })
      expect(images[1].action).toMatchObject({ kind: 'move', goalName: 'Поездка в Японию' })
      expect(interestImage(state)).not.toBeNull()
      // Продавцов и дат в общем документе нет — только счётчик и сумма.
      for (const t of finance.householdDoc.habitTotals ?? []) expect(Object.keys(t).sort()).toEqual(['amount', 'by', 'count', 'habit', 'id', 'period', 'updatedAt'])
      expect(JSON.stringify(finance.householdDoc.habitTotals)).not.toMatch(/yandex/i)
      expect(spendCompare(state, ctx).rows.filter((x) => x.over).map((x) => x.categoryId)).toEqual(['sc_cafe'])
    })
  }
})
