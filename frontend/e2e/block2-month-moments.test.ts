import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia } from 'pinia'
import { defaultSyncDoc } from '../src/stores/finance'
import { useAuthStore } from '../src/stores/auth'
import { at, phone, screen, setOnline, type FakeServer } from './support/family'
import { accountBalance, monthPlan, monthSummary, paidFor, planFromSource, type PlanSource } from '../src/lib/finance'
import { money } from '../src/lib/money'
import type { Payment, SyncDoc } from '../src/types/finance'
import { authAs } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Statements from '../src/views/Statements.vue'
import Money from '../src/views/Money.vue'

/**
 * Блок 2 развития: моменты месяца. Два телефона — два стора Pinia на одном фейковом
 * сервере с ревизиями и 409 (`support/family`).
 */
/** План месяца и деньги сверх плана — те же числа, что у экрана (`finance.ts`, Блок 14). */
const ctxOf = (doc: SyncDoc, key = '2026-09') => ({ key, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: [], rawCredits: doc.credits })
const planOf = (store: { householdDoc: SyncDoc; credits: SyncDoc['credits'] }, key = '2026-09') =>
  monthPlan({ ...store.householdDoc, credits: store.credits }, ctxOf(store.householdDoc, key))
const sourceOf = (store: { householdDoc: SyncDoc; credits: SyncDoc['credits'] }, source: PlanSource) =>
  planFromSource({ ...store.householdDoc, credits: store.credits }, ctxOf(store.householdDoc), source)

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

      // План месяца (Блок 14): пришла — «Отложить по плану», «Остаётся» — из finance.ts.
      const plan = planOf(A.store)
      expect(plan.income.byPerson.find((x) => x.person === 'a')).toMatchObject({ amount: 700_000, came: true })
      const money_ = await screen(A.pinia, Money, '/money')
      expect(money_).toContain(`data-rest>${money(plan.rest)}<`)

      await A.store.syncHousehold(A.client)
      await B.store.syncHousehold(B.client)
      expect(B.store.accounts.find((x) => x.id === 'card')!.amount).toBe(1_700_000)
      expect(paidFor(B.store.payments, 'salary', 'a', '2026-09')?.id).toBe(record.id)

      // У Аруны зарплата Ильяса — отметкой в «Истории» (пивот 3, B2C-44; списка Бюджета нет), без кнопок.
      const history = (await screen(B.pinia, Money, '/money/history')).replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
      expect(history).toContain(`Зарплата · Ильяс пришла · отметка +${money(700_000)}`)
      expect(history).not.toContain('Пришла зарплата')

      // Ближайшая зарплата у обоих — Аруны: строка листа сводки «До зарплаты» в «Деньгах» (пивот 3, Р-32).
      const overview = await screen(B.pinia, Money, '/money', undefined, [screenMixin({ open: true })])
      expect(overview).toContain('Зарплата · Аруна')
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

  // Вопрос — на «Неделе» (пивот 3, Р-43; на «Мечтах» решений нет).
  describe('RP-11 — вопрос в конце месяца', () => {
    it('28 сентября: вопрос у обоих; A раскладывает остаток в цель со счёта — B видит взнос и остаток карты', async () => {
      at('2026-09-28T07:00:00Z')
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))
      expect(await screen(A.pinia, Statements, '/week')).toContain('Остались деньги с сентября?')
      expect(await screen(B.pinia, Statements, '/week')).toContain('Остались деньги с сентября?')

      // «Остались деньги?» (Р-86): сумма — разово по очереди целей сверху вниз, запись своим источником.
      setActivePinia(A.pinia)
      const src = sourceOf(A.store, { from: 'rest', amount: 80_000, period: '2026-09' })!
      expect(src.mode).toBe('once')
      const toGoals = src.mode === 'once' ? src.contributions.reduce((a, c) => a + c.amount, 0) : 0
      expect(toGoals).toBeGreaterThan(0)
      const monthly = Object.fromEntries(A.store.goals.map((g) => [g.id, g.monthly]))
      const haves = A.store.goals.reduce((a, g) => a + g.have, 0)
      const done = await screen(A.pinia, Statements, '/week', undefined, [
        screenMixin({ restAmount: '80 000' }, (s) => {
          if (typeof s.answerRest === 'function') (s.answerRest as (go: boolean) => void)(true)
        }),
      ])
      expect(done).not.toContain('Остались деньги с сентября?')
      await A.store.syncHousehold(A.client)
      await B.store.syncHousehold(B.client)
      expect(B.store.allocations).toEqual([expect.objectContaining({ kind: 'plan', source: 'rest', total: 80_000, parts: src.mode === 'once' ? src.parts : [] })])
      // Разово — взносы сейчас, ежемесячные взносы прежние; новых целей не заводится.
      expect(Object.fromEntries(B.store.goals.map((g) => [g.id, g.monthly]))).toEqual(monthly)
      expect(B.store.goals.reduce((a, g) => a + g.have, 0)).toBe(haves + toGoals)
      expect(await screen(B.pinia, Statements, '/week')).not.toContain('Остались деньги с сентября?')
    })

    it('1 октября вопроса нет; 29 октября — снова (RP-11)', async () => {
      at('2026-10-01T07:00:00Z')
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      expect(await screen(A.pinia, Statements, '/week')).not.toContain('Остались деньги')
      at('2026-10-29T07:00:00Z')
      expect(await screen(A.pinia, Statements, '/week')).toContain('Остались деньги с октября?')
    })
  })

  describe('RP-12 — моменты прогресса', () => {
    it('B закрывает маленький долг последним «Оплатил» → строка у обоих и карточка «закрыт» в плане месяца; снятие убирает', async () => {
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

      const overview = await screen(A.pinia, Money, '/money/history')
      expect(overview).toContain('«Телевизор» закрыт')
      // Квадрат «История» (B2C-44): день — подпись ленты, момент — строкой под ним.
      expect(overview.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')).toMatch(new RegExp(`12 сентября .*«Телевизор» закрыт освободилось ${money(30_000)} в месяц`))
      // Деньги закрытого долга — карточкой плана месяца (Р-86), одна кнопка.
      const plan = await screen(A.pinia, Money, '/money')
      expect(plan).toContain('data-source="credit"')
      expect(plan).toContain('Телевизор закрыт')
      expect(plan).toContain(money(30_000))

      // Ошиблись — сняли отметку: долг снова открыт, момента нет ни у кого.
      setActivePinia(B.pinia)
      B.store.unmarkPaid('credit', 'tv', '2026-09')
      await B.store.syncHousehold(B.client)
      await A.store.syncHousehold(A.client)
      expect(await screen(A.pinia, Money, '/money/history')).not.toContain('«Телевизор» закрыт')
      expect(await screen(A.pinia, Money, '/money')).not.toContain('data-source="credit"')
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
      const a = cardOf(await screen(A.pinia, Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      const b = cardOf(await screen(B.pinia, Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
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
      expect(await screen(A2.pinia, Money, '/money', undefined, [screenMixin({ open: true })])).toContain('Зарплата · Аруна')
    })

    it('RP-11: окно по Алматы на стыке месяцев; ответ помнит устройство — на телефоне партнёра вопрос остаётся', async () => {
      const A = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'a'))
      const B = await phone(server)
      useAuthStore().setAuthData(authAs('member', 'b'))

      at('2026-09-30T18:00:00Z') // 30 сентября, 23:00 по Алматы
      expect(await screen(A.pinia, Statements, '/week')).toContain('Остались деньги с сентября?')
      at('2026-09-30T19:30:00Z') // 1 октября, 00:30 по Алматы
      expect(await screen(A.pinia, Statements, '/week')).not.toContain('Остались деньги')

      at('2026-09-28T07:00:00Z')
      vi.stubGlobal('localStorage', storage({ ff_month_end: '2026-09' }))
      expect(await screen(A.pinia, Statements, '/week')).not.toContain('Остались деньги')
      vi.stubGlobal('localStorage', storage())
      expect(await screen(B.pinia, Statements, '/week')).toContain('Остались деньги с сентября?')
      // Ответ за сентябрь не гасит октябрь.
      at('2026-10-29T07:00:00Z')
      vi.stubGlobal('localStorage', storage({ ff_month_end: '2026-09' }))
      expect(await screen(A.pinia, Statements, '/week')).toContain('Остались деньги с октября?')
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
      const a = cardOf(await screen(A.pinia, Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      const b = cardOf(await screen(B.pinia, Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      for (const text of [money(298_400), money(1_200_000), '«Телевизор»', money(45_000), money(230_000), money(30_000), '35% → 55%', money(50_000)]) {
        expect(a).toContain(text)
      }
      expect(b).toBe(a)
      expect(a).not.toMatch(/Ильяс|Аруна/)
    })
  })
})
