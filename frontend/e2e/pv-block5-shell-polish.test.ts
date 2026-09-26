import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import type { Component } from 'vue'
import { defaultSyncDoc } from '../src/stores/finance'
import { useAuthStore } from '../src/stores/auth'
import type { SyncDoc } from '../src/types/finance'
import Access from '../src/views/Access.vue'
import Overview from '../src/views/Overview.vue'
import Budget from '../src/views/Budget.vue'
import Capital from '../src/views/Capital.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import SyncBadge from '../src/components/SyncBadge.vue'
import AppearancePanel from '../src/components/AppearancePanel.vue'
import { authAs } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import { at, fakeServer, phone, screen, setOnline, type FakeServer } from './support/family'

/**
 * Блок 5 паритета — оболочка (PV-20…PV-23): два телефона на одном фейковом сервере
 * (`support/family`). Браузерная проверка — на стенде §6.
 */
describe('e2e / PV Блок 5 — оболочка на двух телефонах', () => {
  const T0 = '2026-09-01T00:00:00.000Z'
  let server: FakeServer

  function seed(): SyncDoc {
    return {
      ...defaultSyncDoc(),
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
      goals: [
        { id: 'trip', name: 'Отпуск', need: 1_000_000, seed: 200_000, have: 200_000, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 },
      ],
      categories: [{ key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: T0 }],
    }
  }

  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-09-26T07:00:00Z')
    setOnline(true)
    server = fakeServer(seed())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('PV-21 — «Начать бюджет заново»', () => {
    it('A начал заново → у B (приложение открыто, фоновый pull) пустой документ и мастер', async () => {
      const A = await phone(server)
      const B = await phone(server)
      expect(on(B).store.setupDone).toBe(true)

      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)
      expect(server.data.people).toEqual([])
      expect(server.data.resetAt).toBe('2026-09-26T07:00:00.000Z')

      await on(B).store.pullHousehold(B.client)
      expect(B.store.householdDoc.goals).toEqual([])
      expect(B.store.setupDone).toBe(false)
    })

    it('приложение B было закрыто: первый круг при открытии — полный синк — не заливает старое обратно', async () => {
      const A = await phone(server)
      const B = await phone(server)

      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)

      // Раньше: пустой сервер = «первый выход в облако», B отправлял свой полный документ.
      await on(B).store.syncHousehold(B.client)
      expect(B.store.householdDoc.people).toEqual([])
      expect(B.store.setupDone).toBe(false)
      expect(server.data.people).toEqual([])
      expect(server.data.goals).toEqual([])

      await on(A).store.syncHousehold(A.client)
      expect(A.store.householdDoc.goals).toEqual([])
    })

    it('A уже прошёл мастер после сброса — у B только новое, старые цели и настройка не «воскресают»', async () => {
      const A = await phone(server)
      const B = await phone(server)

      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)
      at('2026-09-26T07:05:00Z')
      A.store.setPerson('a', { name: 'Ильяс', salary: 800_000, payday: 10, onboardedAt: '2026-09-26T07:05:00.000Z' })
      A.store.addGoal({ name: 'Машина', need: 5_000_000, monthly: 100_000, hue: 'blue' })
      await A.store.syncHousehold(A.client)

      at('2026-09-26T09:00:00Z')
      await on(B).store.syncHousehold(B.client)
      expect(B.store.householdDoc.goals.map((g) => g.name)).toEqual(['Машина'])
      expect(B.store.householdDoc.people.map((p) => [p.id, p.salary])).toEqual([['a', 800_000]])
      expect(B.store.householdDoc.categories).toEqual([])
      expect(server.data.goals.map((g) => g.name)).toEqual(['Машина'])
    })
  })

  /**
   * Приёмка Блока 5: цепочки, которые приёмка прошла в браузере (стенд §6, Chrome 390px), —
   * ответ Go доходит до экрана русским текстом, сброс сильнее неотправленной офлайн-правки,
   * имя из «Оформления» у партнёра, мелочи Б-22 глазами второго телефона, поздний офлайн-взнос
   * не откатывает правку «Уже накоплено». Нажатия — обработчиками экранов (`screenMixin`).
   */
  describe('Приёмка Блока 5', () => {
    /** Экран, его обработчик и итог после него: SSR не нажимает — действие зовём сами и рендерим снова. */
    async function act(pinia: Pinia, view: Component, path: string, action: string, state: Record<string, unknown> = {}) {
      let vm: Record<string, any> = {}
      // Смесь глобальная — состояние берём только у компонента с нужным обработчиком.
      const grab = { created(this: any) { if (action in this.$.setupState) vm = this.$.setupState } }
      await screen(pinia, view, path, undefined, [screenMixin(state), grab])
      await vm[action]()
      return vm
    }
    /** Ответ сервера в форме Go (`{"error": …}`, application/json) — для настоящего `apiClient`. */
    const goReply = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })
    const ENGLISH = /invalid|unauthorized|required|already|expired|not found|failed|password must|HTTP error/i
    /** Текст экрана без разметки (в классах кита есть `aria-invalid`). */
    const visible = (html: string) => html.replace(/<[^>]*>/g, ' ')

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('Б-13: ответы Go входа, регистрации и кода доходят до экрана входа русским текстом; 5xx и сбой сети — общая фраза, сырой текст — в консоль', async () => {
      const A = await phone(server)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const cases: [Record<string, unknown>, () => Response | Promise<Response>, string][] = [
        [{ mode: 'login', email: 'a@b.kz', pass: 'wrong1' }, () => goReply(401, 'invalid email or password'), 'Почта или пароль не подходят.'],
        [{ mode: 'register', email: 'a@b.kz', pass: '123', displayName: 'Ильяс', householdName: 'Семья' }, () => goReply(400, 'password must be at least 6 characters long'), 'Пароль слишком короткий: нужно хотя бы 6 символов.'],
        [{ mode: 'register', email: 'a@b.kz', pass: 'password1', displayName: 'Ильяс', householdName: 'Семья' }, () => goReply(409, 'user already exists'), 'Такая почта уже зарегистрирована. Войдите с ней на вкладке «Войти».'],
        [{ mode: 'join', inviteCode: 'ZZZZ9999', displayName: 'Аруна' }, () => goReply(401, 'unauthorized'), 'Чтобы войти по коду, сначала войдите в аккаунт.'],
        [{ mode: 'join', inviteCode: 'ZZZZ9999', displayName: 'Аруна' }, () => goReply(404, 'invite code not found'), 'Код не найден. Проверьте, нет ли опечатки.'],
        [{ mode: 'join', inviteCode: 'ZZZZ9999', displayName: 'Аруна' }, () => goReply(400, 'invite code has already been used'), 'Этот код уже использован. Попросите партнёра создать новый.'],
        [{ mode: 'login', email: 'a@b.kz', pass: 'wrong1' }, () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'text/html' } }), 'Не получилось связаться с сервером. Попробуйте ещё раз.'],
        [{ mode: 'login', email: 'a@b.kz', pass: 'wrong1' }, () => Promise.reject(new TypeError('Failed to fetch')), 'Не получилось связаться с сервером. Попробуйте ещё раз.'],
      ]
      for (const [state, reply, text] of cases) {
        vi.stubGlobal('fetch', vi.fn(async () => reply()))
        const vm = await act(A.pinia, Access, '/access', 'submit', state)
        expect(vm.errorMessage).toBe(text)
        const html = await screen(A.pinia, Access, '/access', undefined, [screenMixin({ ...state, errorMessage: vm.errorMessage })])
        expect(html).toContain(text)
        expect(visible(html)).not.toMatch(ENGLISH)
      }
      expect(warn.mock.calls.map((c) => String(c[1]))).toEqual(['HTTP error 502 Bad Gateway', 'Failed to fetch'])
    })

    it('Б-14: одиночка — 403 создания кода текстом под кнопкой на Обзоре и в шторке синка; viewer не видит ни баннера, ни приглашения, ни «Начать бюджет заново»', async () => {
      server.data.people = server.data.people.slice(0, 1)
      const A = await phone(server)
      on(A)
      useAuthStore().setAuthData(authAs('member', 'a'))
      vi.stubGlobal('fetch', vi.fn(async () => goReply(403, 'only full members can create invites')))
      const text = 'Код может создать только участник с правом правки — у вас только просмотр.'

      const ov = await act(A.pinia, Overview, '/', 'makeInvite')
      expect(await screen(A.pinia, Overview, '/', undefined, [screenMixin({ inviteError: ov.inviteError })])).toContain(text)
      const sheet = await act(A.pinia, SyncBadge, '/budget', 'makeInvite', { open: true })
      const html = await screen(A.pinia, SyncBadge, '/budget', undefined, [screenMixin({ open: true, inviteError: sheet.inviteError })])
      expect(html).toContain('Пригласить второго')
      expect(html).toContain(text)
      expect(visible(html)).not.toMatch(ENGLISH)

      const V = await phone(server)
      on(V)
      useAuthStore().setAuthData(authAs('viewer', 'a'))
      expect(await screen(V.pinia, Overview, '/')).not.toContain('Создать код приглашения')
      const vSheet = await screen(V.pinia, SyncBadge, '/budget', undefined, [screenMixin({ open: true })])
      expect(vSheet).toContain('только просмотр')
      expect(vSheet).not.toContain('Пригласить второго')
      expect(vSheet).not.toContain('Начать бюджет заново')
    })

    it('Б-18: у B неотправленная офлайн-правка, A стёр всё → сеть у B: сброс сильнее — сервер и B пусты, B в мастере, покупка B не «воскресла»', async () => {
      const A = await phone(server)
      const B = await phone(server)

      setOnline(false)
      at('2026-09-26T07:01:00Z')
      on(B).store.addWish({ name: 'Пылесос', price: 90_000, by: 'b' })
      await B.store.syncHousehold(B.client)
      expect(B.store.householdDoc.wishlist).toHaveLength(1)

      setOnline(true)
      at('2026-09-26T07:02:00Z')
      on(A).store.resetAll()
      await A.store.syncHousehold(A.client)

      at('2026-09-26T07:05:00Z')
      await on(B).store.syncHousehold(B.client)
      expect(B.store.householdDoc.wishlist).toEqual([])
      expect(B.store.householdDoc.goals).toEqual([])
      expect(B.store.setupDone).toBe(false)
      expect(server.data.wishlist).toEqual([])
      expect(server.data.people).toEqual([])
    })

    it('Б-19: A переименовал себя в «Оформлении» → у B новое имя в Бюджете и шторке; пустое имя не пишется и возвращает прежнее', async () => {
      const A = await phone(server)
      const B = await phone(server)
      on(A)
      useAuthStore().setAuthData(authAs('member', 'a'))

      at('2026-09-26T07:10:00Z')
      await act(A.pinia, AppearancePanel, '/budget', 'saveName', { userName: '  Ильяс М ' })
      await A.store.syncHousehold(A.client)
      await on(B).store.syncHousehold(B.client)
      expect(await screen(B.pinia, Budget, '/budget')).toContain('Ильяс М · 10 числа')
      expect(await screen(B.pinia, SyncBadge, '/budget', undefined, [screenMixin({ open: true })])).toContain('Ильяс М')

      at('2026-09-26T07:20:00Z')
      const vm = await act(A.pinia, AppearancePanel, '/budget', 'saveName', { userName: '   ' })
      expect(vm.userName).toBe('Ильяс М')
      expect(A.store.unsent).toBe(false)
      expect(A.store.householdDoc.people.find((p) => p.id === 'a')).toMatchObject({ name: 'Ильяс М', updatedAt: '2026-09-26T07:10:00.000Z' })
    })

    it('Б-22: мелочи глазами второго телефона — рассрочка 0% «без процентов», окно пополнения «Пополнить «Отпуск»» с взносом цели в подсказке и «Внести»', async () => {
      server.data.credits = [
        { id: 'inst', name: 'Телефон', note: 'рассрочка', principal: 200_000, principalSetAt: T0, annualRate: 0, payment: 20_000, day: 25, updatedAt: T0 },
      ]
      const B = await phone(server)

      const cap = await screen(B.pinia, Capital, '/capital')
      expect(cap).toMatch(/без процентов · 10 платежей/)
      const goal = await screen(B.pinia, GoalDetail, '/goals/trip', undefined, [screenMixin({ openDepositModal: true, depositOperation: 'deposit' })])
      expect(goal).toContain('Пополнить «Отпуск»')
      expect(goal).toMatch(/placeholder="50[\s  ]000"/)
      expect(goal).toMatch(/>\s*Внести\s*</)
    })

    it('хвост Б4 «seed»: A правит «Уже накоплено», B позже офлайн вносит → у обоих и на сервере правка A + все взносы', async () => {
      const A = await phone(server)
      const B = await phone(server)

      at('2026-09-26T08:00:00Z')
      on(A).store.updateGoal('trip', { have: 150_000 })
      await A.store.syncHousehold(A.client)

      setOnline(false)
      at('2026-09-26T09:00:00Z')
      on(B).store.contribute('trip', 30_000, 'b')
      await B.store.syncHousehold(B.client)

      setOnline(true)
      await B.store.syncHousehold(B.client)
      await on(A).store.syncHousehold(A.client)
      for (const p of [A, B]) {
        const g = on(p).store.householdDoc.goals.find((x) => x.id === 'trip')!
        expect([g.seed, g.have]).toEqual([150_000, 180_000])
      }
      expect(server.data.goals[0].have).toBe(180_000)
    })
  })
})
