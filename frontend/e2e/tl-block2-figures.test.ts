// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, createWebHistory, RouterView } from 'vue-router'
import { createAppRouter, routes } from '../src/router'
import { startDemo } from '../src/lib/demo'
import { reviewCards } from '../src/lib/finance'
import type { ApiClient } from '../src/api/client'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 2 «Хвосты» (TL-04…TL-06; Р-7…Р-9): цифры экранов сходятся со строками. TL-04 — демо-семья, настоящий роутер на
 * web-истории, сети нет; TL-05 и TL-06 — новая семья на фейковом сервере, экран «Месяца» строкой (SSR).
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function openDemo(path: string) {
  setActivePinia(createPinia())
  startDemo()
  window.history.replaceState(null, '', path)
  const router = createAppRouter(createWebHistory())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  await router.isReady()
  app.mount(root)
  await flush()
  return router
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** Целые тенге из «12 400 ₸» / «12 400». */
const tenge = (el: Element | null) => Number(txt(el).replace(/[^\d]/g, ''))
const press = async (el: HTMLElement | null) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  el!.click()
  await flush()
}

describe('e2e / Хвосты Блок 2 — цифры сходятся', () => {
  it('TL-04: демо → «Неделя» → «Подписки»: крупная сумма листа равна сумме строк, отмеченной подписки в списке нет', async () => {
    await openDemo('/week')
    // Демо: «Яндекс Плюс» 4 990 сегодня ждёт «это платёж по Яндекс Плюс?» — отмечена, на «Неделе» её нет. Вторая
    // подписка того же продавца 1 990 — вне допуска платежа, трата (сценарий Х-5: крупно 1 990, в списке было 4 990 + 1 990).
    const today = new Date().toISOString().slice(0, 10)
    useOperationsStore().seedDemoOperations([{ id: 'demo-op-tl04', bank: 'kaspi', date: today, amount: -1_990, kind: 'purchase', merchant: 'Яндекс Плюс', categoryId: 'sc_subscriptions', internal: false }])
    await flush()
    await press(q('[data-row="sc_subscriptions"] button.row-open'))
    const sheet = q('[role="dialog"]')!
    expect(tenge(sheet.querySelector('[data-section-total]'))).toBe(1_990)
    expect(all('[role="dialog"] [data-section-op]').map((el) => el.dataset.sectionOp)).toEqual(['demo-op-tl04'])
    const rows = all('[role="dialog"] [data-section-ops] button b').reduce((s, el) => s + tenge(el), 0)
    expect(rows).toBe(1_990)
  })
})

/**
 * TL-05 (Х-6, Р-7): новая семья, пятница 23 октября 2026; выписка 1 сентября – 22 октября, подписка не заведена.
 *
 * Ручной расчёт (октябрь, только Ильяс — он один; план продуктов 50 000):
 *   Netflix 3 990 7 сентября и 7 октября — раздел «Подписки» (платежей), не отмечена → «Платежи без отметки» 3 990.
 *   Кафе 2 500 + 4 000 = 6 500; продукты Magnum 12 400 + 18 700 = 31 100. Строки: 31 100 + 6 500 = 37 600.
 *   Потрачено: 37 600 + 3 990 = 41 590. «В платежи» у строки Netflix → платёж октября отмечен её суммой, «Подписки»
 *   отмечены — потрачено 37 600, строки сходятся без тихой строки.
 */
describe('e2e / Хвосты Блок 2 — «Платежи без отметки» (новая семья)', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate
  type Phone = { pinia: ReturnType<typeof createPinia>; client: ApiClient; store: ReturnType<typeof useFinanceStore> }
  const op = (date: string, amount: number, merchant: string, categoryId: string | null): Omit<Operation, 'id'> => ({
    bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
  })
  const statement = (ops: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from: '2026-09-01', to: '2026-10-22', skipped: 0, operations: assignIds(ops) })
  const OPS = () => [
    op('2026-09-07', -3_990, 'NETFLIX.COM', 'sc_subscriptions'),
    op('2026-10-07', -3_990, 'NETFLIX.COM', 'sc_subscriptions'),
    op('2026-10-03', -12_400, 'Magnum', 'sc_food'),
    op('2026-10-10', -18_700, 'Magnum', 'sc_food'),
    op('2026-10-08', -2_500, 'Coffee Boom', 'sc_cafe'),
    op('2026-10-15', -4_000, 'Coffee Boom', 'sc_cafe'),
  ]

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-23T07:00:00Z')
    server = fakeServer({
      ...defaultSyncDoc(),
      people: [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }],
      setupDoneAt: T0,
      // План трат есть — заголовок «Трат» говорит «потрачено N» (без плана — «обычно в месяц», Р-36).
      spendPlans: [{ id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 50_000, updatedAt: T0 }],
    })
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function phone(): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData({
      token: 't-u-a', user: { id: 'u-a', email: 'u-a@family.kz', created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
    })
    const client = { ...backend(server), ...statementsFor(st, 'u-a', 'a'), ...privateFor(pv, 'u-a') } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await store.pullPrivateDoc(client)
    await useOperationsStore().loadUploads(client)
    await useOperationsStore().pull(client)
    return { pinia, client, store }
  }

  /** «Месяц → Траты» строкой: суммы строк разделов, тихих строк и «потрачено» заголовка. */
  async function spend(p: Phone) {
    setActivePinia(p.pinia)
    const html = await screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened: 'spend' })])
    const num = (s: string) => Number(s.replace(/<[^>]+>/g, '').replace(/[^\d]/g, ''))
    const rows = [...html.matchAll(/data-spend-amount[^>]*>([\s\S]*?)<\/span>/g)].map((m) => num(m[1]!))
    const quiet = (attr: string) => {
      const m = html.match(new RegExp(`${attr}[^>]*>[\s\S]*?<span[^>]*>[^<]*</span>\s*<span[^>]*>([^<]*)</span>`))
      return m ? num(m[1]!) : 0
    }
    const spent = num(html.match(/data-section-meta[^>]*>\s*([^<]*?) потрачено\s*</)?.[1] ?? '') // «N потрачено» (К-7)
    return { html, rows: rows.reduce((s, x) => s + x, 0), unknown: quiet('data-spend-unknown'), oneOff: quiet('data-spend-oneoff'), unmarked: quiet('data-spend-unmarked'), spent }
  }

  it('TL-05: незаведённая подписка — «Платежи без отметки» 3 990, строки = потрачено; «В платежи» у строки → строка уходит, «Подписки» отмечены, снова сходится', async () => {
    const A = await phone()
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'x.pdf', parsed: statement(OPS()) }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await A.store.syncHousehold(A.client)

    const before = await spend(A)
    expect(before.html).toContain('Платежи без отметки')
    expect(before).toMatchObject({ rows: 37_600, unknown: 0, oneOff: 0, unmarked: 3_990, spent: 41_590 })
    expect(before.rows + before.unknown + before.oneOff + before.unmarked).toBe(before.spent)

    // Лист «Платежи без отметки»: у строки Netflix — «В платежи» (повтор продавца); как `AddPaymentSheet` → «Добавить».
    setActivePinia(A.pinia)
    const line = ops.all.find((o) => o.date === '2026-10-07')!
    const pre = ops.recurringFor(line)!
    expect(pre).toMatchObject({ amount: 3_990, kind: 'subscription' })
    const id = A.store.addObligation({ name: 'Netflix', note: 'ежемесячно', day: pre.day, category: 'd4', every: 'month', amount: pre.amount })
    await ops.addToPayments(line.id, id, A.client)
    await A.store.syncHousehold(A.client)

    expect(A.store.payments.filter((p) => !p.deletedAt && p.targetId === id)).toEqual([expect.objectContaining({ period: '2026-10', amount: 3_990, opId: line.id })])
    expect(A.store.householdDoc.spendTotals?.find((t) => t.id === 'a:month:2026-10:sc_subscriptions')?.unmarked ?? 0).toBe(0)
    const after = await spend(A)
    expect(after.html).not.toContain('Платежи без отметки')
    expect(after).toMatchObject({ rows: 37_600, unmarked: 0, spent: 37_600 })
  })

  /**
   * TL-06 (Х-14, Р-9): октябрь — продукты Magnum 40 000; снятия Kaspi ATM 30 000 и Halyk ATM 20 000 без заметки
   * (наличные 50 000 — 43 % факта 115 000, порог 10 %); перевод Айгуль Б. 25 000 (22 %, порог 20 %). План: продукты
   * 50 000, наличные 30 000, переводы 10 000 — в листах наличных и переводов его нет.
   */
  it('TL-06: карточка «На что?» → лист «Наличные» — сумма и снятия, без плана, «обычно» и доли; «Переводы людям» — так же; продукты — как были', async () => {
    server.data.spendPlans = [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 50_000, updatedAt: T0 },
      { id: 'a:sc_cash', by: 'a', categoryId: 'sc_cash', amount: 30_000, updatedAt: T0 },
      { id: 'a:sc_people', by: 'a', categoryId: 'sc_people', amount: 10_000, updatedAt: T0 },
    ]
    const A = await phone()
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    const parsed = statement([
      op('2026-10-03', -40_000, 'Magnum', 'sc_food'),
      { ...op('2026-10-05', -30_000, 'Kaspi ATM', 'sc_cash'), kind: 'cash' },
      { ...op('2026-10-12', -20_000, 'Halyk ATM', 'sc_cash'), kind: 'cash' },
      { ...op('2026-10-09', -25_000, 'Перевод', 'sc_people'), kind: 'transfer-out', counterparty: 'Айгуль Б.' },
    ])
    await ops.upload([{ name: 'x.pdf', parsed }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await A.store.syncHousehold(A.client)

    setActivePinia(A.pinia)
    const { state, ctx } = A.store.planInput('2026-10')
    const cards = reviewCards(state, ctx, ops.all, 'a', { rules: A.store.merchantRules })
    expect(cards.find((c) => c.kind === 'cash')).toMatchObject({ button: 'На что?', target: { kind: 'cat', categoryId: 'sc_cash' } })
    expect(cards.find((c) => c.kind === 'people')).toMatchObject({ target: { kind: 'cat', categoryId: 'sc_people' } })

    // Кнопка карточки открывает лист раздела (`reviewAct` → `catFor`, тот же адрес `?cat=`). Лист — в `body` (телепорт),
    // поэтому «Месяц» монтируется в DOM на сторе телефона.
    const sheet = async (cat: string) => {
      app?.unmount()
      document.body.innerHTML = ''
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push(`/month?cat=${cat}`)
      await router.isReady()
      const root = document.createElement('div')
      document.body.appendChild(root)
      app = createApp(Month)
      app.use(A.pinia)
      app.use(router)
      app.mount(root)
      for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0)
      return q('[role="dialog"]')!
    }
    const BARE = ['[data-cat-share]', '[data-cat-usual]', '[data-cat-plan]', '[data-cat-advice-box]', '[data-cat-plans-title]', '[data-cat-person]', '[data-cat-edit]']
    const cash = await sheet('sc_cash')
    expect(tenge(cash.querySelector('[data-cat-amount]'))).toBe(50_000)
    expect([...cash.querySelectorAll<HTMLElement>('[data-cat-op]')].map((el) => txt(el))).toEqual([expect.stringContaining('Halyk ATM'), expect.stringContaining('Kaspi ATM')])
    for (const sel of BARE) expect(cash.querySelector(sel), sel).toBeNull()
    const people = await sheet('sc_people')
    expect(tenge(people.querySelector('[data-cat-amount]'))).toBe(25_000)
    expect(txt(people)).toContain('Айгуль Б.')
    for (const sel of BARE) expect(people.querySelector(sel), sel).toBeNull()
    // Обычный раздел — «обычно», план и «Изменить» на месте.
    const food = await sheet('sc_food')
    for (const sel of ['[data-cat-usual]', '[data-cat-plan]', '[data-cat-plans-title]', '[data-cat-edit]']) expect(food.querySelector(sel), sel).not.toBeNull()
  })
})
