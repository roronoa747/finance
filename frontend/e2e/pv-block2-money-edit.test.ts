import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setActivePinia, type Pinia } from 'pinia'
import { createRenderer, createSSRApp, h, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { defaultSyncDoc } from '../src/stores/finance'
import { useAuthStore } from '../src/stores/auth'
import type { Category } from '../src/types/finance'
import { at, phone, screen, type FakeServer } from './support/family'
import {
  budgetAmounts,
  creditSchedule,
  creditTotals,
  goalSavings,
  keepQuestions,
  netWorth,
  nextCreditDue,
  nextObligationDue,
} from '../src/lib/finance'
import { money, plain } from '../src/lib/money'
import Capital from '../src/views/Capital.vue'
import Overview from '../src/views/Overview.vue'
import Budget from '../src/views/Budget.vue'
import PaidRow from '../src/components/PaidRow.vue'
import DangerZone from '../src/components/kit/DangerZone.vue'
import CreditSheet from '../src/components/capital/CreditSheet.vue'
import PayoffSheet from '../src/components/capital/PayoffSheet.vue'
import { screenMixin } from '../src/test/screenState'

/**
 * Блок 2 «Правка денег» (PV-09…PV-13): два телефона — два стора Pinia на одном
 * фейковом сервере с ревизиями и 409, как в e2e Блока 1 RP. Браузерная проверка —
 * на стенде §6 (скрипты в scratchpad сессии, не в репо).
 */

describe('PV-09: кит окон', () => {
  it('токен затемнения --scrim — в светлой и тёмной теме, окна берут цвет только из него', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8')
    const block = (sel: string) => {
      const at = css.indexOf(`${sel} {`)
      return css.slice(at, css.indexOf('\n}', at))
    }
    expect(block(':root')).toMatch(/--scrim:/)
    expect(block('.dark')).toMatch(/--scrim:/)
    expect(css).toMatch(/--color-scrim: var\(--scrim\)/)

    // Экраны блока — без литерального затемнения.
    const sheets = ['AccountSheet', 'CreditSheet', 'ObligationSheet', 'PayoffSheet'].map((n) => `../src/components/capital/${n}.vue`)
    for (const file of ['../src/views/Capital.vue', '../src/components/PaidRow.vue', ...sheets]) {
      const src = readFileSync(resolve(import.meta.dirname, file), 'utf-8')
      expect(src).not.toMatch(/bg-black|fixed inset-0|<select/)
    }
  })
})

describe('e2e / Блок 2 паритета — правка денег на двух телефонах', () => {
  let server: FakeServer
  const T0 = '2026-09-01T00:00:00.000Z'


  beforeEach(() => {
    // Таймеры подделаны: запланированный синк не уходит в настоящий apiClient.
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    vi.stubGlobal('navigator', { onLine: true })
    server = {
      rev: 1,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
        ],
        accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
        obligations: [
          { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
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

  it('PV-10: правка ставки у кредита с отметкой не меняет остаток; правка остатка — якорь; второй телефон видит день и ставку', async () => {
    const A = await phone(server)
    const B = await phone(server)

    at('2026-09-24T08:00:00Z')
    A.store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
    expect(A.store.credits[0].principal).toBe(969_500)

    at('2026-09-24T09:00:00Z')
    A.store.updateCredit('loan', { annualRate: 0.25, day: 20 })
    expect(A.store.credits[0].principal).toBe(969_500)
    expect(A.store.householdDoc.credits[0].principalSetAt).toBe(T0)
    await A.store.syncHousehold(A.client)

    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(B.store.credits[0]).toMatchObject({ annualRate: 0.25, day: 20, principal: 969_500 })
    // Следующий платёж — в новый день (сентябрь оплачен, дальше октябрь).
    expect(nextCreditDue(B.store.credits[0], B.store.payments)).toMatchObject({ period: '2026-10', day: 20 })
    const capitalB = await screen(B.pinia, Capital, '/capital?credit=loan')
    expect(capitalB).toContain('value="25,0"')
    expect(capitalB).toContain('Платёж 20 октября')

    // Сверка с банком на втором телефоне — новая база и якорь; отметка до якоря в ней.
    at('2026-09-25T08:00:00Z')
    B.store.updateCredit('loan', { principal: 960_000 })
    expect(B.store.householdDoc.credits[0].principalSetAt).toBe('2026-09-25T08:00:00.000Z')
    expect(B.store.credits[0].principal).toBe(960_000)
    await B.store.syncHousehold(B.client)
    setActivePinia(A.pinia)
    await A.store.pullHousehold(A.client)
    expect(A.store.credits[0].principal).toBe(960_000)
  })

  /** Форма Капитала на телефоне: поля заполнены, нажата кнопка формы. */
  async function submit(pinia: Pinia, path: string, state: Record<string, unknown>, action: string) {
    await screen(pinia, Capital, path, undefined, [screenMixin(state, (s) => (s[action] as () => void)())])
  }

  it('PV-11: коммуналка с оценкой из формы — «До зарплаты» спрашивает сумму; аренда в «Жильё» — d1 Бюджета, не d4', async () => {
    const A = await phone(server)
    const B = await phone(server)

    at('2026-09-24T08:00:00Z')
    await submit(A.pinia, '/capital?add=payment', { obName: 'Коммуналка', obAmount: '35 000', obDay: '8', obCategory: 'd1', obEstimate: true }, 'createObligation')
    await submit(A.pinia, '/capital?add=payment', { obName: 'Гараж', obAmount: '30 000', obDay: '9', obCategory: 'd1' }, 'createObligation')
    const util = A.store.obligations.find((o) => o.name === 'Коммуналка')!
    expect(util).toMatchObject({ category: 'd1', estimate: true, day: 8 })
    await A.store.syncHousehold(A.client)

    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    // «До зарплаты» (до 10 октября): коммуналка 8 октября — с «оценкой», её «Оплатил» откроет лист с суммой.
    const overview = await screen(B.pinia, Overview, '/')
    const until = overview.slice(overview.indexOf('Коммуналка'))
    expect(until.slice(0, until.indexOf('Оплатил'))).toContain('оценка')

    // Жильё — d1 Бюджета: аренда 220 000 + коммуналка 35 000 + гараж 30 000; в d4 их нет.
    const amounts = budgetAmounts({ ...B.store.householdDoc, credits: B.store.credits })
    expect(amounts.d1).toBe(285_000)
    expect(amounts.d4).toBe(0)

    // Нажатие «Оплатил» (критик): счёт уже известен по сентябрю — без оценки платёж
    // отмечается одним нажатием, с оценкой открывается лист с суммой, отметки нет.
    const garage = B.store.obligations.find((o) => o.name === 'Гараж')!
    for (const o of [util, garage]) B.store.markPaid('obligation', o.id, 'b', { period: '2026-09', accountId: 'card' })
    const tap = async (targetId: string, title: string) => {
      setActivePinia(B.pinia)
      let sheet: unknown
      const app = createSSRApp(PaidRow, { kind: 'obligation', targetId, period: '2026-10', title })
      app.mixin({
        created() {
          if (this.$.parent !== null) return
          ;(this.$.setupState.tap as () => void)()
          sheet = this.$.setupState.sheet
        },
      })
      await renderToString(app)
      return sheet
    }
    const october = (id: string) => B.store.payments.filter((p) => p.targetId === id && p.period === '2026-10')
    expect(await tap(util.id, 'Коммуналка')).toBe('mark')
    expect(october(util.id)).toHaveLength(0)
    expect(await tap(garage.id, 'Гараж')).toBe(null)
    expect(october(garage.id)).toHaveLength(1)
  })

  /**
   * Живой экран без браузера: рендерер Vue на простых объектах вместо DOM. В SSR
   * наблюдатели не работают, а закрытие окна чистит адрес именно наблюдателем.
   * Возвращает состояние экрана (setupState).
   */
  function mountLive(
    pinia: Pinia,
    router: ReturnType<typeof createAppRouter>,
    /** Окно Капитала само по себе (Н-3) и его пропсы — живые, от состояния экрана. */
    sheet?: { view: Component; props: () => Record<string, unknown> },
  ) {
    type N = { children: N[]; parent: N | null; text?: string }
    const node = (text?: string): N => ({ children: [], parent: null, text })
    const detach = (n: N) => {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    }
    const { createApp } = createRenderer<N, N>({
      createElement: () => node(),
      createText: (t) => node(t),
      createComment: (t) => node(t),
      setText: (n, t) => void (n.text = t),
      setElementText: (n, t) => {
        n.children = []
        n.text = t
      },
      insert: (child, parent, anchor) => {
        detach(child)
        const i = anchor ? parent.children.indexOf(anchor) : -1
        if (i < 0) parent.children.push(child)
        else parent.children.splice(i, 0, child)
        child.parent = parent
      },
      remove: detach,
      parentNode: (n) => n.parent,
      nextSibling: (n) => (n.parent ? (n.parent.children[n.parent.children.indexOf(n) + 1] ?? null) : null),
      patchProp: () => {},
      querySelector: () => null,
    })
    setActivePinia(pinia)
    const app = createApp(sheet ? { render: () => h(sheet.view, sheet.props()) } : Capital)
    app.use(router)
    // Vitest в Node собирает .vue для SSR: setup пишет свой модуль в SSR-контекст, а
    // рендер у компонента серверный. Нужен только setup с наблюдателями — рисовать нечего.
    app.provide(ssrContextKey, { modules: new Set() })
    app.config.warnHandler = (msg) => {
      if (!/missing template or render function/.test(msg)) console.warn(msg)
    }
    const vm = app.mount(node())
    const inst = sheet ? vm.$.subTree.component! : vm.$
    // setupState — внутреннее поле экземпляра, в публичных типах Vue его нет.
    return (inst as unknown as { setupState: Record<string, unknown> }).setupState
  }

  it('PV-12 (Б-15): окно, открытое по адресу, при закрытии чистит адрес — тот же «+» открывает его снова', async () => {
    const A = await phone(server)
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h-family', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h-family', user_id: 'u', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: T0 },
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/capital?add=debt')
    expect(router.currentRoute.value.fullPath).toBe('/capital?add=debt')
    const screenA = mountLive(A.pinia, router)
    expect(screenA.addDebtOpen).toBe(true)

    const navigated = () => new Promise<void>((done) => { const off = router.afterEach(() => { off(); done() }) })
    let next = navigated()
    screenA.addDebtOpen = false
    await next
    expect(router.currentRoute.value.fullPath).toBe('/capital')

    // Второй «+ Кредит или рассрочка» — новый переход, форма снова открыта.
    await router.push('/capital?add=debt')
    await nextTick()
    expect(screenA.addDebtOpen).toBe(true)

    // Строка Бюджета → кредит; из него — калькулятор: адрес держится, пока открыто хоть одно окно.
    screenA.addDebtOpen = false
    await navigated()
    await router.push('/capital?credit=loan')
    await nextTick()
    expect(screenA.selectedCreditId).toBe('loan')
    screenA.payoffCreditId = 'loan'
    screenA.selectedCreditId = null
    await nextTick()
    expect(router.currentRoute.value.query.credit).toBe('loan')
    next = navigated()
    screenA.payoffCreditId = null
    await next
    expect(router.currentRoute.value.fullPath).toBe('/capital')
    await router.push('/capital?credit=loan')
    await nextTick()
    expect(screenA.selectedCreditId).toBe('loan')

    // Кредит удалили на другом телефоне, пока окно открыто (критик): лист закрылся, id в
    // ref остался — адрес всё равно чистится, и «+» открывает форму снова.
    next = navigated()
    A.store.removeCredit('loan')
    await next
    expect(router.currentRoute.value.fullPath).toBe('/capital')
    await router.push('/capital?add=debt')
    await nextTick()
    expect(screenA.addDebtOpen).toBe(true)
  })

  it('PV-10 (критик): закрытый кредит снова открыт сверкой остатка — у модалки появляется «Оплатил»', async () => {
    const A = await phone(server)
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h-family', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h-family', user_id: 'u', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: T0 },
    })
    at('2026-09-24T08:00:00Z')
    A.store.applyPrepayment('loan', 'a', { amount: 1_000_000, mode: 'term', accountId: 'card' })
    expect(A.store.credits[0].principal).toBe(0)

    const router = createAppRouter(createMemoryHistory())
    await router.push('/capital?credit=loan')
    const capitalA = mountLive(A.pinia, router)
    // Окно кредита — `CreditSheet` (Н-3): открытый кредит берёт у экрана.
    const screenA = mountLive(A.pinia, router, { view: CreditSheet, props: () => ({ creditId: capitalA.selectedCreditId }) })
    expect(screenA.creditDue).toBe(null)

    at('2026-09-24T09:00:00Z')
    ;(screenA.onCreditPrincipal as (t: string) => void)('150 000')
    await nextTick()
    expect(A.store.credits[0].principal).toBe(150_000)
    expect(screenA.creditDue).toMatchObject({ kind: 'credit', targetId: 'loan', period: '2026-09', day: 15 })
  })

  /**
   * Приёмка Блока 2: сценарии критериев PV-10…PV-13, которых нет выше. Та же семья и
   * тот же фейковый сервер. Ожидаемые числа — литералы, посчитанные руками (формула —
   * в комментарии), а не вызовом той же функции, которую проверяем.
   */
  describe('Приёмка Блока 2 — сценарии критериев', () => {
    type ScreenState = Record<string, unknown>
    /** Нажатие на экране: обработчик поля или кнопка по имени, как их зовёт шаблон. */
    const press = (s: ScreenState, fn: string, ...args: unknown[]) => (s[fn] as (...a: unknown[]) => unknown)(...args)
    /** Кнопка сегмента или сетки нажата. */
    const pressed = (label: string) => new RegExp(`aria-pressed="true"[^>]*>\\s*${label}\\s*<`)
    /** Кусок разметки от `from` до `to` (не включая). Нет границы — падает, а не молча берёт всё. */
    const between = (html: string, from: string, to: string) => {
      const i = html.indexOf(from)
      const j = html.indexOf(to, i + from.length)
      if (i < 0 || j < 0) throw new Error(`нет «${i < 0 ? from : to}» в разметке`)
      return html.slice(i, j)
    }
    /** Значение строки «подпись — <b>значение</b>» как его видит человек. */
    const cell = (html: string, label: string) => between(html, label, '</b>').replace(/^[\s\S]*>/, '').trim()
    /** Первая сумма «N ₸» после подписи. */
    const moneyAfter = (html: string, label: string) =>
      html.slice(html.indexOf(label)).match(/\d[\d ]* ₸/)?.[0]
    const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
    const member = (slot: 'a' | 'b', role: 'member' | 'viewer' = 'member') =>
      useAuthStore().setAuthData({
        token: 't',
        user: { id: `u-${slot}`, email: `${slot}@example.com`, created_at: T0 },
        household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: T0 },
        member: { household_id: 'h-family', user_id: `u-${slot}`, slot, display_name: slot, role, joined_at: T0 },
      })
    const categories: Category[] = [
      { key: 'd1', name: 'Жильё', note: '', amount: 0, updatedAt: T0 },
      { key: 'd2', name: 'Кредиты', note: '', amount: 0, updatedAt: T0 },
      { key: 'd3', name: 'Цели', note: '', amount: 0, updatedAt: T0 },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: T0 },
    ]

    /**
     * Экран телефона — SSR на его сторе. `state` — поля экрана до рендера, `act` —
     * нажатия (обработчики экрана) до рендера; `danger` — «Удалить» в окне нажато:
     * `open` — видно предупреждение, `confirm` — удаление подтверждено.
     */
    async function page(
      pinia: Pinia,
      view: Component,
      path: string,
      opts: { props?: Record<string, unknown>; state?: ScreenState; act?: (s: ScreenState) => void; danger?: 'open' | 'confirm' } = {},
    ) {
      return screen(pinia, view, path, opts.props, [
        screenMixin(opts.state, opts.act),
        {
          created() {
            if (!opts.danger || this.$.type !== DangerZone) return
            if (opts.danger === 'open') this.$.setupState.confirm = true
            else this.$.emit('confirm')
          },
        },
      ])
    }

    it('приёмка: PV-11 — «Интернет» из формы без оценки — подписка (второй спрашивает «Оставить?»); день и «Чьё это» аренды — у второго в Бюджете и Капитале', async () => {
      const A = await phone(server)
      const B = await phone(server)

      at('2026-09-24T08:00:00Z')
      // Раздел и оценку не трогаем — дефолт формы как в React: «Еда и быт», оценка снята.
      await submit(A.pinia, '/capital?add=payment', { obName: 'Интернет', obAmount: '6 990', obDay: '12' }, 'createObligation')
      // Свет — тоже быт, но сумма плавает: это не подписка.
      await submit(A.pinia, '/capital?add=payment', { obName: 'Свет', obAmount: '12 000', obDay: '18', obEstimate: true }, 'createObligation')
      expect(A.store.obligations.find((o) => o.name === 'Интернет')).toMatchObject({ category: 'd4', estimate: false, day: 12 })
      expect(A.store.obligations.find((o) => o.name === 'Свет')).toMatchObject({ category: 'd4', estimate: true })

      // Окно аренды на A: день 5 → 3, «Чьё это» — Аруна.
      at('2026-09-24T08:10:00Z')
      await page(A.pinia, Capital, '/capital?obligation=rent', {
        act: (s) => {
          press(s, 'onObligationDay', '3')
          press(s, 'setObligationWho', 'b')
        },
      })
      expect(A.store.obligations.find((o) => o.id === 'rent')).toMatchObject({ day: 3, who: 'b' })
      await A.store.syncHousehold(A.client)

      await on(B).store.pullHousehold(B.client)
      const rentB = () => B.store.obligations.find((o) => o.id === 'rent')!
      expect(rentB()).toMatchObject({ day: 3, who: 'b' })
      // Сентябрь не оплачен — платёж этого месяца, но уже 3-го.
      expect(nextObligationDue(rentB(), B.store.payments)).toMatchObject({ period: '2026-09', day: 3 })
      // Бюджет второго (список месяца): аренда 3 сентября, а не 5-го.
      const list = await page(B.pinia, Budget, '/budget', { props: { initialView: 'list' } })
      const rentRow = between(list, 'Аренда', 'Оплатил')
      expect(rentRow).toContain('3 сентября')
      expect(rentRow).not.toContain('5 сентября')
      // Капитал второго: у аренды хозяйка в подписи; в окне «Чьё это» нажата Аруна.
      expect(between(await page(B.pinia, Capital, '/capital'), 'Аренда', '</button>')).toContain('Аруна')
      expect(await page(B.pinia, Capital, '/capital?obligation=rent')).toMatch(pressed('Аруна'))

      // «Общее» на втором — хозяина нет (null, а не строка 'all').
      at('2026-09-24T08:20:00Z')
      await page(B.pinia, Capital, '/capital?obligation=rent', { act: (s) => press(s, 'setObligationWho', 'all') })
      expect(rentB().who).toBeNull()
      const shared = between(await page(B.pinia, Capital, '/capital'), 'Аренда', '</button>')
      expect(shared).toContain(money(220_000))
      expect(shared).not.toContain('Аруна')

      // «Оставить?» (RP-09): только что заведённое в этом квартале не спрашиваем…
      expect(keepQuestions(B.store.obligations)).toEqual([])
      expect(await page(B.pinia, Overview, '/')).not.toContain('Оставить «')
      // …с нового квартала второй телефон спрашивает про подписку «Интернет» — не про
      // «Свет» (оценка) и не про аренду (жильё).
      at('2026-10-02T04:00:00Z')
      expect(keepQuestions(B.store.obligations).map((o) => o.name)).toEqual(['Интернет'])
      const overview = await page(B.pinia, Overview, '/')
      expect(overview).toContain('Оставить «Интернет»?')
      expect(overview).toContain(`${money(6_990)} в месяц`)
      expect(overview).not.toContain('Оставить «Свет»?')
    })

    it('приёмка: PV-11 — план суммы на A: у второго «История суммы» — две строки с причиной, в месяц перехода «станет с» → «с»; viewer видит историю без полей', async () => {
      const A = await phone(server)
      const B = await phone(server)
      const plan = { obPlanning: true, obNewAmount: '200 000', obFromMonth: '2026-11', obReason: 'Переезд' }

      at('2026-09-24T08:00:00Z')
      // Разница до записи: 200 000 − 220 000 = −20 000 в месяц; × 12 = 240 000 за год.
      const planning = await page(A.pinia, Capital, '/capital?obligation=rent', { state: plan })
      expect(planning).toContain(`С ноября 2026 освободится <b>${money(20_000)}</b> в месяц — ${money(240_000)} за год.`)
      let afterPlan: unknown[] = []
      await page(A.pinia, Capital, '/capital?obligation=rent', {
        state: plan,
        act: (s) => {
          press(s, 'planObligation')
          afterPlan = [s.obNewAmount, s.obPlanning]
        },
      })
      // Поле очищено, блок планирования закрыт.
      expect(afterPlan).toEqual(['', false])
      expect(A.store.obligations.find((o) => o.id === 'rent')!.versions).toEqual([
        { from: '2000-01', amount: 220_000 },
        { from: '2026-11', amount: 200_000, reason: 'Переезд' },
      ])
      await A.store.syncHousehold(A.client)

      on(B)
      member('b', 'viewer')
      await B.store.pullHousehold(B.client)
      // Второй профиль (viewer): история — новые сверху, с причиной; полей и кнопок нет.
      const modal = await page(B.pinia, Capital, '/capital?obligation=rent')
      const history = between(modal, 'История суммы', 'Готово')
      // Новые сверху: будущая строка раньше действующей.
      expect(history.indexOf('станет с ноября 2026')).toBeGreaterThan(-1)
      expect(history.indexOf('станет с ноября 2026')).toBeLessThan(history.indexOf('с января 2000'))
      const future = between(history, 'станет с ноября 2026', 'с января 2000')
      expect(future).toContain(money(200_000))
      expect(future).toContain('Переезд')
      expect(history.slice(history.indexOf('с января 2000'))).toContain(money(220_000))
      expect(moneyAfter(modal, 'Сумма сейчас')).toBe(money(220_000))
      expect(modal).not.toContain('Запланировать изменение')
      expect(modal).not.toContain('Удалить обязательство')
      expect(modal).not.toContain('<input')
      // Обзор второго — событие «освободится» из того же плана.
      expect(await page(B.pinia, Overview, '/')).toContain(`Освободится ${money(20_000)} в месяц`)

      // Ноябрь: план наступил — строка «с ноября», сумма сейчас 200 000.
      at('2026-11-02T04:00:00Z')
      const november = await page(B.pinia, Capital, '/capital?obligation=rent')
      const hist = between(november, 'История суммы', 'Готово')
      expect(hist).toContain('с ноября 2026')
      expect(hist).not.toContain('станет с')
      expect(moneyAfter(november, 'Сумма сейчас')).toBe(money(200_000))
    })

    it('приёмка: PV-12 — удаление счёта с целями на A: предупреждение с их именами, у второго цели отвязаны и снова в капитале', async () => {
      server.data.accounts.push({ id: 'safe', name: 'Сейф', note: '', amount: 300_000, amountSetAt: T0, kind: 'cash', updatedAt: T0 })
      server.data.goals = [
        { id: 'car', name: 'Машина', need: 3_000_000, seed: 450_000, have: 450_000, monthly: 100_000, hue: 'teal', planPct: 0, accountId: 'safe', movements: [], updatedAt: T0 },
        { id: 'trip', name: 'Отпуск', need: 600_000, seed: 100_000, have: 100_000, monthly: 50_000, hue: 'blue', planPct: 0, accountId: 'safe', movements: [], updatedAt: T0 },
        { id: 'flat', name: 'Квартира', need: 6_000_000, seed: 200_000, have: 200_000, monthly: 150_000, hue: 'plum', planPct: 0, movements: [], updatedAt: T0 },
      ]
      const A = await phone(server)
      const B = await phone(server)

      // До: счета 1 000 000 + 300 000; по целям отдельно — только «Квартира» 200 000
      // (остальные лежат на «Сейфе»); долг 1 000 000 → капитал 500 000.
      const before = await page(B.pinia, Capital, '/capital')
      expect(moneyAfter(before, 'Чистый капитал')).toBe(money(500_000))
      expect(moneyAfter(before, 'На всех счетах')).toBe(money(1_300_000))
      expect(moneyAfter(before, 'Накоплено по целям')).toBe(money(200_000))

      // «Удалить счёт» в окне «Сейфа» на A: текст React с обеими целями на нём.
      at('2026-09-24T08:00:00Z')
      const warning = await page(A.pinia, Capital, '/capital', { state: { selectedAccountId: 'safe' }, danger: 'open' })
      expect(warning).toContain(
        'Счёт исчезнет у обоих участников. Отменить нельзя. Накопления по целям «Машина», «Отпуск» останутся на месте: они снова будут считаться отдельно, а не лежащими на этом счёте.',
      )
      expect(warning).not.toContain('«Квартира»')
      await page(A.pinia, Capital, '/capital', { state: { selectedAccountId: 'safe' }, danger: 'confirm' })
      expect(A.store.accounts.find((a) => a.id === 'safe')?.deletedAt).toBe('2026-09-24T08:00:00.000Z')
      await A.store.syncHousehold(A.client)

      await on(B).store.pullHousehold(B.client)
      const goal = (id: string) => B.store.goals.find((g) => g.id === id)!
      expect(goal('car')).toMatchObject({ accountId: null, have: 450_000, updatedAt: '2026-09-24T08:00:00.000Z' })
      expect(goal('trip')).toMatchObject({ accountId: null, have: 100_000 })
      expect(goal('flat').updatedAt).toBe(T0)
      // После: счёт ушёл из капитала целиком (−300 000 — «На всех счетах» ровно на сумму
      // счёта), накопления его целей снова считаются отдельно: 450 000 + 100 000 + 200 000
      // = 750 000; капитал 1 000 000 + 750 000 − 1 000 000 = 750 000.
      expect(goalSavings(B.store.goals)).toBe(750_000)
      expect(netWorth(B.store.accounts, B.store.credits, B.store.goals)).toBe(750_000)
      const after = await page(B.pinia, Capital, '/capital')
      expect(moneyAfter(after, 'Чистый капитал')).toBe(money(750_000))
      expect(moneyAfter(after, 'На всех счетах')).toBe(money(1_000_000))
      expect(moneyAfter(after, 'Накоплено по целям')).toBe(money(750_000))
      expect(after).not.toContain('Сейф')
    })

    it('приёмка: PV-12 — правка валютного счёта на A (курс, затем сумма в валюте): у второго тенге по курсу, строка списка согласована', async () => {
      server.data.accounts.push({
        id: 'usd', name: 'Доллары', note: '', amount: 512_340, amountSetAt: T0, kind: 'cash',
        currency: 'USD', foreignAmount: 1_000, rate: 512.34, rateAt: T0, updatedAt: T0,
      })
      const A = await phone(server)
      const B = await phone(server)
      const usd = (p: typeof A) => p.store.accounts.find((a) => a.id === 'usd')!

      // Курс 512,34 → 479,26: 1 000 × 479,26 = 479 260 ₸, дата курса — сейчас.
      at('2026-09-24T08:00:00Z')
      await page(A.pinia, Capital, '/capital', { state: { selectedAccountId: 'usd' }, act: (s) => press(s, 'onAccountRate', '479,26') })
      expect(usd(A)).toMatchObject({ rate: 479.26, foreignAmount: 1_000, amount: 479_260, rateAt: '2026-09-24T08:00:00.000Z' })
      // Сумма в валюте 1 000 → 1 337: 1 337 × 479,26 = 640 770,62 → 640 771 ₸ (целые, округление).
      at('2026-09-24T09:00:00Z')
      await page(A.pinia, Capital, '/capital', { state: { selectedAccountId: 'usd' }, act: (s) => press(s, 'onForeignAmount', '1 337') })
      await A.store.syncHousehold(A.client)

      await on(B).store.pullHousehold(B.client)
      expect(usd(B)).toMatchObject({
        currency: 'USD', foreignAmount: 1_337, rate: 479.26, amount: 640_771,
        // Курс меняли в 08:00; сумма в валюте его дату не двигает.
        rateAt: '2026-09-24T08:00:00.000Z',
        amountSetAt: '2026-09-24T09:00:00.000Z',
      })
      expect(Number.isInteger(usd(B).amount)).toBe(true)

      // Строка списка второго: валюта и курс в подписи и тенге в сумме — одни и те же.
      const capital = await page(B.pinia, Capital, '/capital')
      const row = between(capital, 'Доллары', '</button>')
      expect(row).toContain(`${plain(1_337)} USD · курс 479,26`)
      expect(row).toContain(money(640_771))
      expect(row).not.toContain(money(512_340))
      expect(row).not.toContain(money(479_260))
      // 1 000 000 на карте + 640 771.
      expect(moneyAfter(capital, 'На всех счетах')).toBe(money(1_640_771))
      const modal = await page(B.pinia, Capital, '/capital', { state: { selectedAccountId: 'usd' } })
      expect(modal).toContain(`value="${plain(1_337)}"`)
      expect(modal).toContain('value="479,26"')
      expect(modal).toContain(`В капитале счёт стоит как ${money(640_771)} — по этому курсу.`)
    })

    it('приёмка: PV-13 — отметки и досрочка на двух телефонах: «За всё время», проценты в Бюджете, строка кредита, график = остаток', async () => {
      server.data.categories = categories
      const A = await phone(server)
      const B = await phone(server)
      // Проценты месяца — round(остаток × 33% / 12). До отметок: 1 000 000 → 27 500.
      expect(await page(B.pinia, Budget, '/budget')).toContain(`из них проценты банку ${money(27_500)} в месяц`)

      // A: «Оплатил» за сентябрь — проценты 27 500, в долг 58 000 − 27 500 = 30 500.
      at('2026-09-24T08:00:00Z')
      on(A).store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      expect(B.store.credits[0].principal).toBe(969_500)
      expect(creditTotals(B.store.payments, 'loan')).toEqual({ body: 30_500, interest: 27_500, count: 1 })
      expect(await page(B.pinia, Capital, '/capital?credit=loan')).toContain(
        `За всё время: в долг ${money(30_500)}, банку ${money(27_500)} (1 платёж)`,
      )
      // 969 500 × 0,33 / 12 = 26 661,25 → 26 661.
      expect(await page(B.pinia, Budget, '/budget')).toContain(`из них проценты банку ${money(26_661)} в месяц`)

      // B: разовая досрочка 100 000 в октябре, до октябрьской отметки — вся в тело;
      // остаток 969 500 − 100 000 = 869 500.
      at('2026-10-10T05:00:00Z')
      on(B).store.applyPrepayment('loan', 'b', { amount: 100_000, mode: 'term', accountId: 'card' })
      await B.store.syncHousehold(B.client)
      await on(A).store.pullHousehold(A.client)
      expect(A.store.credits[0].principal).toBe(869_500)
      expect(creditTotals(A.store.payments, 'loan')).toEqual({ body: 130_500, interest: 27_500, count: 2 })
      expect(await page(A.pinia, Capital, '/capital?credit=loan')).toContain(
        `За всё время: в долг ${money(130_500)}, банку ${money(27_500)} (2 платежа)`,
      )
      // 869 500 × 0,33 / 12 = 23 911,25 → 23 911.
      expect(await page(A.pinia, Budget, '/budget')).toContain(`из них проценты банку ${money(23_911)} в месяц`)

      // График на обоих: Σ «в долг» = остаток 869 500 — досрочка октября уже в остатке и
      // второй раз не вычитается. Строк до закрытия n = −ln(1 − P·i/A) / ln(1 + i),
      // P 869 500, i 0,0275, A 58 000 → 19,59 → 20 (октябрь 2026 … май 2028). Октябрь:
      // проценты 23 911, в долг 34 089, остаток 835 411. Последний (май 2028): остаток
      // 33 540 + round(33 540 × 0,0275) = 922 → 34 462.
      for (const P of [A, B]) {
        const rows = creditSchedule(P.store.credits[0], P.store.payments)
        expect(rows.reduce((a, r) => a + r.body, 0)).toBe(869_500)
        expect(rows).toHaveLength(20)
        for (const r of rows) expect(r.body + r.interest).toBe(r.amount)
        expect(rows[0]).toMatchObject({ period: '2026-10', paid: false, amount: 58_000, body: 34_089, interest: 23_911, extra: 100_000, left: 835_411 })
        expect(rows.at(-1)).toMatchObject({ period: '2028-05', amount: 34_462, body: 33_540, interest: 922, left: 0 })
      }

      // A: «Оплатил» за октябрь одним нажатием (счёт прошлой оплаты — карта досрочки).
      at('2026-10-15T05:00:00Z')
      const before = creditTotals(A.store.payments, 'loan')
      const oct15 = on(A).store.markPaid('credit', 'loan', 'a')!
      expect(oct15).toMatchObject({ period: '2026-10', amount: 58_000, principal: 34_089, accountId: 'card' })
      await A.store.syncHousehold(A.client)
      await on(B).store.pullHousehold(B.client)
      // «За всё время» выросло ровно на тело и проценты записи: +34 089 и +23 911.
      const totals = creditTotals(B.store.payments, 'loan')
      expect(totals).toEqual({ body: 164_589, interest: 51_411, count: 3 })
      expect({ body: totals.body - before.body, interest: totals.interest - before.interest }).toEqual({ body: 34_089, interest: 23_911 })
      const modalB = await page(B.pinia, Capital, '/capital?credit=loan', { state: { scheduleOpen: true } })
      expect(modalB).toContain(`За всё время: в долг ${money(164_589)}, банку ${money(51_411)} (3 платежа)`)

      // График второго после отметки: октябрь оплачен (по записи, с досрочкой), дальше —
      // от остатка 835 411: Σ «в долг» = 835 411, n = 18,59 → 19 строк (ноябрь … май 2028).
      // Ноябрь: 835 411 × 0,0275 = 22 973,8 → 22 974, в долг 35 026, остаток 800 385.
      const rows = creditSchedule(B.store.credits[0], B.store.payments)
      const unpaid = rows.filter((r) => !r.paid)
      expect(unpaid.reduce((a, r) => a + r.body, 0)).toBe(835_411)
      expect(unpaid).toHaveLength(19)
      expect(rows[0]).toMatchObject({ period: '2026-10', paid: true, amount: 58_000, body: 34_089, interest: 23_911, extra: 100_000, left: 835_411 })
      expect(rows[1]).toMatchObject({ period: '2026-11', paid: false, amount: 58_000, body: 35_026, interest: 22_974, left: 800_385 })
      expect(modalB.match(/aria-label="оплачен"/g)).toHaveLength(1)
      expect(modalB.indexOf('aria-label="оплачен"')).toBeLessThan(modalB.indexOf('окт 2026'))
      const oct = between(modalB, 'окт 2026', 'ноя 2026')
      for (const n of [58_000, 34_089, 23_911, 835_411]) expect(oct).toContain(plain(n))
      expect(oct).toContain(`досрочка ${plain(100_000)}`)
      const nov = between(modalB, 'ноя 2026', 'дек 2026')
      for (const n of [58_000, 35_026, 22_974, 800_385]) expect(nov).toContain(plain(n))
      expect(modalB).toContain('май 2028')
      expect(modalB).not.toContain('июн 2028')
      // Строка кредита второго — ноябрь от остатка 835 411: проценты 835 411 × 0,33 / 12 =
      // 22 973,8 → 22 974, в долг 58 000 − 22 974 = 35 026.
      expect(between(await page(B.pinia, Capital, '/capital'), 'Кредит', '</button>')).toContain(
        `платёж ${plain(58_000)} ₸: в долг ${plain(35_026)}, банку ${plain(22_974)}`,
      )
      // Бюджет второго: проценты месяца 22 974; «Оплатил» октября — по записи 34 089 / 23 911.
      expect(await page(B.pinia, Budget, '/budget')).toContain(`из них проценты банку ${money(22_974)} в месяц`)
      const loanRow = between(await page(B.pinia, Budget, '/budget', { props: { initialView: 'list' } }), 'Кредит', '</button>')
      expect(loanRow).toContain(`в долг ${plain(34_089)}`)
      expect(loanRow).toContain(`банку ${plain(23_911)}`)
    })

    it('приёмка: PV-10 — правка платежа на A: у второго ни якоря, ни нового остатка; «долг не закрывается» в окне и калькуляторе; возврат платежа — выводы', async () => {
      const A = await phone(server)
      const B = await phone(server)

      at('2026-09-24T08:00:00Z')
      on(A).store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
      // Платёж 58 000 → 20 000 из окна кредита — меньше процентов 26 661.
      at('2026-09-24T09:00:00Z')
      await page(A.pinia, Capital, '/capital?credit=loan', { act: (s) => press(s, 'onCreditPayment', '20 000') })
      await A.store.syncHousehold(A.client)

      await on(B).store.pullHousehold(B.client)
      // База и якорь прежние (1 000 000 от 1 сентября), остаток из отметки — 969 500.
      expect(B.store.householdDoc.credits[0]).toMatchObject({ principal: 1_000_000, principalSetAt: T0, payment: 20_000 })
      expect(B.store.credits[0].principal).toBe(969_500)
      const modal = await page(B.pinia, Capital, '/capital?credit=loan')
      expect(modal).toContain('При таком платеже долг не закрывается: проценты съедают его целиком.')
      expect(modal).not.toContain('Платежей осталось')
      expect(modal).not.toContain('График платежей')
      // «Оплатил» октября в окне: весь платёж банку (20 000 < 26 661), в долг 0.
      const due = between(modal, 'Платёж 15 октября', 'Другая сумма или счёт')
      expect(due).toContain(money(20_000))
      expect(due).toContain('в долг 0')
      expect(due).toContain(`банку ${plain(20_000)}`)
      const payoff = await page(B.pinia, Capital, '/capital?payoff=loan')
      expect(cell(payoff, 'Переплата, если не трогать')).toBe('долг не закрывается')
      expect(cell(payoff, 'Осталось платежей')).toBe('—')
      expect(payoff).not.toContain('Отдача падает')

      // Второй возвращает платёж 60 000: n = −ln(1 − 969 500 × 0,0275 / 60 000) / ln(1,0275)
      // = 21,66 → 22 платежа; переплата 60 000 × 21,6606 − 969 500 = 330 138.
      at('2026-09-24T10:00:00Z')
      await page(B.pinia, Capital, '/capital?credit=loan', { act: (s) => press(s, 'onCreditPayment', '60 000') })
      const fixed = await page(B.pinia, Capital, '/capital?credit=loan')
      expect(cell(fixed, 'Платежей осталось')).toBe('22')
      expect(cell(fixed, 'Переплата до конца')).toBe(money(330_138))
      await B.store.syncHousehold(B.client)
      await on(A).store.pullHousehold(A.client)
      expect(A.store.householdDoc.credits[0]).toMatchObject({ principal: 1_000_000, principalSetAt: T0, payment: 60_000 })
      expect(A.store.credits[0].principal).toBe(969_500)
    })

    it('приёмка: PV-10 — калькулятор: кредит А с суммой → кредит Б — поле пустое; рассрочка второго, закрытая досрочкой, — «долг закрыт»', async () => {
      const A = await phone(server)
      const B = await phone(server)

      // B заводит рассрочку 240 000 по 20 000 без процентов из формы долга.
      at('2026-09-24T08:00:00Z')
      await page(B.pinia, Capital, '/capital?add=debt', {
        state: { debtName: 'Рассрочка', debtPrincipal: '240 000', debtPayment: '20 000', debtMode: 'none', debtDay: '25' },
        act: (s) => press(s, 'createDebt'),
      })
      const inst = B.store.credits.find((c) => c.name === 'Рассрочка')!
      expect(inst).toMatchObject({ principal: 240_000, annualRate: 0, payment: 20_000, day: 25 })
      await B.store.syncHousehold(B.client)
      await on(A).store.pullHousehold(A.client)

      // Живой экран A: калькулятор кредита «Кредит», разово 100 000.
      on(A)
      member('a')
      const router = createAppRouter(createMemoryHistory())
      await router.push('/capital?payoff=loan')
      const screenA = mountLive(A.pinia, router)
      expect(screenA.payoffCreditId).toBe('loan')
      // Калькулятор — окно `PayoffSheet` (Н-3): открытый кредит берёт у экрана.
      const payoffA = mountLive(A.pinia, router, { view: PayoffSheet, props: () => ({ creditId: screenA.payoffCreditId }) })
      payoffA.payoffMode = 'once'
      payoffA.payoffAmount = '100 000'
      payoffA.applyMode = 'payment'
      await nextTick()
      // 1 000 000 − 100 000 = 900 000.
      expect(payoffA.applyPlan).toMatchObject({ paid: 100_000, left: 900_000 })
      // Другой кредит — чистый калькулятор: сумма пустая, режим «каждый месяц», и
      // «Снизить платёж» кредита «Кредит» не переходит к рассрочке (клинап).
      screenA.payoffCreditId = inst.id
      await nextTick()
      expect(payoffA.payoffAmount).toBe('')
      expect(payoffA.payoffMode).toBe('monthly')
      expect(payoffA.applyMode).toBe('term')
      expect(payoffA.applyPlan).toBe(null)

      // Калькулятор рассрочки на A: 240 000 / 20 000 = 12 платежей, переплаты 0;
      // подсказка суммы — первый чип: половина платежа 10 000.
      const open = await page(A.pinia, Capital, `/capital?payoff=${inst.id}`)
      expect(cell(open, 'Осталось платежей')).toBe('12')
      expect(cell(open, 'Переплата, если не трогать')).toBe(money(0))
      expect(open).toContain(`placeholder="${plain(10_000)}"`)
      expect(open).toContain('Впишите сумму, которую действительно можете внести.')

      // B закрывает рассрочку досрочкой целиком.
      at('2026-09-24T09:00:00Z')
      on(B).store.applyPrepayment(inst.id, 'b', { amount: 240_000, mode: 'term', accountId: 'card' })
      await B.store.syncHousehold(B.client)
      await on(A).store.pullHousehold(A.client)
      expect(A.store.credits.find((c) => c.id === inst.id)!.principal).toBe(0)
      const closed = await page(A.pinia, Capital, `/capital?payoff=${inst.id}`)
      expect(cell(closed, 'Переплата, если не трогать')).toBe('долг закрыт')
      expect(cell(closed, 'Осталось платежей')).toBe('—')
      expect(closed).toContain('Применённые досрочки')
      expect(closed).toContain(`в долг ${plain(240_000)} · банку 0`)
      expect(await page(A.pinia, Capital, `/capital?credit=${inst.id}`)).toContain(
        `За всё время: в долг ${money(240_000)}, банку ${money(0)} (1 платёж)`,
      )
    })
  })
})
