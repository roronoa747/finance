import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money, plain } from '../src/lib/money'
import { breakdownWith, monthBreakdown, type BreakdownSource, type Decision } from '../src/lib/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import { createAppRouter } from '../src/router'
import type { MoneyArticle, SyncDoc } from '../src/types/finance'
import Breakdown from '../src/views/Breakdown.vue'
import Money from '../src/views/Money.vue'
import Statements from '../src/views/Statements.vue'
import YourOrder from '../src/views/YourOrder.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 11 «Разбор денег» (B2C-60): два телефона и viewer на фейковом сервере, октябрь 2026. Семья: Ильяс — 10-го,
 * Аруна — 20-го; аренда 220 000 (5-го), кредитка 300 000 под 40 % с платежом 25 000 (22-го); «Отпуск» — главная
 * мечта, взнос 50 000; копилка «Подушка» — 100 000; на карте 2 000 000. «Ваш порядок»: Жизнь 150 000, Запас
 * 50 000/мес (1 месяц), Дорогие долги 30 000/мес, Подушка 20 000/мес (3 месяца), Траты 60 000.
 *
 * Ручной расчёт статей октября:
 *   Обязательное  220 000 + 25 000                                         = 245 000
 *   Жизнь                                                                    = 150 000
 *   Запас         порог 1 × (150 000 + 60 000) = 210 000 − 100 000 = 110 000 → взнос 50 000
 *   Дорогие долги кредитка 40 %                                             →  30 000
 *   Подушка       порог 3 × (245 000 + 150 000) − 100 000 − 50 000 = 1 035 000 → взнос 20 000
 *   Мечты         «Отпуск»                                                  →  50 000
 *   Траты                                                                    =  60 000
 *   Всего                                                                   = 605 000
 * Ильяс получил 550 000: всё до «Мечт» — 545 000, «Тратам» — 5 000, 55 000 Трат ждут Аруну, остаётся 0.
 * Аруна (500 000): докрывает Траты 55 000, остаётся 445 000.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b' | 'c', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot === 'c' ? 'a' : slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
  }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const sp = (s: string) => s.replace(/\s+/g, ' ')
const K = '2026-10'
const ring = (person: 'a' | 'b', period = K) => `/week/breakdown?from=salary&person=${person}&period=${period}`

const article = (id: MoneyArticle['id'], order: number, amount?: number): MoneyArticle => ({ id, order, on: true, ...(amount === undefined ? {} : { amount }), updatedAt: T0 })

function familyDoc(): SyncDoc {
  const base = planFamilyDoc()
  return {
    ...base,
    obligations: base.obligations.filter((o) => o.id === 'rent'),
    credits: base.credits.filter((c) => c.id === 'cc'),
    goals: [
      { id: 'trip', name: 'Отпуск', need: 3_000_000, seed: 40_000, have: 40_000, monthly: 50_000, hue: 'plum', planPct: 0, movements: [], main: true, updatedAt: T0 },
      { id: 'pot', name: 'Подушка', need: 1_500_000, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 },
    ],
    moneyArticles: [
      article('must', 1), article('life', 2, 150_000), article('reserve', 3, 50_000), article('debts', 4, 30_000),
      article('cushion', 5, 20_000), article('dreams', 6), article('spend', 7, 60_000),
    ],
    moneySettings: { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'pot', orderedAt: null, updatedAt: T0 },
  }
}

/** Разбор источника на телефоне — то, что покажет экран (`finance.ts`). */
function breakdownOf(p: Phone, source: BreakdownSource, off: string[] = []) {
  setActivePinia(p.pinia)
  const doc = p.store.householdDoc
  const mb = monthBreakdown(
    { ...doc, credits: p.store.credits },
    { key: K, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: useOperationsStore().uploads, rawCredits: doc.credits },
    source,
  )!
  return { mb, ...breakdownWith(mb, off as never[]) }
}

/** «Неделя» телефона: текст экрана и состояние (решение, «как обычно»). */
async function week(p: Phone, act?: (s: Record<string, any>) => void) {
  let vm: Record<string, any> = {}
  const grab = {
    created(this: any) {
      const s = this.$.setupState
      if (!('decision' in s)) return
      vm = s
      act?.(s)
    },
  }
  const html = await screen(p.pinia, Statements, '/week', undefined, [grab])
  return { html: text(html), decision: vm.decision as Decision | null }
}

/** «Разложить» на кольце; `off` — выключенные чипами статьи. */
async function lay(p: Phone, path: string, off?: string[]) {
  await screen(p.pinia, Breakdown, path, undefined, [
    screenMixin({}, (s) => {
      if (off) s.off = off
      ;(s.lay as () => void)()
    }),
  ])
}

const markSalary = (p: Phone, who: 'a' | 'b', amount: number, period = K) => {
  setActivePinia(p.pinia)
  return p.store.markSalary(who, { period, amount, accountId: 'card', source: 'statement', opId: `op-${who}-${period}` })
}

describe('e2e / B2C Блок 11 — «Разбор денег» на двух телефонах и у viewer', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z') // 12 октября: зарплата Ильяса (10-го) пришла, Аруны (20-го) — нет
    server = fakeServer(familyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('часть 1 — первый разбор начинается с «Ваш порядок»: карточка ведёт туда, «Готово» записывает порядок, дальше — «как обычно»', async () => {
    const A = await phone(server, st, 'a')
    markSalary(A, 'a', 550_000)
    const first = await week(A)
    expect(first.decision).toMatchObject({ kind: 'allocate', question: 'Пришла зарплата', to: `/week/order?from=salary&person=a&period=${K}`, usual: null })
    expect(first.html).toContain('Сначала — ваш порядок')
    // «Ваш порядок» — статьи по умолчанию сверху вниз, одна «Готово».
    const order = text(await screen(A.pinia, YourOrder, `/week/order?from=salary&person=a&period=${K}`))
    const names = ['Обязательное', 'Жизнь', 'Запас', 'Дорогие долги', 'Подушка', 'Мечты', 'Траты']
    expect(names.map((n) => order.indexOf(n))).toEqual([...names.map((n) => order.indexOf(n))].sort((x, y) => x - y))
    await screen(A.pinia, YourOrder, `/week/order?from=salary&person=a&period=${K}`, undefined, [screenMixin({}, (s) => (s.done as () => void)())])
    expect(A.store.moneySettings.orderedAt).toBeTruthy()
    // Порядок пройден — карточка «как обычно»: 550 000 − 545 000 − 5 000 = 0, Траты ждут Аруну.
    const usual = await week(A)
    expect(usual.decision).toMatchObject({ actions: { primary: 'Разложить как обычно', ghost: 'Изменить' }, to: ring('a') })
    expect(sp(usual.decision!.meta)).toBe('По вашему порядку · останется 0 ₸')
  })

  it('часть 2 — кольцо: статьи и «Остаётся» — ручной расчёт; выключение статьи сразу меняет «Остаётся»', async () => {
    const A = await phone(server, st, 'a')
    markSalary(A, 'a', 550_000)
    A.store.setMoneySettings({ orderedAt: T0 })
    const b = breakdownOf(A, { from: 'salary', person: 'a', period: K })
    expect(b.mb.articles.map((a) => [a.key, a.need])).toEqual([
      ['must', 245_000], ['life', 150_000], ['reserve', 50_000], ['debts', 30_000], ['cushion', 20_000], ['dreams', 50_000], ['spend', 60_000],
    ])
    expect(b.fill).toMatchObject({ rest: 0, short: 0, waiting: ['spend'] })
    expect(b.fill.given.spend).toBe(5_000)
    const html = text(await screen(A.pinia, Breakdown, ring('a')))
    expect(html).toContain(sp(`Остаётся ${money(0)} из ${money(550_000)}`))
    // Выбрана «Траты» — «ждёт зарплату Аруна»; выключена — её 5 000 в остатке, сумма зачёркнута.
    const waiting = text(await screen(A.pinia, Breakdown, ring('a'), undefined, [screenMixin({ picked: 'spend' })]))
    expect(waiting).toContain('ждёт зарплату Аруна')
    const off = await screen(A.pinia, Breakdown, ring('a'), undefined, [screenMixin({ off: ['spend'], picked: 'spend' })])
    expect(text(off)).toContain(`Остаётся ${text(money(5_000))} из ${text(money(550_000))}`)
    expect(off).toMatch(/line-through[^>]*>[^<]*60\s000/)
    // Выключить Мечты — 50 000 переходят «Тратам»: 5 000 + 50 000 = 55 000, остаток 0, не хватает 0.
    expect(breakdownOf(A, { from: 'salary', person: 'a', period: K }, ['dreams']).fill).toMatchObject({ rest: 0, given: expect.objectContaining({ spend: 55_000, dreams: 0 }) })
  })

  it('часть 3 — «Разложить»: взносы в цели и копилку со счёта, досрочка в кредитку, запись разбора; повторно и у партнёра — «Разложено»', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    markSalary(A, 'a', 550_000)
    A.store.setMoneySettings({ orderedAt: T0 })
    await lay(A, ring('a'))
    const rec = A.store.allocations[0]
    expect(rec).toMatchObject({ kind: 'breakdown', source: 'salary', sourceId: 'a', period: K, total: 550_000 })
    expect(rec.parts).toEqual([
      { target: 'must', amount: 245_000 }, { target: 'life', amount: 150_000 }, { target: 'reserve', amount: 50_000 }, { target: 'debts', amount: 30_000 },
      { target: 'cushion', amount: 20_000 }, { target: 'dreams', amount: 50_000 }, { target: 'spend', amount: 5_000 },
    ])
    // Отпуск 40 000 + 50 000; копилка 100 000 + 50 000 + 20 000; кредитка 300 000 − 30 000; карта 2 000 000 + 550 000 − 120 000 − 30 000.
    expect(A.store.goals.map((g) => [g.id, g.have])).toEqual([['trip', 90_000], ['pot', 170_000]])
    expect(A.store.payments.find((p) => p.kind === 'prepay')).toMatchObject({ targetId: 'cc', amount: 30_000, accountId: 'card' })
    expect(A.store.credits.find((c) => c.id === 'cc')!.principal).toBe(270_000)
    expect(A.store.accounts.find((a) => a.id === 'card')!.amount).toBe(2_400_000)

    const again = text(await screen(A.pinia, Breakdown, ring('a')))
    expect(again).toContain(`Разложено ${text(money(550_000))}`)
    expect(again).not.toMatch(/ Разложить /)
    // Второй «Разложить» ничего не удваивает.
    await lay(A, ring('a'))
    expect(A.store.allocations).toHaveLength(1)
    expect(A.store.goals.find((g) => g.id === 'pot')!.have).toBe(170_000)

    await sync(A, B)
    const partner = text(await screen(B.pinia, Breakdown, ring('a')))
    expect(partner).toContain('Разложено')
    expect(partner).toContain('Ильяс · ')
    expect(B.store.goals.map((g) => g.have)).toEqual([90_000, 170_000])
    expect((await week(B)).decision?.kind).not.toBe('allocate')
  })

  it('часть 4 — партнёр докрывает: зарплата Аруны закрывает 55 000 Трат, остаётся 445 000; оба видят свои «Разложено»', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    markSalary(A, 'a', 550_000)
    A.store.setMoneySettings({ orderedAt: T0 })
    await lay(A, ring('a'))
    await sync(A, B)

    at('2026-10-20T07:00:00Z')
    markSalary(B, 'b', 500_000)
    const card = await week(B)
    expect(card.decision).toMatchObject({ kind: 'allocate', to: ring('b') })
    expect(sp(card.decision!.meta)).toBe('По вашему порядку · останется 445 000 ₸')
    const b = breakdownOf(B, { from: 'salary', person: 'b', period: K })
    expect(b.mb.articles.map((a) => [a.key, a.left])).toEqual([['spend', 55_000]])
    expect(b.fill).toMatchObject({ rest: 445_000, waiting: [], short: 0 })
    await lay(B, ring('b'))
    expect(B.store.allocations.find((a) => a.sourceId === 'b')).toMatchObject({ total: 500_000, parts: [{ target: 'spend', amount: 55_000 }] })
    // Траты — только на счёте: взносов и досрочки у второй зарплаты нет.
    expect(B.store.payments.filter((p) => p.kind === 'prepay')).toHaveLength(1)

    await sync(B, A)
    expect(A.store.allocations).toHaveLength(2)
    expect(text(await screen(A.pinia, Breakdown, ring('b')))).toContain(`остаётся ${text(money(445_000))}`)
  })

  it('часть 5 — «как обычно» одним нажатием в следующем месяце пишет то же, что кольцо с теми же статьями', async () => {
    const A = await phone(server, st, 'a')
    markSalary(A, 'a', 550_000)
    A.store.setMoneySettings({ orderedAt: T0 })
    // В октябре Траты выключены — в ноябре так же.
    await lay(A, ring('a'), ['spend'])
    expect(A.store.allocations[0].off).toEqual(['spend'])

    at('2026-11-12T07:00:00Z')
    markSalary(A, 'a', 550_000, '2026-11')
    const nov = '2026-11'
    // Ожидаемое — разбор ноябрьской зарплаты на кольце с выключенными Тратами.
    setActivePinia(A.pinia)
    const doc = A.store.householdDoc
    const mb = monthBreakdown(
      { ...doc, credits: A.store.credits },
      { key: nov, totals: [], spendCategories: [], uploads: [], rawCredits: doc.credits },
      { from: 'salary', person: 'a', period: nov },
    )!
    const expected = breakdownWith(mb, ['spend'])
    const card = await week(A)
    expect(card.decision).toMatchObject({ question: 'Пришла зарплата', actions: { primary: 'Разложить как обычно' } })
    expect(sp(card.decision!.meta)).toBe(`Как в октябре · останется ${sp(money(expected.fill.rest))}`)
    expect(card.html).toContain('Разложить как обычно')
    await week(A, (s) => s.layUsual(s.decision))
    const rec = A.store.allocations.find((a) => a.period === nov)!
    expect(rec).toMatchObject({ kind: 'breakdown', total: 550_000, off: ['spend'] })
    expect(rec.parts).toEqual(expected.effects.parts)
    expect((await week(A)).decision?.kind).not.toBe('allocate')
  })

  it('часть 6 — старый адрес раскладки (4 источника) ведёт в разбор с теми же параметрами', async () => {
    const A = await phone(server, st, 'a')
    setActivePinia(A.pinia)
    const router = createAppRouter(createMemoryHistory())
    for (const q of ['from=salary&person=a&period=2026-10', 'from=rest&amount=40000&period=2026-10', 'from=freed', 'from=credit&credit=cc']) {
      await router.push(`/week/salary?${q}`)
      expect(router.currentRoute.value.fullPath).toBe(`/week/breakdown?${q}`)
    }
    expect(text(await screen(A.pinia, Breakdown, '/week/salary?from=rest&amount=40000&period=2026-10'))).toContain(`из ${text(money(40_000))}`)
  })

  it('часть 7 — viewer: видит кольцо и «Разложено», без «Разложить», переключателей и «Ваш порядок»', async () => {
    const A = await phone(server, st, 'a')
    markSalary(A, 'a', 550_000)
    A.store.setMoneySettings({ orderedAt: T0 })
    const V = await phone(server, st, 'c', 'viewer')
    await sync(A, V)
    const html = await screen(V.pinia, Breakdown, ring('a'))
    expect(text(html)).toContain(`из ${text(money(550_000))}`)
    expect(html).not.toMatch(/>\s*Разложить\s*</)
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('Изменить порядок')
    expect((await week(V)).decision).toBeNull()
    setActivePinia(V.pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push(`/week/order?from=salary&person=a&period=${K}`)
    expect(router.currentRoute.value.fullPath).toBe(ring('a'))

    await lay(A, ring('a'))
    await sync(A, V)
    expect(text(await screen(V.pinia, Breakdown, ring('a')))).toContain('Разложено')
  })

  it('часть 8 — статусы виджетов и лист «Траты»: тег раздела выше ориентира, доли = суммы «Истории» за месяц', async () => {
    const A = await phone(server, st, 'a')
    const parsed: ParsedStatement = {
      bank: 'kaspi', from: '2026-10-01', to: '2026-10-12', skipped: 0,
      operations: assignIds(
        ([
          ['2026-10-03', -40_000, 'Magnum', 'sc_food'], ['2026-10-08', -20_000, 'Magnum', 'sc_food'],
          ['2026-10-05', -24_000, 'Del Papa Cafe', 'sc_cafe'], ['2026-10-09', -16_000, 'Yandex Go', 'sc_transport'],
        ] as const).map(([date, amount, merchant, categoryId]): Omit<Operation, 'id'> => ({ bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false })),
      ),
    }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)

    // 100 000 трат: продукты 60 % (ориентир 61), кафе 24 % (ориентир 4, +20), транспорт 16 % (ориентир 7, +9).
    const money_ = text(await screen(A.pinia, Money, '/money'))
    expect(money_).toContain('Траты кафе и рестораны выше нормы')
    expect(money_).toContain(`${text(money(100_000))} из ${text(plain(210_000))}`)
    // Доход 1 200 000, аренда 220 000 + кредитка 25 000 = 20 % — низкая.
    expect(money_).toContain('нагрузка низкая')
    expect(money_).toContain('Платежи 0 из 2 оплачено')

    const sheet = text(await screen(A.pinia, Money, '/money', undefined, [screenMixin({}, (s) => { void s.norms; s.open = true })]))
    // Суммы листа — те же, что строки «Истории» по разделам (свои операции месяца).
    const history = ops.all.filter((o) => o.date.startsWith(K))
    for (const [id, name] of [['sc_food', 'Продукты'], ['sc_cafe', 'Кафе и рестораны'], ['sc_transport', 'Транспорт']] as const) {
      const sum = history.filter((o) => o.categoryId === id).reduce((a, o) => a - o.amount, 0)
      expect(sheet).toContain(`${name} ${text(money(sum))}`)
    }
    expect(sheet).toContain(`Продукты ${text(money(60_000))} · 60 %`)
    expect(sheet).toContain(`Кафе и рестораны ${text(money(24_000))} · 24 %`)
    expect(sheet).toContain('Черта — обычная доля')
  })

  it('часть 9 (приёмка) — «Траты» выше «Мечт» в «Ваш порядок»: зарплата закрывает по новому порядку, партнёр докрывает «Мечты»', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    markSalary(A, 'a', 550_000)
    // Перестановка пальцем на стенде — то же, что `reorderArticles` (DOM-тест «Ваш порядок»).
    A.store.reorderArticles(['must', 'life', 'reserve', 'debts', 'cushion', 'spend', 'dreams'])
    A.store.setMoneySettings({ orderedAt: T0 })
    // 550 000 − 495 000 (до «Подушки» включительно) = 55 000 → «Траты» 55 000 из 60 000, «Мечты» 0 — обе ждут Аруну.
    const a = breakdownOf(A, { from: 'salary', person: 'a', period: K })
    expect(a.mb.articles.map((x) => x.key)).toEqual(['must', 'life', 'reserve', 'debts', 'cushion', 'spend', 'dreams'])
    expect(a.fill).toMatchObject({ rest: 0, short: 0, waiting: ['spend', 'dreams'] })
    expect([a.fill.given.spend, a.fill.given.dreams]).toEqual([55_000, 0])
    await lay(A, ring('a'))
    expect(A.store.goals.find((g) => g.id === 'trip')!.have).toBe(40_000)
    await sync(A, B)
    expect(B.store.moneyArticles.map((x) => x.id)).toEqual(['must', 'life', 'reserve', 'debts', 'cushion', 'spend', 'dreams'])

    // Аруна 500 000: «Траты» 60 000 − 55 000 = 5 000, «Мечты» 50 000 → 55 000, остаётся 445 000; «Отпуск» 40 000 + 50 000.
    at('2026-10-20T07:00:00Z')
    markSalary(B, 'b', 500_000)
    const b = breakdownOf(B, { from: 'salary', person: 'b', period: K })
    expect(b.mb.articles.map((x) => [x.key, x.left])).toEqual([['spend', 5_000], ['dreams', 50_000]])
    expect(b.fill).toMatchObject({ rest: 445_000, waiting: [], short: 0 })
    await lay(B, ring('b'))
    expect(B.store.allocations.find((x) => x.sourceId === 'b')!.parts).toEqual([{ target: 'spend', amount: 5_000 }, { target: 'dreams', amount: 50_000 }])
    expect(B.store.goals.find((g) => g.id === 'trip')!.have).toBe(90_000)
  })
})
