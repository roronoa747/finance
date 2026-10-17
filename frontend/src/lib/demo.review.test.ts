import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { DEMO_REVIEW, demoReview, startDemo } from './demo'
import { monthKey } from './dates'
import { cushionCover, fundsOf, moneySettingsOf, stepCandidates } from './finance'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * AU-14 (бэклог «ИИ-польза», Р-13, Р-2): заготовка разбора демо v2 — без цифр (как живой ответ модели, где цифры
 * подставляет сервер), короткая, слова верны в любой день месяца; шаг — «Сделать» с кандидатом демо-семьи `cushion`,
 * он применим; «что ушло» — факты демо.
 */
describe('DEMO_REVIEW v2 — без цифр, верен в любой день, «Сделать» применим', () => {
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
      const finance = useFinanceStore()
      const key = monthKey()

      // Без цифр и коротко — как разбор v2 (Р-2: «Хорошо» и «Риск» до 14 слов, шаг до 8).
      for (const t of [DEMO_REVIEW.good, DEMO_REVIEW.risk, DEMO_REVIEW.step]) expect(t, t).not.toMatch(/\d/)
      for (const t of [DEMO_REVIEW.good, DEMO_REVIEW.risk]) expect(t.split(/\s+/).length, t).toBeLessThanOrEqual(14)
      expect(DEMO_REVIEW.step.split(/\s+/).length).toBeLessThanOrEqual(8)

      // Слова верны: в поездку план даёт каждый месяц; подушки — меньше месяца трат.
      const { state, ctx } = finance.planInput(key)
      const plan = finance.monthPlanOf(key)
      const trip = plan.queue.find((q) => q.name === 'Поездка в Японию')
      expect(trip?.given ?? 0, 'взнос в поездку').toBeGreaterThan(0)
      const cushion = fundsOf(state).cushion!
      const cover = cushionCover(plan.queue.find((q) => q.goalId === cushion.id), cushion, moneySettingsOf(state)).months
      expect(cover ?? 0, 'подушки на месяцев').toBeLessThan(1)

      // Шаг — кандидат кода `cushion`, тот же, что посчитает лист при открытии.
      const r = demoReview(finance.householdDoc, key, { book: useFxStore().book, uploads: useOperationsStore().uploads })
      expect(r.v).toBe(2)
      const fresh = stepCandidates(state, ctx).find((c) => c.id === 'cushion')
      expect(fresh, 'кандидат «Отложить в подушку»').toBeDefined()
      expect(r.step!.candidate).toEqual(fresh)
      // «Что ушло» — факты демо.
      expect(r.sent && 'facts' in r.sent && r.sent.facts.length).toBeGreaterThan(5)

      // «Сделать» → подтвердил: остатка уже нет, но кандидат заготовки тот же — у шага «✓ Сделано», а не пусто.
      finance.addPlanShift(fresh!.shift)
      expect(stepCandidates(finance.planInput(key).state, finance.planInput(key).ctx).find((c) => c.id === 'cushion')).toBeUndefined()
      const after = demoReview(finance.householdDoc, key, { book: useFxStore().book, uploads: useOperationsStore().uploads })
      expect(after.step!.candidate).toEqual(fresh)
    })
  }
})
