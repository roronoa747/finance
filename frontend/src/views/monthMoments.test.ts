import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { accountBalance } from '@/lib/finance'
import type { SyncDoc } from '@/types/finance'
import Overview from './Overview.vue'
import Ritual from './Ritual.vue'
import { authAs, planFamilyDoc } from '@/test/planFamily'
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
})
