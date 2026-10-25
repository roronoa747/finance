// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView, type Router } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { apiClient } from '../src/api/client'
import { planByFact } from '../src/lib/finance'
import { money } from '../src/lib/money'
import { startDemo } from '../src/lib/demo'
import { todayIso } from '../src/lib/dates'
import { readTipsSeen } from '../src/lib/storage'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Payment } from '../src/types/finance'
import type { SpendTotal } from '../src/lib/statements/types'
import type { StatementUploadResponse } from '../src/types/api'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Приёмка Блока 1 «Пачка 1» бэклога «Figma» — то, что e2e исполнителя (`fg-block1-pack1`) не проходит нажатиями: полный круг
 * «Оплатил»/«Отдал» в строке «Месяца» (оценка → лист, «Не оплачено» листом → кнопка вернулась, «Долги» видят ту же отметку),
 * «Установить план» → «ещё 3 ▾» → все строки → «Установить», «Деньги» (валютный счёт и ползунок сегмента без пересоздания),
 * «видел» подсказки переживает демо и новую семью. Семья `planFamilyDoc`, суббота 12 сентября 2026; август аренды, кредита,
 * коммуналки (оценка) и долга брату оплачен с Kaspi Gold.
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer
let uploads: StatementUploadResponse[] = []
const KEY = '2026-09'
const aug = (targetId: string, kind: Payment['kind'], amount: number): Payment => ({
  id: `pay-${targetId}-aug`, kind, targetId, period: '2026-08', amount, accountId: 'card', by: 'a', at: '2026-08-05T05:00:00.000Z', updatedAt: T0,
})
const base = planFamilyDoc()
const family = () =>
  planFamilyDoc({
    obligations: [...base.obligations, { id: 'util', name: 'Коммуналка', note: '', day: 15, category: 'd1', versions: [{ from: '2000-01', amount: 30_000 }], estimate: true, updatedAt: T0 }],
    credits: [...base.credits, { id: 'bro', name: 'Брату', note: '', principal: 200_000, principalSetAt: T0, annualRate: 0, payment: 50_000, day: 25, person: true, updatedAt: T0 }],
    accounts: [
      ...base.accounts,
      { id: 'eur', name: 'Евро-счёт', note: '', amount: 505_310, amountSetAt: T0, kind: 'card', currency: 'EUR', foreignAmount: 1_000, rate: 505.31, rateAt: T0, updatedAt: T0 },
    ],
    payments: [aug('rent', 'obligation', 220_000), aug('loan', 'credit', 58_000), aug('util', 'obligation', 28_000), aug('bro', 'credit', 50_000)],
  })

async function phone(slot: 'a' | 'b' = 'a'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', slot))
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(apiClient)
  return { pinia, client, store }
}

const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await vi.dynamicImportSettled()
  for (let i = 0; i < n; i++) await nextTick()
}
async function mount(pinia: Pinia, path: string): Promise<Router> {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await tick()
  return router
}
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
async function press(el: Element | null, what: string) {
  expect(el, what).toBeTruthy()
  vi.setSystemTime(Date.now() + 1000) // нажатие при замёрзших часах Vue отбрасывает
  ;(el as HTMLElement).click()
  await tick()
}
const escape = async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await tick()
}
const marks = (p: Phone, targetId: string) => p.store.payments.filter((x) => x.targetId === targetId && x.period === KEY && !x.deletedAt)
const pay = (id: string) => q(`[data-due-id="${id}"] [data-due-pay]`)
const paid = (id: string) => txt(q(`[data-due-id="${id}"]`)).includes('✓')

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('ff_tips_seen', JSON.stringify(['tab-week', 'tab-month', 'tab-money', 'tab-dreams']))
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  uploads = []
  vi.spyOn(apiClient, 'listStatementUploads').mockImplementation(async () => ({ uploads }))
  server = fakeServer(family())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('e2e / приёмка «Figma» Блок 1 — пачка 1', () => {
  it('FG-10: «Отдал» у долга человеку — ✓ одним нажатием; оценка — лист отметки; «Не оплачено» листом — кнопка вернулась; «Долги» видят отметку из строки', async () => {
    const A = await phone()
    await mount(A.pinia, '/month')
    await press(q('[data-section="dues"] [data-row-open]'), '«Платежи»')
    for (const r of all('[data-due]')) expect(txt(r.lastElementChild)).toMatch(/\d\s₸$/)

    // Долг брату: «Отдал» в строке, счёт прошлой оплаты есть — ✓ без листа, одна запись.
    expect(txt(pay('credit:bro'))).toBe('Отдал')
    await press(pay('credit:bro'), '«Отдал» у брата')
    expect(q('[role="dialog"]')).toBeNull()
    expect(paid('credit:bro')).toBe(true)
    expect(pay('credit:bro')).toBeNull()
    expect(marks(A, 'bro')).toHaveLength(1)
    expect(marks(A, 'bro')[0]).toMatchObject({ kind: 'credit', amount: 50_000, accountId: 'card', by: 'a' })

    // Коммуналка — сумма-оценка: счёт прошлой оплаты есть, но вслепую не пишем — лист отметки.
    await press(pay('obligation:util'), '«Оплатил» у коммуналки')
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(marks(A, 'util')).toHaveLength(0)
    await escape()

    // Кредит: ✓ одним нажатием — и та же отметка на «Долгах».
    await press(pay('credit:loan'), '«Оплатил» у кредита')
    expect(paid('credit:loan')).toBe(true)
    expect(marks(A, 'loan')).toHaveLength(1)

    // Аренда: «Оплатил» → ✓; «Не оплачено» в листе платежа снимает ✓ — «Оплатил» снова в строке.
    await press(pay('obligation:rent'), '«Оплатил» у аренды')
    expect(paid('obligation:rent')).toBe(true)
    await press(q('[data-due-id="obligation:rent"] [data-row-open]'), 'строка аренды')
    await press(q('[data-unpay]'), '«Не оплачено»')
    expect(paid('obligation:rent')).toBe(false)
    expect(txt(pay('obligation:rent'))).toBe('Оплатил')
    expect(marks(A, 'rent')).toHaveLength(0)
    // Ещё раз «Оплатил» — снова одна живая запись, не две.
    await press(pay('obligation:rent'), '«Оплатил» у аренды снова')
    expect(marks(A, 'rent')).toHaveLength(1)

    await mount(A.pinia, '/money/debts')
    const row = (id: string) => q(`[data-debt="${id}"]`)!.parentElement!
    expect(row('loan').querySelector('[data-debt-given]')).not.toBeNull()
    expect(row('bro').querySelector('[data-debt-given]')).not.toBeNull()
    expect(row('cc').querySelector('[data-debt-given]')).toBeNull()
  })

  it('FG-08: «Установить план» без подписи → лист «План трат» «ещё 3 ▾» брендом → все строки → «Установить» — план = planByFact, кнопки нет, подпись «N потрачено»', async () => {
    // Выписка 10 авг – 11 сен: полные недели W33…W36; шесть разделов каждую неделю.
    uploads = [{ id: 'up1', slot: 'a', bank: 'kaspi', period_from: '2026-08-10', period_to: '2026-09-11', ops_count: 60, created_at: '2026-09-11T10:00:00Z' }]
    const weekly: Record<string, number> = { sc_food: 30_000, sc_cafe: 12_000, sc_transport: 6_000, sc_health: 4_000, sc_home: 3_000, sc_fun: 2_000 }
    const spendTotals: SpendTotal[] = ['2026-W33', '2026-W34', '2026-W35', '2026-W36'].flatMap((period) =>
      Object.entries(weekly).map(([categoryId, amount]) => ({ id: `a:week:${period}:${categoryId}`, by: 'a' as const, kind: 'week' as const, period, categoryId, amount, ops: 3, updatedAt: T0 })),
    )
    server = fakeServer({ ...family(), spendTotals })
    const A = await phone()
    const { state, ctx } = A.store.planInput(KEY)
    const fact = planByFact(state, ctx, 'a', todayIso())!
    expect(fact.rows).toHaveLength(6)

    await mount(A.pinia, '/month')
    const spend = q('[data-section="spend"]')!
    expect(spend.querySelector('[data-section-meta]')).toBeNull()
    expect(txt(spend.querySelector('[data-plan-fact]'))).toBe('Установить план')
    expect(txt(spend.querySelector(':scope > span.font-num'))).toBe(txt({ textContent: money(fact.total) } as Element))

    await press(spend.querySelector('[data-plan-fact]'), '«Установить план»')
    expect(all('[data-plan-fact-row]')).toHaveLength(3)
    const more = q('[data-plan-fact-more]')!
    const label = more.firstElementChild!
    expect(txt(label)).toBe('ещё 3')
    expect(label.className).toContain('text-brand')
    expect(label.querySelector('svg')).not.toBeNull()
    const hidden = fact.rows.slice(3).reduce((s, r) => s + r.amount, 0)
    expect(txt(more.lastElementChild)).toBe(txt({ textContent: money(hidden) } as Element))
    expect(txt(q('[data-plan-fact-save]'))).toBe('Установить')

    await press(more, '«ещё 3»')
    expect(all('[data-plan-fact-row]').map((r) => r.dataset.planFactRow)).toEqual(fact.rows.map((r) => r.categoryId))
    for (const r of all('[data-plan-fact-row]')) expect(txt(r)).toMatch(/\d\s₸$/)
    expect(q('[data-plan-fact-more]')).toBeNull()

    await press(q('[data-plan-fact-save]'), '«Установить»')
    const plans = (A.store.householdDoc.spendPlans ?? []).filter((p) => p.by === 'a' && !p.deletedAt)
    expect(plans.map((p) => [p.categoryId, p.amount]).sort()).toEqual(fact.rows.map((r) => [r.categoryId, r.amount]).sort())
    expect(q('[data-plan-fact]')).toBeNull()
    expect(txt(q('[data-section="spend"] [data-section-meta]'))).toMatch(/^([\d\s]+ потрачено|по плану)$/)
  })

  it('FG-06 + FG-09: «Деньги» — валютный счёт: справа «₸», «€» только в подписи; сегмент не пересоздаётся, ползунок переезжает под «Долги» и «История»', async () => {
    const A = await phone()
    const router = await mount(A.pinia, '/money')
    const eur = all('main button, button').find((b) => txt(b).startsWith('Евро-счёт'))!
    expect(eur).toBeTruthy()
    const amount = A.store.accounts.find((a) => a.id === 'eur')!.amount
    expect(txt(eur)).toContain('1 000 €')
    expect(txt(eur).endsWith(txt({ textContent: money(amount) } as Element))).toBe(true)
    expect(txt(eur).match(/€/g)).toHaveLength(1)

    const group = q('[role="group"][aria-label="Деньги"]')!
    const slider = () => group.querySelector<HTMLElement>('[data-segment-slider]')!
    expect(slider().style.transform).toBe('translateX(0%)')
    await press([...group.querySelectorAll('button')].find((b) => txt(b) === 'Долги')!, '«Долги»')
    expect(router.currentRoute.value.path).toBe('/money/debts')
    // Один маршрут `money/:square?` — тот же сегмент, ползунок едет переходом (без памяти «откуда»).
    expect(q('[role="group"][aria-label="Деньги"]')).toBe(group)
    expect(slider().style.transform).toBe('translateX(100%)')
    expect(group.querySelector('[aria-current="page"]')!.textContent!.trim()).toBe('Долги')
    await press([...group.querySelectorAll('button')].find((b) => txt(b) === 'История')!, '«История»')
    expect(router.currentRoute.value.path).toBe('/money/history')
    expect(slider().style.transform).toBe('translateX(200%)')
  })

  it('FG-11: пузырь, простоявший 4 с, — «видел»; выход → демо → «Месяц» без пузыря; новая семья на этом телефоне «видел» не стирает', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    localStorage.removeItem('ff_tips_seen')
    const A = await phone()
    await mount(A.pinia, '/month')
    expect(all('[data-tip]').map((t) => t.dataset.tip)).toEqual(['tab-month'])
    await vi.advanceTimersByTimeAsync(4_100)
    expect(readTipsSeen()).toEqual(['tab-month'])

    setActivePinia(A.pinia)
    expect(useAuthStore().logout('discard')).toBe(true)
    expect(readTipsSeen()).toEqual(['tab-month'])

    const demo = createPinia()
    setActivePinia(demo)
    expect(startDemo()).toBe(true)
    await tick()
    expect(readTipsSeen()).toEqual(['tab-month'])
    await mount(demo, '/month')
    expect(q('[data-sections]')).not.toBeNull()
    expect(all('[data-tip]').map((t) => t.dataset.tip)).not.toContain('tab-month')

    setActivePinia(demo)
    useFinanceStore().startNewFamily('h-new')
    expect(readTipsSeen()).toEqual(['tab-month'])
  })
})
