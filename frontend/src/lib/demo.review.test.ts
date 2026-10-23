import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { DEMO_REVIEW, demoReview, startDemo } from './demo'
import { monthKey } from './dates'
import { reviewCards, reviewWork } from './finance'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * FB-17 (бэклог «Фидбек», Р-27; v3 — «Разбор», RZ-09): заготовка разбора демо v4 — мысль без цифр (цифра — только крупная,
 * готовый факт кода), верна в любой день месяца; карточки — кода по демо-операциям участника `a` (`reviewCards`);
 * следующая за мыслью — «Не разобрано», нет её — первая; счётчик — `reviewWork` по карточкам; «что ушло» — факты и
 * карточки демо, без годовых сумм.
 */
describe('DEMO_REVIEW v4 — без цифр, верен в любой день, карточки кода с кнопкой', () => {
  for (const day of ['2026-10-01T06:00:00Z', '2026-10-10T06:00:00Z', '2026-10-20T06:00:00Z', '2026-10-31T15:00:00Z', '2028-02-29T06:00:00Z']) {
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
      const ops = useOperationsStore()
      const key = monthKey()

      // Слова — без цифр и без года («Фидбек», Р-8); заголовок 1–4 слова (Р-26).
      for (const t of [DEMO_REVIEW.title, DEMO_REVIEW.text]) expect(t, t).not.toMatch(/\d|за год|в год/)
      expect(DEMO_REVIEW.title.split(/\s+/).length).toBeLessThanOrEqual(4)

      const { state, ctx } = finance.planInput(key)
      const cards = reviewCards({ ...finance.householdDoc, ...state }, ctx, ops.all, 'a')
      expect(cards.length).toBeGreaterThan(0)
      // У каждой карточки — кнопка и цель.
      for (const c of cards) expect(c.button && c.target.kind, c.id).toBeTruthy()

      const r = demoReview(finance.householdDoc, finance.planInput(key), ops.all)
      expect(r.v).toBe(4)
      const unknown = cards.find((c) => c.kind === 'unknown')
      expect(r.next).toBe(unknown?.id ?? cards[0].id)
      // Мысль и крупная цифра — факт «не разобрано», когда карточка есть; нет её (первые дни) — мысли нет: она про траты
      // без раздела (ревью frontend 4б Н-6).
      if (unknown) {
        expect(r.lead).toMatchObject({ title: DEMO_REVIEW.title, text: DEMO_REVIEW.text })
        expect(r.lead!.figure).toMatchObject({ about: DEMO_REVIEW.figure, value: `${unknown.figure.value} %`, label: 'своих трат без раздела' })
      } else expect(r.lead).toBeUndefined()
      expect(r.work).toEqual(reviewWork(state, ctx, cards, cards, 'a'))
      expect(r.sent && 'cards' in r.sent && r.sent.cards.map((c) => c.kind)).toEqual(cards.map((c) => c.kind))
      expect(JSON.stringify(r.sent)).not.toMatch(/за год|в год/)
    })
  }
})
