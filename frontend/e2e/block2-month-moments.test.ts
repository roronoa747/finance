import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { useAuthStore } from '../src/stores/auth'
import { at, phone, screen, setOnline, type FakeServer } from './support/family'
import { accountBalance, budgetAmounts, monthSummary, paidFor, salaryFree } from '../src/lib/finance'
import { money } from '../src/lib/money'
import type { Payment } from '../src/types/finance'
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

    it('сверка остатка после зачисления: правка и снятие этой зарплаты остаток не двигают (якорь, как у платежей)', async () => {
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const card = () => A.store.accounts.find((x) => x.id === 'card')!.amount
      const rec = A.store.markSalary('a', { accountId: 'card' })!
      expect(card()).toBe(1_700_000)

      // Назавтра сверили с банком: зарплата уже во введённой сумме.
      at('2026-09-11T04:00:00Z')
      A.store.setAccountAmount('card', 1_650_000)
      expect(card()).toBe(1_650_000)

      // Премию дописали правкой — момент прежний, до сверки: второй раз не прибавляется.
      const bonus = A.store.editPaid(rec, { amount: 900_000, accountId: 'card' })!
      expect(bonus.at).toBe(rec.at)
      expect(card()).toBe(1_650_000)
      // Снятие тоже не трогает сверенный остаток.
      A.store.unmarkPaid('salary', 'a', '2026-09')
      expect(paidFor(A.store.payments, 'salary', 'a', '2026-09')).toBeNull()
      expect(card()).toBe(1_650_000)
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

  /** Сценарии приёмки Блока 2 (браузер на стенде §6 — те же случаи, здесь — на двух сторах). */
  describe('приёмка Блока 2', () => {
    /** Своё хранилище телефона: Обзор читает ответ на вопрос конца месяца из localStorage. */
    const storage = (init: Record<string, string> = {}) => {
      const m = new Map(Object.entries(init))
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        clear: () => m.clear(),
        key: (i: number) => [...m.keys()][i] ?? null,
        get length() {
          return m.size
        },
      }
    }

    it('RP-10: два телефона Ильяса жмут «Пришла» без сети — на сервере обе записи, на карте зачисление одно', async () => {
      const A1 = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const A2 = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))

      setOnline(false)
      setActivePinia(A1.pinia)
      const first = A1.store.markSalary('a', { accountId: 'card' })!
      at('2026-09-10T04:05:00Z')
      setActivePinia(A2.pinia)
      const second = A2.store.markSalary('a', { accountId: 'card' })!
      expect(second.id).not.toBe(first.id)
      setOnline(true)
      await A1.store.syncHousehold(A1.client)
      await A2.store.syncHousehold(A2.client)
      await A1.store.syncHousehold(A1.client)

      expect(server.data.payments!.filter((p) => p.kind === 'salary' && !p.deletedAt)).toHaveLength(2)
      for (const s of [A1.store, A2.store]) {
        expect(s.accounts.find((x) => x.id === 'card')!.amount).toBe(1_700_000)
        // Считается ранняя по моменту отметки.
        expect(paidFor(s.payments, 'salary', 'a', '2026-09')!.id).toBe(first.id)
      }
      expect(await screen(A2.pinia, Overview, '/')).toContain('Аруна получит')
    })

    it('RP-11: окно по Алматы на стыке месяцев; ответ помнит устройство — на телефоне партнёра вопрос остаётся', async () => {
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))

      at('2026-09-30T18:00:00Z') // 30 сентября, 23:00 по Алматы
      expect(await screen(A.pinia, Overview, '/')).toContain('Остались деньги с сентября?')
      at('2026-09-30T19:30:00Z') // 1 октября, 00:30 по Алматы
      expect(await screen(A.pinia, Overview, '/')).not.toContain('Остались деньги')

      at('2026-09-28T07:00:00Z')
      vi.stubGlobal('localStorage', storage({ ff_month_end: '2026-09' }))
      expect(await screen(A.pinia, Overview, '/')).not.toContain('Остались деньги')
      vi.stubGlobal('localStorage', storage())
      expect(await screen(B.pinia, Overview, '/')).toContain('Остались деньги с сентября?')
      // Ответ за сентябрь не гасит октябрь.
      at('2026-10-29T07:00:00Z')
      vi.stubGlobal('localStorage', storage({ ff_month_end: '2026-09' }))
      expect(await screen(A.pinia, Overview, '/')).toContain('Остались деньги с октября?')
    })

    it('RP-13: дубль отметки, надгробие, чужой месяц, старая дата покупки — итог посчитан руками, у обоих одинаково', async () => {
      const pay = (id: string, kind: Payment['kind'], targetId: string, period: string, amount: number, when: string, extra: Partial<Payment> = {}): Payment =>
        ({ id, kind, targetId, period, amount, accountId: 'card', by: 'a', at: when, updatedAt: when, ...extra })
      server.data.credits.push({
        id: 'tv', name: 'Телевизор', note: '', principal: 20_000, principalSetAt: T0, annualRate: 0.24, payment: 20_400, day: 12, updatedAt: T0,
      })
      server.data.obligations.push({ id: 'nf', name: 'Netflix', note: '', day: 7, category: 'd4', versions: [{ from: '2000-01', amount: 5_000 }], updatedAt: T0 })
      server.data.payments = [
        pay('r1', 'obligation', 'rent', '2026-09', 220_000, '2026-09-05T06:00:00Z'),
        pay('r2', 'obligation', 'rent', '2026-09', 220_000, '2026-09-05T09:00:00Z', { by: 'b' }),
        pay('l9', 'credit', 'loan', '2026-09', 58_000, '2026-09-15T06:00:00Z', { principal: 30_500, by: 'b' }),
        pay('l8', 'credit', 'loan', '2026-08', 58_000, '2026-08-15T06:00:00Z', { principal: 30_000 }),
        pay('tv9', 'credit', 'tv', '2026-09', 20_400, '2026-09-12T06:00:00Z', { principal: 20_000, by: 'b' }),
        pay('nf9', 'obligation', 'nf', '2026-09', 5_000, '2026-09-07T06:00:00Z', { deletedAt: '2026-09-07T07:00:00Z' }),
        pay('sa', 'salary', 'a', '2026-09', 700_000, '2026-09-10T05:00:00Z'),
        pay('sb', 'salary', 'b', '2026-09', 500_000, '2026-09-20T05:00:00Z', { by: 'b' }),
        pay('pp', 'prepay', 'loan', '2026-09', 100_000, '2026-09-16T06:00:00Z', { principal: 100_000, saved: 45_000, mode: 'term', prevPayment: 58_000, newPayment: 58_000 }),
      ]
      server.data.goals[0].movements = [
        { id: 'g8', date: '2026-08-10T06:00:00Z', amount: 50_000, by: 'a' },
        { id: 'g9', date: '2026-09-10T06:00:00Z', amount: 150_000, by: 'a' },
        { id: 'g9b', date: '2026-09-20T06:00:00Z', amount: -30_000, by: 'b' },
      ]
      server.data.goals[0].have = 270_000
      server.data.goals.push({
        id: 'car', name: 'Машина', need: 400_000, seed: 140_000, have: 220_000, monthly: 0, hue: 'teal', planPct: 0, updatedAt: T0,
        movements: [{ id: 'c9', date: '2026-09-22T06:00:00Z', amount: 80_000, by: 'b' }],
      })
      server.data.wishlist = [
        { id: 'w1', name: 'Пылесос', price: 35_000, by: 'a', addedOn: '2026-08-01', bought: true, boughtOn: '2026-09-18T06:00:00Z', updatedAt: T0 },
        { id: 'w2', name: 'Чайник', price: 15_000, by: 'b', addedOn: '2026-08-01', bought: true, boughtOn: '12.09.2026', updatedAt: T0 },
        { id: 'w3', name: 'Кресло', price: 99_000, by: 'b', addedOn: '2026-07-01', bought: true, boughtOn: '20.08.2026', updatedAt: T0 },
        { id: 'w4', name: 'Диван', price: 1_000_000, by: 'a', addedOn: '2026-07-01', bought: false, boughtOn: null, updatedAt: T0 },
      ]
      at('2026-09-29T07:00:00Z')
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))

      // Руками: аренда 220 000 (дубль — раз) + кредит 58 000 + «Телевизор» 20 400; надгробие и август
      // не в счёт; «Машина» 140 000 → 220 000 из 400 000; купили 35 000 + 15 000 (старая дата).
      expect(monthSummary({ ...A.store.householdDoc, goals: A.store.goals, wishlist: A.store.wishlist }, '2026-09')).toEqual({
        key: '2026-09',
        paid: { count: 3, amount: 298_400 },
        income: 1_200_000,
        closed: [{ creditId: 'tv', name: 'Телевизор' }],
        prepaid: { count: 1, amount: 100_000, saved: 45_000 },
        toGoals: 230_000,
        fromGoals: 30_000,
        closest: { goalId: 'car', name: 'Машина', from: 35, to: 55 },
        bought: { count: 2, amount: 50_000 },
      })
      const cardOf = (html: string) => html.slice(html.indexOf('Итог месяца'), html.indexOf('Итог августа'))
      const a = cardOf(await screen(A.pinia, Overview, '/'))
      const b = cardOf(await screen(B.pinia, Overview, '/'))
      for (const text of [money(298_400), money(1_200_000), '«Телевизор»', money(45_000), money(230_000), money(30_000), '35% → 55%', money(50_000)]) {
        expect(a).toContain(text)
      }
      expect(b).toBe(a)
      expect(a).not.toMatch(/Ильяс|Аруна/)
    })
  })
})
