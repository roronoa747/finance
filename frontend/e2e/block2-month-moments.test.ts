import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { useAuthStore } from '../src/stores/auth'
import { at, phone, screen, setOnline, type FakeServer } from './support/family'
import { accountBalance, budgetAmounts, monthSummary, paidFor, salaryFree } from '../src/lib/finance'
import { money } from '../src/lib/money'
import { authAs } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Budget from '../src/views/Budget.vue'
import Overview from '../src/views/Overview.vue'
import Ritual from '../src/views/Ritual.vue'

/**
 * Блок 2 развития: моменты месяца. Два телефона — два стора Pinia на одном фейковом
 * сервере с ревизиями и 409 (`support/family`).
 */
describe('e2e / Блок 2 — моменты месяца на двух телефонах', () => {
  let server: FakeServer
  const T0 = '2026-09-01T00:00:00.000Z'

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-09-10T04:00:00Z') // 10 сентября, 9:00 по Алматы — день зарплаты Ильяса
    setOnline(true)
    server = {
      rev: 1,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
        ],
        categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 300_000, updatedAt: T0 }],
        accounts: [
          { id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 },
          { id: 'halyk', name: 'Halyk', note: '', amount: 200_000, amountSetAt: T0, kind: 'card', updatedAt: T0 },
        ],
        obligations: [
          { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
        ],
        goals: [
          { id: 'trip', name: 'Отпуск', need: 1_000_000, seed: 100_000, have: 100_000, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 },
        ],
        credits: [
          { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
        ],
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('RP-10 — «Пришла зарплата»', () => {
    it('A: «Пришла» → карта выросла, раскладка с суммой из finance.ts; B после синка видит зачисление, кнопка — только у себя', async () => {
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))

      // Ильяс отмечает впервые — счёт выбирает в листе (Kaspi Gold), сумма — оклад.
      setActivePinia(A.pinia)
      const record = A.store.markSalary('a', { accountId: 'card' })!
      expect(record).toMatchObject({ kind: 'salary', targetId: 'a', period: '2026-09', amount: 700_000, accountId: 'card', by: 'a' })
      expect(A.store.accounts.find((x) => x.id === 'card')!.amount).toBe(1_700_000)
      // Повторное нажатие (или второй телефон до синка) второй записи не пишет.
      expect(A.store.markSalary('a')!.id).toBe(record.id)

      // Раскладка: сумма — доля свободного на эту зарплату.
      const free = budgetAmounts({ ...A.store.householdDoc, credits: A.store.credits }).d5
      const total = salaryFree(free, A.store.people, record)
      expect(total).toBe(Math.round((free * 700_000) / 1_200_000))
      const ritual = await screen(A.pinia, Ritual, '/ritual?from=salary&person=a&period=2026-09')
      expect(ritual).toContain(`Куда направить ${money(total)}`)

      await A.store.syncHousehold(A.client)
      await B.store.syncHousehold(B.client)
      expect(B.store.accounts.find((x) => x.id === 'card')!.amount).toBe(1_700_000)
      expect(paidFor(B.store.payments, 'salary', 'a', '2026-09')?.id).toBe(record.id)

      // У Аруны строка Ильяса — отметка без кнопок; своей зарплаты кнопка ещё рано (20-го).
      const list = await screen(B.pinia, Budget, '/budget', { initialView: 'list' })
      const row = (title: string) => list.split('border-b border-line last:border-b-0').find((c) => c.includes(`>${title}<`)) ?? ''
      expect(row('Зарплата · Ильяс')).toContain('пришла 10 сентября · Kaspi Gold')
      expect(row('Зарплата · Ильяс')).not.toMatch(/>\s*Пришла\s*<\/button>/)
      expect(row('Зарплата · Аруна')).not.toMatch(/>\s*Пришла\s*<\/button>/)

      // «До зарплаты» у обоих переключилось на Аруну.
      const overview = await screen(B.pinia, Overview, '/')
      expect(overview).toContain('Аруна получит')
    })

    it('следующая зарплата — на счёт прошлой одним нажатием; снятие возвращает; премия — правкой', async () => {
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      A.store.markSalary('a', { accountId: 'halyk' })
      at('2026-10-09T04:00:00Z')
      // Октябрь: счёт не передан — берётся прошлый (Р-5).
      const oct = A.store.markSalary('a', { period: '2026-10' })!
      expect(oct.accountId).toBe('halyk')
      expect(A.store.accounts.find((x) => x.id === 'halyk')!.amount).toBe(200_000 + 1_400_000)

      // Премия: правка суммы — новая запись с тем же моментом.
      const bonus = A.store.editPaid(oct, { amount: 900_000, accountId: 'halyk' })!
      expect(bonus.at).toBe(oct.at)
      expect(A.store.accounts.find((x) => x.id === 'halyk')!.amount).toBe(200_000 + 700_000 + 900_000)

      A.store.unmarkPaid('salary', 'a', '2026-10')
      expect(paidFor(A.store.payments, 'salary', 'a', '2026-10')).toBeNull()
      expect(accountBalance(A.store.householdDoc.accounts[1], A.store.payments)).toBe(900_000)
    })

    it('офлайн: обе зарплаты отмечены на своих телефонах без сети — после синка обе на карте', async () => {
      const A = await phone(server)
      const B = await phone(server)
      setOnline(false)
      setActivePinia(A.pinia)
      A.store.markSalary('a', { accountId: 'card' })
      at('2026-09-20T04:00:00Z')
      setActivePinia(B.pinia)
      B.store.markSalary('b', { accountId: 'card' })
      setOnline(true)
      await A.store.syncHousehold(A.client)
      await B.store.syncHousehold(B.client)
      await A.store.syncHousehold(A.client)
      for (const s of [A.store, B.store]) {
        expect(s.accounts.find((x) => x.id === 'card')!.amount).toBe(1_000_000 + 700_000 + 500_000)
      }
    })
  })

  describe('RP-11 — вопрос в конце месяца', () => {
    it('28 сентября: вопрос у обоих; A раскладывает остаток в цель со счёта — B видит взнос и остаток карты', async () => {
      at('2026-09-28T07:00:00Z')
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))
      expect(await screen(A.pinia, Overview, '/')).toContain('Остались деньги с сентября?')
      expect(await screen(B.pinia, Overview, '/')).toContain('Остались деньги с сентября?')

      const done = await screen(A.pinia, Ritual, '/ritual?from=rest&amount=80000&period=2026-09', undefined, [
        screenMixin({}, (s) => {
          s.alloc = { trip: 60_000, life: 20_000 }
          s.fromAccount = 'card'
          ;(s.confirm as () => void)()
        }),
      ])
      expect(done).toContain(`В цели отложено ${money(60_000)} со счёта «Kaspi Gold»`)
      await A.store.syncHousehold(A.client)
      await B.store.syncHousehold(B.client)
      const trip = B.store.goals.find((g) => g.id === 'trip')!
      expect(trip.have).toBe(160_000)
      expect(trip.monthly).toBe(50_000)
      expect(B.store.accounts.find((x) => x.id === 'card')!.amount).toBe(940_000)
    })

    it('1 октября вопроса нет; 29 октября — снова (RP-11)', async () => {
      at('2026-10-01T07:00:00Z')
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      expect(await screen(A.pinia, Overview, '/')).not.toContain('Остались деньги')
      at('2026-10-29T07:00:00Z')
      expect(await screen(A.pinia, Overview, '/')).toContain('Остались деньги с октября?')
    })
  })

  describe('RP-12 — моменты прогресса', () => {
    it('B закрывает маленький долг последним «Оплатил» → строка у обоих, ведёт в «освободилось»; снятие убирает', async () => {
      server.data.credits.push({
        id: 'tv', name: 'Телевизор', note: '', principal: 30_000, principalSetAt: T0, annualRate: 0, payment: 30_000, day: 12, updatedAt: T0,
      })
      at('2026-09-12T06:00:00Z')
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))

      setActivePinia(B.pinia)
      B.store.markPaid('credit', 'tv', 'b', { accountId: 'card' })
      expect(B.store.credits.find((c) => c.id === 'tv')!.principal).toBe(0)
      await B.store.syncHousehold(B.client)
      await A.store.syncHousehold(A.client)

      const overview = await screen(A.pinia, Overview, '/')
      expect(overview).toContain('«Телевизор» закрыт')
      expect(overview).toContain(`12 сентября · освободилось ${money(30_000)} в месяц`)
      const ritual = await screen(A.pinia, Ritual, '/ritual?from=credit&credit=tv')
      expect(ritual).toContain(`Куда направить ${money(30_000)}`)

      // Ошиблись — сняли отметку: долг снова открыт, момента нет ни у кого.
      setActivePinia(B.pinia)
      B.store.unmarkPaid('credit', 'tv', '2026-09')
      await B.store.syncHousehold(B.client)
      await A.store.syncHousehold(A.client)
      expect(await screen(A.pinia, Overview, '/')).not.toContain('«Телевизор» закрыт')
      expect(await screen(A.pinia, Ritual, '/ritual?from=credit&credit=tv')).toContain('Этот долг ещё не закрыт')
      // В документе — только записи оплат: моменты не пишутся.
      expect(Object.keys(server.data).filter((k) => /moment|history/i.test(k))).toEqual([])
    })
  })

  describe('RP-13 — итог месяца на двоих', () => {
    it('A и B отмечают своё офлайн → 28-го у обоих одна карточка «Наш сентябрь», цифры — monthSummary', async () => {
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))

      setOnline(false)
      setActivePinia(A.pinia)
      A.store.markSalary('a', { accountId: 'card' })
      A.store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })
      A.store.contribute('trip', 150_000, 'a')
      at('2026-09-15T06:00:00Z')
      setActivePinia(B.pinia)
      B.store.markPaid('credit', 'loan', 'b', { period: '2026-09', accountId: 'card' })
      setOnline(true)
      await A.store.syncHousehold(A.client)
      await B.store.syncHousehold(B.client)
      await A.store.syncHousehold(A.client)

      at('2026-09-28T07:00:00Z')
      const summary = monthSummary(
        { credits: A.store.householdDoc.credits, goals: A.store.goals, payments: A.store.payments, wishlist: A.store.wishlist },
        '2026-09',
      )
      expect(summary.paid).toEqual({ count: 2, amount: 220_000 + 58_000 })
      expect(summary.income).toBe(700_000)
      expect(summary.toGoals).toBe(150_000)

      const cardOf = (html: string) => html.slice(html.indexOf('Итог месяца'), html.indexOf('Итог августа'))
      const a = cardOf(await screen(A.pinia, Overview, '/'))
      const b = cardOf(await screen(B.pinia, Overview, '/'))
      expect(a).toContain('Наш сентябрь')
      expect(a).toContain(money(summary.paid.amount))
      expect(a).toContain(money(summary.income))
      expect(a).toContain(`${summary.closest!.from}% → ${summary.closest!.to}%`)
      expect(b).toBe(a)
      expect(a).not.toMatch(/Ильяс|Аруна/)
    })
  })
})
