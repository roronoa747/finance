import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { accountBalance } from '@/lib/finance'
import type { Payment, SyncDoc } from '@/types/finance'
import Overview from './Overview.vue'
import Ritual from './Ritual.vue'
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

  function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs(role, slot))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
    return useFinanceStore()
  }

  describe('RP-11 — вопрос в конце месяца', () => {
    it('Обзор: карточка есть в последние дни месяца, нет в середине, нет у viewer', async () => {
      family()
      const html = await renderScreen(Overview, '/')
      expect(html).toContain('Остались деньги с сентября?')
      expect(html).toMatch(/>\s*Всё ушло\s*</)
      expect(html).toMatch(/>\s*Не сейчас\s*</)

      vi.setSystemTime(new Date('2026-09-20T07:00:00Z'))
      expect(await renderScreen(Overview, '/')).not.toContain('Остались деньги')

      vi.setSystemTime(new Date('2026-09-28T07:00:00Z'))
      setActivePinia(createPinia())
      family('viewer')
      expect(await renderScreen(Overview, '/')).not.toContain('Остались деньги')
    })

    it('ответ помнится на устройстве до конца месяца; в конце следующего — снова', async () => {
      family()
      let vm: Record<string, any> = {}
      const grab = { created(this: any) { if ('answerRest' in this.$.setupState) vm = this.$.setupState } }
      await renderScreen(Overview, '/', undefined, [grab])
      vm.answerRest()
      expect(storage.get('ff_month_end')).toBe('2026-09')
      expect(await renderScreen(Overview, '/')).not.toContain('Остались деньги')
      // Документ не тронут: партнёра спросят на его телефоне.
      expect(useFinanceStore().unsent).toBe(false)

      vi.setSystemTime(new Date('2026-10-29T07:00:00Z'))
      expect(await renderScreen(Overview, '/')).toContain('Остались деньги с октября?')
    })

    it('«Распределить» с суммой — ответ записан и раскладка остатка этой суммой', async () => {
      family()
      let vm: Record<string, any> = {}
      const grab = { created(this: any) { if ('distributeRest' in this.$.setupState) vm = this.$.setupState } }
      await renderScreen(Overview, '/', undefined, [grab])
      vm.restText = '55 000'
      vm.distributeRest()
      expect(storage.get('ff_month_end')).toBe('2026-09')
    })

    it('Ритуал с остатком: сумма из адреса, подпись без упрёка; взнос в цель только со счётом', async () => {
      const store = family()
      const html = await renderScreen(Ritual, '/ritual?from=rest&amount=55000&period=2026-09')
      expect(html).toContain(`Куда направить ${money(55_000)}`)
      expect(html).toContain(`Остаток сентября — ${money(55_000)}`)
      expect(html).toContain('Решение разовое')
      expect(await renderScreen(Ritual, '/ritual?from=rest&amount=0&period=2026-09')).toContain('Остатка нет')

      // Своих зарплат ещё не отмечали — счёт не угадать: без выбора ничего не пишется.
      const blocked = await renderScreen(Ritual, '/ritual?from=rest&amount=55000&period=2026-09', undefined, [
        screenMixin({}, (s) => {
          s.alloc = { trip: 55_000 }
          ;(s.confirm as () => void)()
        }),
      ])
      expect(blocked).toContain('Выберите, откуда отложить')
      expect(store.goals.find((g) => g.id === 'trip')!.movements).toEqual([])

      const done = await renderScreen(Ritual, '/ritual?from=rest&amount=55000&period=2026-09', undefined, [
        screenMixin({}, (s) => {
          s.alloc = { trip: 55_000 }
          s.fromAccount = 'card'
          ;(s.confirm as () => void)()
        }),
      ])
      expect(done).toContain(`В цели отложено ${money(55_000)} со счёта «Kaspi Gold»`)
      const trip = store.goals.find((g) => g.id === 'trip')!
      expect(trip.movements.map((m) => [m.amount, m.note])).toEqual([[55_000, 'из остатка месяца']])
      expect(trip.monthly).toBe(40_000)
      expect(accountBalance(store.householdDoc.accounts[0], store.payments)).toBe(2_000_000 - 55_000)
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
    const section = (html: string) => html.slice(html.indexOf('История семьи'))

    it('Обзор: «История семьи» — строка на момент, новые первыми, без имён, значков и серий', async () => {
      family('member', 'a', moments())
      const html = section(await renderScreen(Overview, '/'))
      const text = html.replace(/<[^>]*>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
      expect(text).toContain('«Рассрочка» закрыт')
      expect(text).toContain(`25 сентября · освободилось ${money(20_000)} в месяц`)
      expect(text).toContain('«Отпуск»: собрали половину')
      expect(text).toContain(`Не отдадим банку ${money(12_345)}`)
      expect(text).toContain('5 сентября · досрочка в «Кредит»')
      expect(text.indexOf('«Рассрочка» закрыт')).toBeLessThan(text.indexOf('«Отпуск»: собрали половину'))
      expect(text.indexOf('«Отпуск»: собрали половину')).toBeLessThan(text.indexOf('Не отдадим банку'))
      expect(text).not.toMatch(/Ильяс|Аруна|серия|подряд|🎉|🏆/)
      // Строка закрытого долга — кнопка (ведёт в раскладку), остальные — нет.
      const rows = html.split('border-b border-line last:border-b-0')
      expect(rows.find((r) => r.includes('закрыт'))).toContain('<button')
      expect(rows.find((r) => r.includes('собрали половину'))).not.toContain('<button')
    })

    it('Обзор: снятие закрывшей отметки убирает момент; нет моментов — нет раздела', async () => {
      const doc = moments()
      family('member', 'a', { ...doc, payments: doc.payments!.map((p) => (p.id === 'close' ? { ...p, deletedAt: '2026-09-26T00:00:00.000Z' } : p)) })
      const html = await renderScreen(Overview, '/')
      expect(html).not.toContain('«Рассрочка» закрыт')
      setActivePinia(createPinia())
      family()
      expect(await renderScreen(Overview, '/')).not.toContain('История семьи')
    })

    it('viewer видит историю, но строка закрытого долга в раскладку не ведёт; долг из плана — на экран плана', async () => {
      family('viewer', 'b', moments())
      const rows = section(await renderScreen(Overview, '/')).split('border-b border-line last:border-b-0')
      expect(rows.find((r) => r.includes('закрыт'))).not.toContain('<button')

      setActivePinia(createPinia())
      family('member', 'a', { ...moments(), plans: [planOf({ creditIds: ['cc', 'loan', 'inst'] })] })
      const html = await renderScreen(Overview, '/')
      expect(section(html)).toContain('его платёж идёт в следующий долг по плану')
      expect(await renderScreen(Ritual, '/ritual?from=credit&credit=inst')).toContain('уже идёт в следующий долг по плану')
    })

    it('Ритуал «освободилось N ₸»: сумма — платёж закрытого долга, решение прибавляет ежемесячные взносы', async () => {
      const store = family('member', 'a', moments())
      const html = await renderScreen(Ritual, '/ritual?from=credit&credit=inst')
      expect(html).toContain(`Куда направить ${money(20_000)}`)
      expect(html).toContain(`«Рассрочка» закрыт — освободилось ${money(20_000)} в месяц`)
      expect(html).toContain('платёж закрытого долга остаётся в «Свободно»')
      expect(await renderScreen(Ritual, '/ritual?from=credit&credit=loan')).toContain('Этот долг ещё не закрыт')

      const done = await renderScreen(Ritual, '/ritual?from=credit&credit=inst', undefined, [
        screenMixin({}, (s) => {
          s.alloc = { car: 20_000 }
          ;(s.confirm as () => void)()
        }),
      ])
      expect(done).toContain('платёж «Рассрочка» теперь работает на цели')
      const car = store.goals.find((g) => g.id === 'car')!
      expect(car.monthly).toBe(60_000 + 20_000)
      expect(car.movements).toEqual([])
    })
  })
})
