import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { planFromSource, type PlanSource } from '@/lib/finance'
import type { Payment, SyncDoc } from '@/types/finance'
import Dreams from './Dreams.vue'
import Week from './Week.vue'
import Money from './Money.vue'
import Month from './Month.vue'
import { authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'

/**
 * Блок 2 развития — моменты месяца на Обзоре и в Ритуале (SSR). Семья — `planFamilyDoc`:
 * Ильяс (a) и Аруна (b), карта Kaspi Gold 2 000 000, цели «Подушка», «Отпуск», «Машина».
 */
describe('Блок 2: моменты месяца (SSR)', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T07:00:00Z')) // 28 сентября, Алматы
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Деньги сверх плана (Р-86) — те же числа, что у экрана (`finance.ts`). */
  function fromSource(source: PlanSource) {
    const store = useFinanceStore()
    const doc = store.householdDoc
    return planFromSource({ ...doc, credits: store.credits }, { key: '2026-09', totals: [], spendCategories: [], uploads: [], rawCredits: doc.credits }, source)!
  }

  function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs(role, slot))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
    return useFinanceStore()
  }

  describe('RP-11 — вопрос в конце месяца', () => {
    // Решения живут на «Неделе» (пивот 3, Р-42/Р-43) — в листе за «! N» (Блок 15, Р-97): на «Мечтах» их нет.
    const asked = () => renderScreen(Week, '/week', undefined, [screenMixin({ questionsOpen: true })])
    it('«Неделя»: «Остались деньги?» есть в последние дни месяца, нет в середине, нет у viewer; на «Мечтах» — нет', async () => {
      family()
      const html = await asked()
      expect(html).toContain('Остались деньги с сентября?')
      expect(html).toMatch(/>\s*Отложить\s*</)
      expect(html).toMatch(/>\s*Не сейчас\s*</)
      expect(await renderScreen(Dreams, '/')).not.toContain('Остались деньги')

      vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
      expect(await asked()).not.toContain('Остались деньги')

      vi.setSystemTime(new Date('2026-09-28T07:00:00Z'))
      setActivePinia(createPinia())
      family('viewer')
      expect(await asked()).not.toContain('Остались деньги')
    })

    it('«Не сейчас» — ответ помнится на устройстве до конца месяца; в конце следующего — снова', async () => {
      family()
      let vm: Record<string, any> = {}
      const grab = { created(this: any) { if ('answerRest' in this.$.setupState) vm = this.$.setupState } }
      await renderScreen(Week, '/week', undefined, [grab])
      vm.answerRest(false)
      expect(storage.get('ff_month_end')).toBe('2026-09')
      expect(await asked()).not.toContain('Остались деньги')
      // Документ не тронут: партнёра спросят на его телефоне.
      expect(useFinanceStore().unsent).toBe(false)

      vi.setSystemTime(new Date('2026-10-29T07:00:00Z'))
      expect(await asked()).toContain('Остались деньги с октября?')
    })

    it('«Остались деньги?» (Р-86): сумма — разово по очереди целей сверху вниз, запись своим источником; экрана разбора нет', async () => {
      const store = family()
      const src = fromSource({ from: 'rest', amount: 55_000, period: '2026-09' })
      expect(src.mode).toBe('once')
      await renderScreen(Week, '/week', undefined, [
        screenMixin({ restAmount: '55 000' }, (s) => {
          if (typeof s.answerRest === 'function') (s.answerRest as (go: boolean) => void)(true)
        }),
      ])
      expect(store.allocations).toHaveLength(1)
      expect(store.allocations[0]).toMatchObject({ kind: 'plan', source: 'rest', sourceId: '2026-09', total: 55_000, parts: src.mode === 'once' ? src.parts : [] })
      const notes = store.goals.flatMap((g) => g.movements.map((m) => m.note))
      expect(notes.length).toBeGreaterThan(0)
      expect(notes.every((n) => n === 'остаток месяца')).toBe(true)
    })
  })

  describe('RP-12 — моменты прогресса', () => {
    // Рассрочка закрыта последним платежом 20 000; «Отпуск» (нужно 3 000 000) прошёл половину;
    // досрочка в «Кредит» сэкономила 12 345.
    const pay = (p: Partial<Payment> & Pick<Payment, 'id'>): Payment => ({
      kind: 'credit', targetId: 'inst', period: '2026-09', amount: 20_000, principal: 20_000, accountId: 'card',
      by: 'b', at: '2026-09-25T05:00:00.000Z', updatedAt: '2026-09-25T05:00:00.000Z', ...p,
    })
    const moments = (): Partial<SyncDoc> => {
      const base = planFamilyDoc()
      return {
        credits: base.credits.map((c) => (c.id === 'inst' ? { ...c, principal: 20_000 } : c)),
        goals: base.goals.map((g) =>
          g.id === 'trip'
            ? { ...g, movements: [{ id: 'm1', date: '2026-09-12T05:00:00.000Z', amount: 1_500_000, by: 'a' as const }], have: 1_550_000 }
            : g,
        ),
        payments: [
          pay({ id: 'close' }),
          pay({ id: 'pre', kind: 'prepay', targetId: 'loan', amount: 100_000, principal: 100_000, saved: 12_345, at: '2026-09-05T05:00:00.000Z' }),
        ],
      }
    }
    /** Лента квадрата «История»: от чипов фильтра до конца экрана. */
    const section = (html: string) => html.slice(html.indexOf('aria-label="Фильтр"'))

    it('«История» (B2C-44): моменты — строками в ленте по дням, новые первыми; досрочка — отметкой «не отдадим банку»; без значков и серий', async () => {
      family('member', 'a', moments())
      const html = section(await renderScreen(Money, '/money/history'))
      const text = html.replace(/<[^>]*>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
      expect(text).toContain(`25 сентября`)
      expect(text).toContain(`«Рассрочка» закрыт освободилось ${money(20_000)} в месяц`)
      expect(text).toContain('12 сентября «Отпуск»: собрали половину')
      expect(text).toContain(`5 сентября Досрочка в «Кредит» ${(12_345).toLocaleString('ru-RU')}`.replace(/\s/g, '\u00a0').replace('5\u00a0сентября\u00a0Досрочка\u00a0в\u00a0«Кредит»\u00a0', '5 сентября Досрочка в «Кредит» '))
      expect(text.indexOf('«Рассрочка» закрыт')).toBeLessThan(text.indexOf('«Отпуск»: собрали половину'))
      expect(text.indexOf('«Отпуск»: собрали половину')).toBeLessThan(text.indexOf('Досрочка в «Кредит»'))
      expect(text).not.toMatch(/серия|подряд|🎉|🏆/)
      // Строка закрытого долга — кнопка (ведёт в раскладку), «собрали половину» — нет.
      const rows = html.split('border-b border-line last:border-b-0')
      expect(rows.find((r) => r.includes('закрыт'))).toContain('<button')
      expect(rows.find((r) => r.includes('собрали половину'))).not.toContain('<button')
    })

    it('«История»: снятие закрывшей отметки убирает момент; ни моментов, ни отметок — «Пока пусто»', async () => {
      const doc = moments()
      family('member', 'a', { ...doc, payments: doc.payments!.map((p) => (p.id === 'close' ? { ...p, deletedAt: '2026-09-26T00:00:00.000Z' } : p)) })
      const html = await renderScreen(Money, '/money/history')
      expect(html).not.toContain('«Рассрочка» закрыт')
      setActivePinia(createPinia())
      family()
      expect(await renderScreen(Money, '/money/history')).toContain('Пока пусто')
    })

    it('viewer видит историю, но строка закрытого долга в раскладку не ведёт; долг из плана — на экран плана', async () => {
      family('viewer', 'b', moments())
      const rows = section(await renderScreen(Money, '/money/history')).split('border-b border-line last:border-b-0')
      expect(rows.find((r) => r.includes('закрыт'))).not.toContain('<button')

      setActivePinia(createPinia())
      family('member', 'a', { ...moments(), plans: [planOf({ creditIds: ['cc', 'loan', 'inst'] })] })
      const html = await renderScreen(Money, '/money/history')
      expect(section(html)).toContain('его платёж идёт в следующий долг по плану')
    })

    it('«Долг закрыт» (Р-86): карточка плана — платёж закрытого долга разово по очереди одной кнопкой, запись своим источником', async () => {
      const store = family('member', 'a', moments())
      const src = fromSource({ from: 'credit', creditId: 'inst' })
      expect(src).toMatchObject({ mode: 'once', amount: 20_000 })
      const goals = () => renderScreen(Month, '/month', undefined, [screenMixin({ opened: 'queue' })])
      const html = await goals()
      expect(html).toContain('data-closed')
      expect(html).toContain('Рассрочка закрыт')
      await renderScreen(Month, '/month', undefined, [screenMixin({}, (s) => (s.onClosed as () => void)())])
      expect(store.allocations[0]).toMatchObject({ kind: 'plan', source: 'freed', sourceId: 'inst', total: 20_000, parts: src.mode === 'once' ? src.parts : [] })
      // Записано — подсказки нет.
      expect(await goals()).not.toContain('data-closed')
    })
  })

  describe('RP-13 — итог месяца на двоих', () => {
    // Сентябрь: аренда (Ильяс) и кредит (Аруна) оплачены, пришли обе зарплаты, взнос в «Отпуск».
    const pay = (p: Partial<Payment> & Pick<Payment, 'id' | 'kind' | 'targetId' | 'amount' | 'by'>): Payment => ({
      period: '2026-09', accountId: 'card', at: '2026-09-10T05:00:00.000Z', updatedAt: '2026-09-10T05:00:00.000Z', ...p,
    })
    const september = (): Partial<SyncDoc> => ({
      payments: [
        pay({ id: 'r', kind: 'obligation', targetId: 'rent', amount: 220_000, by: 'a' }),
        pay({ id: 'l', kind: 'credit', targetId: 'loan', amount: 58_000, principal: 30_500, by: 'b' }),
        pay({ id: 'sa', kind: 'salary', targetId: 'a', amount: 700_000, by: 'a' }),
        pay({ id: 'sb', kind: 'salary', targetId: 'b', amount: 500_000, by: 'b' }),
      ],
      goals: planFamilyDoc().goals.map((g) =>
        g.id === 'trip' ? { ...g, movements: [{ id: 'm', date: '2026-09-15T05:00:00.000Z', amount: 250_000, by: 'b' as const }], have: 300_000 } : g,
      ),
    })
    const card = (html: string) => {
      const from = html.indexOf('Итог месяца')
      return from < 0 ? '' : html.slice(from, html.indexOf('</button>', html.indexOf('Итог ', from + 12)))
    }
    const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/[ \t\r\n]+/g, ' ')

    it('в конце месяца — «Наш сентябрь» с цифрами finance.ts; в середине — нет; в первые дни октября — сентябрь', async () => {
      family('member', 'a', september())
      const t = text(card(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })])))
      expect(t).toContain('Наш сентябрь')
      expect(t).toContain(`Оплатили 2 платежа ${money(278_000)}`)
      expect(t).toContain(`Пришло зарплатой ${money(1_200_000)}`)
      expect(t).toContain(`Отложили в цели ${money(250_000)}`)
      // «Отпуск»: 50 000 → 300 000 из 3 000 000 — 2% → 10%.
      expect(t).toContain('«Отпуск» 2% → 10%')
      expect(t).toContain('Итог августа')

      // В середине месяца — итог прошлого: в августе отметок нет — строки нет.
      vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
      expect(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })])).not.toContain('Итог месяца')
      vi.setSystemTime(new Date('2026-10-03T07:00:00Z'))
      expect(text(card(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })])))).toContain('Наш сентябрь')
    })

    it('оба участника и viewer видят один и тот же итог — без имён и сравнений', async () => {
      family('member', 'a', september())
      const a = card(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      setActivePinia(createPinia())
      family('member', 'b', september())
      const b = card(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      setActivePinia(createPinia())
      family('viewer', 'b', september())
      const v = card(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      expect(a).not.toBe('')
      expect(b).toBe(a)
      expect(v).toBe(a)
      expect(text(a)).not.toMatch(/Ильяс|Аруна|больше|меньше|лучше|хуже|молодц/i)
    })

    it('месяц раньше — в той же карточке; пустой месяц — спокойная строка', async () => {
      family('member', 'a', september())
      const html = await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true, earlier: true })])
      const t = text(card(html))
      expect(t).toContain('Наш август')
      expect(t).toContain('В августе отметок пока нет.')
      expect(t).toContain('Итог сентября')
    })
  })
})
