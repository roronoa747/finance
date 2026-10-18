import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { DEMO_REVIEW, demoReview, startDemo } from './demo'
import { monthKey } from './dates'
import { cushionCover, findMonth, fundsOf, moneySettingsOf, reviewFindings, reviewWork, stepCandidates } from './finance'
import { money } from './money'
import { useFinanceStore } from '@/stores/finance'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * RZ-09 (бэклог «Разбор», Р-12; v2 — AU-14): заготовка разбора демо v3 — слова без цифр (цифры — только крупная цифра
 * совета, готовый факт кода), верны в любой день месяца; три совета с кнопкой: утечка «Магазин у дома» и новая подписка —
 * «Открыть» покупки продавца, подушка — «Сделать» (кандидат `cushion` применим, после подтверждения — тот же); счётчик —
 * `reviewWork` по находкам советов; «что ушло» — факты демо. Находки демо — утечка, новое списание, «раздуло» кафе.
 */
describe('DEMO_REVIEW v3 — без цифр, верен в любой день, у каждого совета кнопка', () => {
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
      const key = monthKey()

      // Слова — без цифр; заголовок совета 1–4 слова (Р-12).
      const words = [DEMO_REVIEW.where, ...DEMO_REVIEW.advices.flatMap((a) => [a.title, a.text])]
      for (const t of words) expect(t, t).not.toMatch(/\d/)
      for (const a of DEMO_REVIEW.advices) expect(a.title.split(/\s+/).length, a.title).toBeLessThanOrEqual(4)

      // Находки демо: утечка «Магазин у дома» (≈ 250 000 ₸ в год, ≈ 12 % поездки), новая подписка; «раздуло» кафе — когда
      // месяц находок текущий (в первые дни месяца он прошлый — там кафе как обычно).
      const { state, ctx } = finance.planInput(key)
      const findings = reviewFindings(state, ctx)
      const leak = findings.find((f) => f.kind === 'leak')
      expect(leak).toMatchObject({ name: 'Магазин у дома', yearly: 248_400, image: { kind: 'dream', name: 'Поездка в Японию', share: 12 } })
      expect(findings.find((f) => f.kind === 'recurring')).toMatchObject({ name: 'Онлайн-кинотеатр', amount: 2_490 })
      if (findMonth(ctx) === key) expect(findings.find((f) => f.kind === 'grew')).toMatchObject({ categoryId: 'sc_cafe', why: { kind: 'purchases' } })
      // «Подушки почти нет» — верно.
      const plan = finance.monthPlanOf(key)
      const cushion = fundsOf(state).cushion!
      expect(cushionCover(plan.queue.find((q) => q.goalId === cushion.id), cushion, moneySettingsOf(state)).months ?? 0).toBeLessThan(1)

      // Заготовка: три совета с кнопкой, крупная цифра — факт кода у первых двух.
      const r = demoReview(finance.householdDoc, finance.planInput(key))
      expect(r.v).toBe(3)
      expect(r.where).toBe(DEMO_REVIEW.where)
      expect(r.advices!.map((a) => a.title)).toEqual(['Магазин у дома', 'Новое списание', 'Отложить в подушку'])
      expect(r.advices!.map((a) => a.action.kind)).toEqual(['open', 'open', 'do'])
      expect(r.advices![0].figure).toEqual({ about: 'частые траты у «Магазин у дома» — за год', value: money(248_400) })
      expect(r.advices![1].figure).toEqual({ about: DEMO_REVIEW.advices[1].figure, value: money(2_490) })
      expect(r.advices![2].figure).toBeNull()
      expect(r.advices![0].action).toEqual({ kind: 'open', target: { kind: 'seller', id: 'магазин у дома', name: 'Магазин у дома', categoryId: 'sc_food' } })
      // Счётчик — по находкам советов: утечка и подписка (2 490 × 12).
      expect(r.work).toEqual(reviewWork(state, ctx, findings, [leak!, findings.find((f) => f.kind === 'recurring')!]))
      expect(r.work!.yearly).toBe(248_400 + 29_880)
      // «Что ушло» — факты и действия демо.
      expect(r.sent && 'facts' in r.sent && r.sent.facts.length).toBeGreaterThan(5)

      // «Сделать» → подтвердил: остатка уже нет, но кандидат заготовки тот же — у совета «✓ Сделано», а не пусто.
      const fresh = stepCandidates(state, ctx).find((c) => c.id === 'cushion')
      expect(fresh, 'кандидат «Отложить в подушку»').toBeDefined()
      const doAction = r.advices![2].action
      expect(doAction.kind === 'do' && doAction.candidate).toEqual(fresh)
      finance.addPlanShift(fresh!.shift)
      expect(stepCandidates(finance.planInput(key).state, finance.planInput(key).ctx).find((c) => c.id === 'cushion')).toBeUndefined()
      const after = demoReview(finance.householdDoc, finance.planInput(key))
      const again = after.advices!.find((a) => a.action.kind === 'do')!.action
      expect(again.kind === 'do' && again.candidate).toEqual(fresh)
    })
  }
})
