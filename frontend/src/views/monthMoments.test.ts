import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { accountBalance, breakdownWith, monthBreakdown, type BreakdownSource } from '@/lib/finance'
import type { Payment, SyncDoc } from '@/types/finance'
import Dreams from './Dreams.vue'
import Statements from './Statements.vue'
import Money from './Money.vue'
import Breakdown from './Breakdown.vue'
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

  /** Разбор источника — те же числа, что у экрана (`finance.ts`). */
  function breakdown(source: BreakdownSource) {
    const store = useFinanceStore()
    const doc = store.householdDoc
    return monthBreakdown(
      { ...doc, credits: store.credits },
      { key: '2026-09', totals: [], spendCategories: [], uploads: [], rawCredits: doc.credits },
      source,
    )!
  }

  function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs(role, slot))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
    return useFinanceStore()
  }

  describe('RP-11 — вопрос в конце месяца', () => {
    // Решения живут на «Неделе» (пивот 3, Р-42/Р-43): на «Мечтах» их нет.
    it('«Неделя»: «Остались деньги?» есть в последние дни месяца, нет в середине, нет у viewer; на «Мечтах» — нет', async () => {
      family()
      const html = await renderScreen(Statements, '/week')
      expect(html).toContain('Остались деньги с сентября?')
      expect(html).toMatch(/>\s*Разложить\s*</)
      expect(html).toMatch(/>\s*Не сейчас\s*</)
      expect(await renderScreen(Dreams, '/')).not.toContain('Остались деньги')

      vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
      expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги')

      vi.setSystemTime(new Date('2026-09-28T07:00:00Z'))
      setActivePinia(createPinia())
      family('viewer')
      expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги')
    })

    it('«Не сейчас» — ответ помнится на устройстве до конца месяца; в конце следующего — снова', async () => {
      family()
      let vm: Record<string, any> = {}
      const grab = { created(this: any) { if ('answerRest' in this.$.setupState) vm = this.$.setupState } }
      await renderScreen(Statements, '/week', undefined, [grab])
      vm.answerRest(false)
      expect(storage.get('ff_month_end')).toBe('2026-09')
      expect(await renderScreen(Statements, '/week')).not.toContain('Остались деньги')
      // Документ не тронут: партнёра спросят на его телефоне.
      expect(useFinanceStore().unsent).toBe(false)

      vi.setSystemTime(new Date('2026-10-29T07:00:00Z'))
      expect(await renderScreen(Statements, '/week')).toContain('Остались деньги с октября?')
    })

    it('Разбор остатка (B2C-58): сумма из адреса; без своих отметок счёт спрашивается — ничего не пишется; со счётом — взносы со счёта', async () => {
      const store = family()
      const path = '/week/breakdown?from=rest&amount=55000&period=2026-09'
      expect(await renderScreen(Breakdown, path)).toContain(`из ${money(55_000)}`)
      expect(await renderScreen(Breakdown, '/week/breakdown?from=rest&amount=0&period=2026-09')).toContain('Разбирать нечего.')
      // Старый адрес Ритуала — тот же разбор.
      expect(await renderScreen(Breakdown, '/ritual?from=rest&amount=55000&period=2026-09')).toContain(`из ${money(55_000)}`)

      const mb = breakdown({ from: 'rest', amount: 55_000, period: '2026-09' })
      const w = breakdownWith(mb, mb.articles.filter((a) => !a.on).map((a) => a.key))
      const toGoals = w.effects.contributions.reduce((a, c) => a + c.amount, 0)
      expect(toGoals).toBeGreaterThan(0)
      // Своих зарплат ещё не отмечали — счёт не угадать: «Разложить» открывает выбор счёта, ничего не пишется.
      await renderScreen(Breakdown, path, undefined, [screenMixin({}, (s) => (s.lay as () => void)())])
      expect(store.allocations).toEqual([])
      expect(store.goals.every((g) => g.movements.length === 0)).toBe(true)

      await renderScreen(Breakdown, path, undefined, [
        screenMixin({}, (s) => {
          s.chosen = 'card'
          ;(s.lay as () => void)()
        }),
      ])
      expect(store.allocations[0]).toMatchObject({ kind: 'breakdown', source: 'rest', sourceId: '2026-09', total: 55_000, parts: w.effects.parts })
      const notes = store.goals.flatMap((g) => g.movements.map((m) => m.note))
      expect(notes.length).toBeGreaterThan(0)
      expect(notes.every((n) => n === 'из остатка месяца')).toBe(true)
      const prepaid = store.payments.filter((p) => p.kind === 'prepay').reduce((a, p) => a + p.amount, 0)
      expect(accountBalance(store.householdDoc.accounts[0], store.payments)).toBe(2_000_000 - toGoals - prepaid)
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
      expect(await renderScreen(Breakdown, '/ritual?from=credit&credit=inst')).toContain('уже идёт в следующий долг по плану')
    })

    it('Разбор «освободилось N ₸» (B2C-58): сумма — платёж закрытого долга, решение прибавляет ежемесячные взносы', async () => {
      const store = family('member', 'a', moments())
      const path = '/week/breakdown?from=credit&credit=inst'
      expect(await renderScreen(Breakdown, path)).toContain(`из ${money(20_000)}`)
      expect(await renderScreen(Breakdown, '/week/breakdown?from=credit&credit=loan')).toContain('Этот долг ещё не закрыт.')

      const mb = breakdown({ from: 'credit', creditId: 'inst' })
      expect(mb).toMatchObject({ amount: 20_000, mode: 'monthly' })
      const w = breakdownWith(mb, mb.articles.filter((a) => !a.on).map((a) => a.key))
      const before = Object.fromEntries(store.goals.map((g) => [g.id, g.monthly]))
      await renderScreen(Breakdown, path, undefined, [screenMixin({}, (s) => (s.lay as () => void)())])
      expect(store.allocations[0]).toMatchObject({ kind: 'breakdown', source: 'freed', sourceId: 'inst', total: 20_000, parts: w.effects.parts })
      for (const m of w.effects.monthly) expect(store.goals.find((g) => g.id === m.goalId)!.monthly).toBe(before[m.goalId] + m.add)
      // Каждый месяц — без взносов сейчас.
      expect(store.goals.every((g) => g.movements.length === (g.id === 'trip' ? 1 : 0))).toBe(true)
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
