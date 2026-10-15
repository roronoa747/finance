import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { buildMonthSummary, summaryNumbers } from './aiSummary'
import { DEMO_REVIEW, startDemo } from './demo'
import { monthKey } from './dates'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'

/**
 * Числа текста по-русски: «600 000 ₸», «19%», «1,5» — как их читает проверка сервера (`ai.CheckNumbers`): разряды
 * через пробел или NBSP, дробь через запятую; 1–3 — счёт.
 */
function textNumbers(text: string): number[] {
  return [...text.matchAll(/\d{1,3}(?:[\s  ]\d{3})+(?![\d])|\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(/\s/g, '').replace(',', '.')))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** AI-10 (Р-10, Р-3): заготовка разбора демо — только числа сводки демо-семьи, в любой день месяца. */
describe('DEMO_REVIEW — числа ⊂ сводке демо', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-16T06:00:00Z', '2026-10-31T15:00:00Z', '2027-02-28T06:00:00Z', '2027-06-15T06:00:00Z']) {
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
      const s = buildMonthSummary(useFinanceStore().householdDoc, monthKey(), new Date(), {
        book: useFxStore().book,
        uploads: useOperationsStore().uploads,
      })
      // Слова заготовки верны и без чисел: «покрыты» — нехватки нет, «самый дорогой» — у автокредита наибольшая ставка.
      expect(s.short).toBe(0)
      expect(Math.max(...s.debts.items.map((d) => d.ratePercent ?? 0))).toBe(s.debts.items.find((d) => d.name === 'Автокредит')!.ratePercent)
      const allowed = new Set([1, 2, 3, ...summaryNumbers(s).map(Math.abs)])
      const texts = [DEMO_REVIEW.good, DEMO_REVIEW.risk, ...DEMO_REVIEW.steps.map((x) => x.text)]
      for (const t of texts) for (const n of textNumbers(t)) expect(allowed.has(n), `${n} в «${t}»`).toBe(true)
      // Сито работает: число не из сводки ловится.
      expect(textNumbers('215 000 ₸ и 16,5%')).toEqual([215000, 16.5])
    })
  }
})
