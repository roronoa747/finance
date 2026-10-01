import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain } from '@/lib/money'
import { groupTotal } from '@/lib/finance'
import type { Obligation } from '@/types/finance'
import PaidRow from './PaidRow.vue'
import Capital from '@/views/Capital.vue'
import Dreams from '@/views/Dreams.vue'
import Money from '@/views/Money.vue'
import History from '@/views/History.vue'
import Budget from '@/views/Budget.vue'
import { renderScreen, screenMixin } from '@/test/screenState'

describe('RP-07: «Оплатил» в интерфейсе (SSR)', () => {
  const storage = new Map<string, string>()
  const T0 = '2026-09-01T00:00:00.000Z'

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
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z')) // 24 сентября, Алматы
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** Семья с арендой и кредитом; `extra` — обязательства сверх аренды. */
  function family(role: 'member' | 'viewer' = 'member', extra: Obligation[] = []) {
    useAuthStore().setAuthData({
      token: 't',
      user: { id: 'u', email: 'u@example.com', created_at: T0 },
      household: { id: 'h', name: 'Семья', created_by: 'u', created_at: T0 },
      member: { household_id: 'h', user_id: 'u', slot: 'a', display_name: 'Ильяс', role, joined_at: T0 },
    })
    const store = useFinanceStore()
    store.setHouseholdDoc(
      {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }],
        accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
        obligations: [
          { id: 'rent', name: 'Аренда', note: '', day: 28, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
          ...extra,
        ],
        credits: [
          { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
        ],
      },
      1,
    )
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'))
    return store
  }

  const row = (props: Record<string, unknown>) => renderToString(createSSRApp(PaidRow, props))

  async function page(view: Component, path: string, props?: Record<string, unknown>) {
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    const app = createSSRApp(view, props)
    app.use(router)
    return renderToString(app)
  }

  const rent = { kind: 'obligation', targetId: 'rent', period: '2026-09', title: 'Аренда', note: '28 сентября' }
  const loan = { kind: 'credit', targetId: 'loan', period: '2026-09', title: 'Кредит', note: '15 сентября' }

  it('неотмеченный платёж — кнопка «Оплатил» и сумма по графику, без упрёка даже после срока', async () => {
    family()
    const html = await row(loan)
    expect(html).toContain('Оплатил')
    expect(html).toContain(money(58_000))
    expect(html).toContain('15 сентября')
    expect(html).not.toMatch(/просроч|долж/i)
  })

  it('отмеченный — «оплачено», следующий платёж; у кредита — новый остаток', async () => {
    const store = family()
    store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    store.markPaid('credit', 'loan', 'a', { accountId: 'card' })

    const r = await row(rent)
    expect(r).toContain(`оплачено · дальше 28 октября · ${plain(220_000)} ₸`)
    expect(r).not.toContain('Оплатил')

    const l = await row(loan)
    expect(l).toContain(`дальше 15 октября · ${plain(58_000)} ₸`)
    expect(l).toContain(`остаток ${plain(969_500)} ₸`)
    expect(l).toContain('Оплачено — подробнее')
  })

  it('viewer видит отметки, но кнопок нет', async () => {
    const store = family('viewer')
    expect(await row(rent)).not.toContain('Оплатил')
    expect(await row({ ...rent, more: true })).not.toContain('Другая сумма или счёт')

    // Отметку поставил участник (пришла синком) — viewer её видит.
    store.markPaid('obligation', 'rent', 'b', { accountId: 'card' })
    const html = await row(rent)
    expect(html).toContain('оплачено')
    expect(html).not.toContain('подробнее')
  })

  it('модалка кредита в Капитале: отметка уменьшает остаток, снятие возвращает', async () => {
    const store = family()
    const before = await page(Capital, '/capital?credit=loan')
    expect(before).toContain('Остаток долга')
    expect(before).toContain(money(1_000_000))
    expect(before).toContain('Платёж 15 сентября')
    expect(before).toContain('Другая сумма или счёт')

    store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
    const after = await page(Capital, '/capital?credit=loan')
    expect(after).toContain(money(969_500))
    // Открытая заново модалка предлагает уже следующий платёж.
    expect(after).toContain('Платёж 15 октября')

    store.unmarkPaid('credit', 'loan', '2026-09')
    const back = await page(Capital, '/capital?credit=loan')
    expect(back).toContain(money(1_000_000))
    expect(back).toContain('Платёж 15 сентября')
  })

  it('модалка обязательства: «Оплатил» рядом с суммой', async () => {
    family()
    const html = await page(Capital, '/capital?obligation=rent')
    expect(html).toContain('Платёж 28 сентября')
    expect(html).toContain('Оплатил')
  })

  // Пивот 3 (Р-32): «Впереди» заменила сводка «До зарплаты» — её лист держит те же строки «Оплатил»
  // от сегодня до зарплаты (24 сентября → 10 октября); полный список месяца — «Платежи» (B2C-42).
  /** Лист «До зарплаты» открыт; текст листа — отдельно от экрана (в SSR лист рендерится на месте). */
  async function paydaySheet() {
    const html = await renderScreen(Money, '/money', undefined, [screenMixin({ open: true })])
    expect(html).toContain('role="dialog"')
    // Лист — внутри сводки, сразу за ним — квадраты «Денег».
    const at = html.indexOf('role="dialog"')
    return { screen: html.slice(0, at), sheet: html.slice(at, html.indexOf('aria-label="Деньги"', at)) }
  }

  it('«Деньги», лист «До зарплаты»: строки с «Оплатил», оплаченное уходит вниз с отметкой; сводка — сколько и хватит ли', async () => {
    const store = family('member', [sub('net', 'Интернет', 10_000, { category: 'd1', day: 30 })])

    // Аренда 28-го раньше интернета 30-го; кредит 15-го уже прошёл — не «до зарплаты».
    const before = await paydaySheet()
    expect(before.sheet.indexOf('Аренда')).toBeLessThan(before.sheet.indexOf('Интернет'))
    expect(before.sheet).toContain(money(220_000))
    expect(before.sheet.match(/Оплатил/g)).toHaveLength(2)
    expect(before.sheet).not.toContain('Кредит')
    expect(before.screen).toContain(`2 списания · ${plain(230_000)} ₸ · остаётся ${plain(770_000)} ₸`)

    // Оплачен ранний платёж (аренда 28-го) — он уходит под интернет 30-го, с отметкой.
    store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    const paid = await paydaySheet()
    expect(paid.sheet.indexOf('Интернет')).toBeLessThan(paid.sheet.indexOf('Аренда'))
    expect(paid.sheet).toContain('оплачено · дальше')
    // Деньги уже ушли с карты (1 000 000 − 220 000): в сумму «до зарплаты» аренда не входит второй раз.
    expect(paid.screen).toContain(`1 списание · ${plain(10_000)} ₸ · остаётся ${plain(770_000)} ₸`)
    expect(await page(History, '/money/history')).not.toContain('Впереди')
  })

  it('Бюджет, список: «Оплатил» у платежей по графику, у зарплат — нет', async () => {
    family()
    const html = await page(Budget, '/budget', { initialView: 'list' })
    expect(html.match(/Оплатил/g)).toHaveLength(2)
    expect(html).toContain('Зарплата · Ильяс')
  })

  it('PV-09: строка на kit/Row — отклик и шеврон у кликабельной, «Оплатил» вне кнопки строки', async () => {
    family()
    const chevron = 'M1 1l5.5 6L1 13'
    const html = await row({ ...rent, clickable: true })
    expect(html).toContain('hover:bg-surface-2 active:bg-surface-3')
    expect(html).toContain(chevron)
    // Кнопка строки закрывается раньше, чем начинается «Оплатил»: кнопка в кнопке недопустима.
    const rowButton = html.indexOf('<button')
    expect(html.indexOf('</button>', rowButton)).toBeLessThan(html.indexOf('Оплатил'))
    expect(html.indexOf('<button', rowButton + 1)).toBeLessThan(html.indexOf('Оплатил'))
    // Без clickable — ни шеврона, ни отклика (строка «До зарплаты»).
    const plainRow = await row(rent)
    expect(plainRow).not.toContain(chevron)
    expect(plainRow).not.toContain('hover:bg-surface-2')
  })

  it('PV-13: у кредита — в долг и банку: в строке по графику, после отметки — по записи, в листе «оплачено»', async () => {
    const store = family()
    // 1 000 000 × 0,33 / 12 = 27 500 банку, 30 500 в долг.
    const before = await row(loan)
    expect(before).toContain(`в долг ${plain(30_500)}`)
    expect(before).toContain(`банку ${plain(27_500)}`)
    // Аренда — не кредит: разбивки нет.
    expect(await row(rent)).not.toContain('в долг')

    store.markPaid('credit', 'loan', 'a', { amount: 60_000, accountId: 'card' })
    const after = await row(loan)
    expect(after).toContain(`в долг ${plain(32_500)}`)
    expect(after).toContain(`банку ${plain(27_500)}`)

    const app = createSSRApp(PaidRow, loan)
    app.mixin({
      created() {
        if (this.$.parent === null) this.$.setupState.sheet = 'paid'
      },
    })
    const sheet = await renderToString(app)
    expect(sheet).toContain('Из них')
    expect(sheet).toContain(`в долг ${plain(32_500)} · банку ${plain(27_500)}`)
  })

  it('PV-09: в Бюджете платёж — «−N», как соседние строки; в «Деньгах» («Впереди») — сумма с ₸', async () => {
    const store = family()
    const budget = await page(Budget, '/budget', { initialView: 'list' })
    expect(budget).toContain(`−${plain(220_000)}`)
    expect(budget).toContain(`−${plain(58_000)}`)
    expect(budget).toContain(`+${plain(700_000)}`)
    // Отмеченный — тоже со знаком, сумма из отметки.
    store.markPaid('obligation', 'rent', 'a', { amount: 225_000, accountId: 'card' })
    expect(await page(Budget, '/budget', { initialView: 'list' })).toContain(`−${plain(225_000)}`)
    // Лист «До зарплаты» «Денег» — сумма с ₸, без минуса (как было во «Впереди»).
    const { sheet } = await paydaySheet()
    expect(sheet).toContain(money(225_000))
    expect(sheet).not.toContain(`−${plain(225_000)}`)
  })

  /* ---------------- критик dfc7ab0: группы, viewer, оценка, «оставить?» ---------------- */

  const sub = (id: string, name: string, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
    id, name, note: '', day: 12, category: 'd4', versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
  })
  const fun: Obligation = { id: 'fun', name: 'Досуг', note: '', day: 1, category: 'd4', versions: [], group: true, updatedAt: T0 }

  /**
   * Капитал с состоянием модалки, которое в SSR не набрать кликами: `created`
   * вызывается и на сервере — после setup, до рендера.
   */
  async function capitalWith(path: string, state: Record<string, unknown>) {
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    const app = createSSRApp(Capital)
    app.use(router)
    // Поля калькулятора — в его окне (`PayoffSheet`, Н-3), не в самом экране.
    app.mixin(screenMixin(state))
    return renderToString(app)
  }

  it('RP-09: SSR-рендер Капитала — группа с итогом, подписки под ней, годовая «в год»', async () => {
    const netflix = sub('netflix', 'Netflix', 4_990, { parentId: 'fun' })
    const icloud = sub('icloud', 'iCloud', 11_990, { parentId: 'fun', every: 'year', month: 3 })
    const store = family('member', [fun, netflix, icloud])
    const html = await page(Capital, '/capital')

    // 4 990 + 11 990 / 12 = 5 989,17 → 5 989: итог группы из finance.ts.
    const total = groupTotal(fun, store.obligations, '2026-09')
    expect(total).toBe(5_989)
    const groupRow = html.slice(html.indexOf('Досуг'), html.indexOf('</button>', html.indexOf('Досуг')))
    expect(groupRow).toContain('2 подписки')
    expect(groupRow).toContain(money(total))
    expect(groupRow).toContain('в месяц')

    // Подписки — только под группой (в отступе после её строки), каждая по разу.
    const group = html.indexOf('Досуг')
    const nest = html.indexOf('pl-6', group)
    expect(group).toBeGreaterThan(-1)
    expect(nest).toBeGreaterThan(group)
    for (const name of ['Netflix', 'iCloud']) {
      expect(html.split(name)).toHaveLength(2)
      expect(html.indexOf(name)).toBeGreaterThan(nest)
    }
    const netflixRow = html.slice(html.indexOf('Netflix'), html.indexOf('iCloud'))
    expect(netflixRow).toContain(money(4_990))
    expect(netflixRow).toContain('в месяц')
    const icloudRow = html.slice(html.indexOf('iCloud'), html.indexOf('</button>', html.indexOf('iCloud')))
    expect(icloudRow).toContain(money(11_990))
    expect(icloudRow).toContain('раз в год')
    expect(icloudRow).toMatch(/>в год</)
  })

  it('viewer: в модалке досрочки нет «Снять» и «Применить досрочку»; участник их видит', async () => {
    const state = { payoffMode: 'once', payoffAmount: '100 000' }
    for (const role of ['member', 'viewer'] as const) {
      setActivePinia(createPinia())
      const store = family(role)
      expect(store.applyPrepayment('loan', 'a', { amount: 50_000, mode: 'term', accountId: 'card' })).not.toBeNull()
      const html = await capitalWith('/capital?payoff=loan', state)
      // Досрочку видят оба — запись общая.
      expect(html).toContain('Досрочное погашение')
      expect(html).toContain('Применённые досрочки')
      expect(html).toContain(money(50_000))
      if (role === 'member') {
        expect(html).toContain('Применить к кредиту')
        expect(html).toContain('Применить досрочку')
        expect(html).toContain('Снять')
      } else {
        expect(html).not.toContain('Применить к кредиту')
        expect(html).not.toContain('Применить досрочку')
        expect(html).not.toContain('Снять')
      }
    }
  })

  it('снятие досрочки обещает только то, что вернёт стор: «Не списывать» — без счёта; платёж — пока его не меняли; после сверки — без счёта и остатка', async () => {
    const store = family()
    const undo = async (id: string) => {
      const html = await capitalWith('/capital?payoff=loan', { removingPrepay: id })
      const at = html.indexOf('Досрочка уйдёт')
      expect(at).toBeGreaterThan(-1)
      return html.slice(at, html.indexOf('</p>', at))
    }

    // «Не списывать»: со счёта ничего не уходило — про счёт ни слова.
    const free = store.applyPrepayment('loan', 'a', { amount: 50_000, mode: 'term', accountId: null })!
    const freeNote = await undo(free.id)
    expect(freeNote).toContain('остаток долга — к прежнему')
    expect(freeNote).not.toContain('на счёт')
    expect(freeNote).not.toContain('деньги')
    expect(freeNote).not.toContain('платёж')

    // «Снизить платёж» с карты: вернутся и деньги, и платёж.
    vi.setSystemTime(new Date('2026-09-24T09:00:00Z'))
    const lower = store.applyPrepayment('loan', 'a', { amount: 100_000, mode: 'payment', accountId: 'card' })!
    expect(lower.newPayment).toBeDefined()
    const lowerNote = await undo(lower.id)
    expect(lowerNote).toContain('деньги вернутся на счёт')
    expect(lowerNote).toContain('платёж — к прежнему')

    // Платёж с тех пор снизила другая досрочка — стор его не вернёт, текст не обещает.
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'))
    store.applyPrepayment('loan', 'a', { amount: 50_000, mode: 'payment', accountId: 'card' })
    expect(await undo(lower.id)).not.toContain('платёж — к прежнему')

    // Остаток карты и долга сверили руками после досрочки — ни деньги, ни остаток не вернутся.
    vi.setSystemTime(new Date('2026-09-24T11:00:00Z'))
    store.setAccountAmount('card', 700_000)
    store.updateCredit('loan', { principal: 500_000 })
    const reconciled = await undo(lower.id)
    expect(reconciled).not.toContain('деньги вернутся')
    expect(reconciled).not.toContain('остаток долга')
  })

  it('viewer: на главном нет «Оставить?», в «Деньгах» нет «Оплатил», в Бюджете (список) нет «Оплатил»; участник их видит', async () => {
    // Ежемесячная подписка без keptAt — участника о ней спросили бы.
    const netflix = sub('netflix', 'Netflix', 4_990)
    for (const role of ['member', 'viewer'] as const) {
      setActivePinia(createPinia())
      family(role, [netflix])
      const dreams = await page(Dreams, '/')
      // «Деньги» — лист «До зарплаты» (пивот 3): аренда 28-го в нём у обоих.
      const overview = (await paydaySheet()).sheet
      const budget = await page(Budget, '/budget', { initialView: 'list' })
      // Платежи на месте у обоих — пропадают только кнопки.
      expect(overview).toContain('Аренда')
      expect(budget).toContain('Аренда')
      expect(budget).toContain('Netflix')
      if (role === 'member') {
        expect(dreams).toContain('Оставить подписку Netflix?')
        expect(overview).toContain('Оплатил')
        expect(budget).toContain('Оплатил')
      } else {
        expect(dreams).not.toContain('Оставить подписку')
        expect(overview).not.toContain('Оплатил')
        expect(budget).not.toContain('Оплатил')
      }
    }
  })

  it('оценочное обязательство: «оценка» из самого обязательства — в строке без пропа и во «Впереди» «Денег»', async () => {
    const util = sub('util', 'Коммуналка', 35_000, { category: 'd3', day: 26, estimate: true })
    family('member', [util])
    const utilRow = { kind: 'obligation', targetId: 'util', period: '2026-09', title: 'Коммуналка', note: '26 сентября' }
    const html = await row(utilRow)
    expect(html).toMatch(/>оценка</)
    expect(html).toContain(money(35_000))
    // Контроль: у аренды признака нет.
    expect(await row(rent)).not.toMatch(/>оценка</)

    // Пивот 3: лист «До зарплаты» «Денег» — те же строки, что были во «Впереди».
    const payday = (await paydaySheet()).sheet
    expect(payday).toContain('Коммуналка')
    expect(payday).toMatch(/Коммуналка[\s\S]*?>оценка</)
    // Аренда (28-е) в том же блоке идёт после коммуналки (26-е) — и без признака.
    const rentAt = payday.indexOf('Аренда')
    expect(rentAt).toBeGreaterThan(payday.indexOf('Коммуналка'))
    expect(payday.slice(rentAt)).not.toMatch(/>оценка</)
  })

  it('«Оставить?» у годовой: сумма продления из новой версии, а не текущая', async () => {
    // Продление 5 октября; с октября — 12 000 вместо 10 000.
    const yearly = sub('ivi', 'Иви', 10_000, {
      every: 'year', month: 10, day: 5, keptAt: null,
      versions: [{ from: '2000-01', amount: 10_000 }, { from: '2026-10', amount: 12_000 }],
    })
    family('member', [yearly])
    vi.setSystemTime(new Date('2026-09-25T07:00:00Z')) // 25 сентября, Алматы: до продления 10 дней
    // Карточка решения на главном (B2C-14): сумма продления из новой версии.
    const card = await page(Dreams, '/')
    expect(card).toContain('Оставить подписку Иви?')
    expect(card).toContain(`${money(12_000)} · в год · продлится 5 октября`)
    expect(card).not.toContain(money(10_000))
  })
})
