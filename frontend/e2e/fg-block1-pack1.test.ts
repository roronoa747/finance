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
import { dreamShift, monthPlan, shiftShort } from '../src/lib/finance'
import { readTipsSeen } from '../src/lib/storage'
import { UNKNOWN_CATEGORY } from '../src/lib/statements/dictionary'
import type { Operation } from '../src/lib/statements/types'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Payment } from '../src/types/finance'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Блок 1 «Пачка 1» бэклога «Figma» (FG-06…FG-12) — нажатиями во всём приложении. Семья `planFamilyDoc` на фейковом
 * сервере, суббота 12 сентября 2026 (неделя 7–13 сентября). Ильяс за неделю: продукты 12 000, кафе 3 000 и «Не разобрано»
 * 50 000 (больше всех — а строка всё равно последняя, К-3). Август аренды оплачен с Kaspi Gold — «Оплатил» в строке
 * «Месяца» ставит ✓ одним нажатием; кредит ещё не платили — лист счёта (первая оплата).
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer
const KEY = '2026-09'
const WEEK = '2026-W37'
const augRent: Payment = {
  id: 'pay-rent-aug', kind: 'obligation', targetId: 'rent', period: '2026-08', amount: 220_000, accountId: 'card', by: 'a',
  at: '2026-08-05T05:00:00.000Z', updatedAt: T0,
}
const total = (categoryId: string, amount: number) => ({ id: `a:week:${WEEK}:${categoryId}`, by: 'a' as const, kind: 'week' as const, period: WEEK, categoryId, amount, ops: 1, updatedAt: T0 })
const op = (id: string, date: string, amount: number, merchant: string, categoryId: string | null): Operation => ({
  id, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false,
})

async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  return { pinia, client, store }
}

const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await vi.dynamicImportSettled()
  for (let i = 0; i < n; i++) await nextTick()
}
async function mount(p: Phone, path: string): Promise<Router> {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(p.pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(p.pinia)
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

beforeEach(() => {
  localStorage.clear()
  // Подсказки вкладок уже видены — пузыри не перекрывают нажатия (кроме сценария (г)).
  localStorage.setItem('ff_tips_seen', JSON.stringify(['tab-week', 'tab-month', 'tab-money', 'tab-dreams']))
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] } as never)
  server = fakeServer(planFamilyDoc({
    payments: [augRent],
    spendTotals: [total('sc_food', 12_000), total('sc_cafe', 3_000), total(UNKNOWN_CATEGORY, 50_000)],
  }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('e2e / «Figma» Блок 1 — пачка 1', () => {
  it('(а) «Неделя»: «₸» у строк, «Не разобрано» последней, «История» → лист «N операций», «Статистика», стрелки и значок заметки', async () => {
    const A = await phone('a')
    const ops = useOperationsStore()
    for (const o of [op('o1', '2026-09-08', 7_000, 'MAGNUM', 'sc_food'), op('o2', '2026-09-09', 5_000, 'SMALL', 'sc_food'), op('o3', '2026-09-10', 3_000, 'COFFEE', 'sc_cafe')]) ops.ops[o.id] = o
    await mount(A, '/week')
    const rows = all('[data-week-list] [data-row]')
    expect(rows.map((r) => r.dataset.row).at(-1)).toBe(UNKNOWN_CATEGORY)
    for (const r of rows) expect(txt(r.querySelector('[data-amount]'))).toMatch(/\d\s₸$/)
    expect(q('button[aria-label="Прошлая неделя"]')!.className).toContain('size-9')
    expect(q('button[aria-label="Следующая неделя"]')).not.toBeNull()
    expect(q('[data-week-label]')!.className).not.toContain('type-section')
    expect(txt(q('[data-week-feed]'))).toBe('История')
    await press(q('[data-week-feed]'), '«История»')
    expect(txt(q('[role="dialog"] h3'))).toBe('История')
    expect(txt(q('[data-feed-meta]'))).toBe('3 операции')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await tick()
    expect(txt(q('[data-week-trend] button'))).toBe('Статистика')
  })

  it('(б) «Месяц»: подписи трёх разделов, «₸» у сумм, зарплата партнёра чёрная, зов — точкой без брендового текста', async () => {
    const A = await phone('a')
    await mount(A, '/month')
    const plan = monthPlan(A.store.householdDoc, { key: KEY, totals: [], spendCategories: [], uploads: [] })
    expect(txt(q('[data-section="dues"] [data-section-meta]'))).toBe(`${plan.dues.filter((d) => d.paid).length} из ${plan.dues.length} оплачено`)
    expect(txt(q('[data-section="queue"] [data-section-meta]'))).toMatch(/^(\d+ из \d+ отложено|взносов нет)$/)
    for (const el of all('[data-section] > span.font-num')) expect(txt(el)).toMatch(/\d\s₸$/)
    expect(q('[data-section-meta].text-brand')).toBeNull()
    for (const dot of all('[data-section-call]')) expect(dot.className).toContain('fx-pulse')
    // Аруна (20-го) — зарплата ещё не пришла, а сумма чёрная (К-8).
    expect(q('[data-salary="b"]')!.dataset.came).toBeUndefined()
    expect(q('[data-salary="b"] b')!.className).toContain('text-ink')
    expect(q('[data-salary="b"] b')!.className).not.toContain('text-ink-2')
  })

  it('(б) «нашли в выписке»: подпись «платежей нет», зов — пульсом точки, список — в раскрытом разделе', async () => {
    server = fakeServer(planFamilyDoc({ obligations: [], credits: [], payments: [] }))
    const A = await phone('a')
    const ops = useOperationsStore()
    for (const o of [op('ap8', '2026-08-14', 4_990, 'APPLE.COM BILL', null), op('ap9', '2026-09-10', 4_990, 'APPLE.COM BILL', null)]) ops.ops[o.id] = o
    await mount(A, '/month')
    expect(txt(q('[data-section="dues"] [data-section-meta]'))).toBe('платежей нет')
    const dot = q('[data-section="dues"] [data-section-call]')!
    expect(dot.className).toContain('fx-pulse')
    expect(dot.getAttribute('data-section-call')).toMatch(/^нашли \d+ в выписке$/)
    await press(q('[data-section="dues"] [data-row-open]'), '«Платежи»')
    expect(q('[data-found-list]')).not.toBeNull()
  })

  it('(в) «Оплатил» в строке «Месяца»: A → ✓ одним нажатием, запись одна; кредит — лист счёта; B после синка — ✓ без кнопки; viewer — без кнопок', async () => {
    const A = await phone('a')
    await mount(A, '/month')
    await press(q('[data-section="dues"] [data-row-open]'), '«Платежи»')
    const pay = (id: string) => q(`[data-due-id="${id}"] [data-due-pay]`)
    expect(txt(pay('obligation:rent'))).toBe('Оплатил')
    await press(pay('obligation:rent'), '«Оплатил» у аренды')
    expect(q('[role="dialog"]')).toBeNull()
    expect(txt(q('[data-due-id="obligation:rent"]'))).toContain('✓')
    expect(pay('obligation:rent')).toBeNull()
    const marks = A.store.payments.filter((p) => p.targetId === 'rent' && p.period === KEY && !p.deletedAt)
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ kind: 'obligation', amount: 220_000, accountId: 'card', by: 'a' })
    // Кредит не платили — счёт спросить не у кого: лист отметки (первая оплата), записи нет.
    await press(pay('credit:loan'), '«Оплатил» у кредита')
    expect(txt(q('[role="dialog"]'))).toContain('Спрашиваем один раз')
    expect(A.store.payments.some((p) => p.targetId === 'loan' && p.period === KEY)).toBe(false)

    await A.store.syncHousehold(A.client)
    const B = await phone('b')
    await mount(B, '/month')
    await press(q('[data-section="dues"] [data-row-open]'), '«Платежи» у B')
    expect(txt(q('[data-due-id="obligation:rent"]'))).toContain('✓')
    expect(pay('obligation:rent')).toBeNull()
    expect(pay('credit:loan')).not.toBeNull()

    const V = await phone('a', 'viewer')
    await mount(V, '/month')
    await press(q('[data-section="dues"] [data-row-open]'), '«Платежи» у viewer')
    expect(txt(q('[data-due-id="obligation:rent"]'))).toContain('✓')
    expect(q('[data-due-pay]')).toBeNull()
  })

  it('(г) подсказки — один раз: после выхода и входа «видел» на месте, пузыря нет', async () => {
    localStorage.removeItem('ff_tips_seen')
    const A = await phone('a')
    await mount(A, '/')
    expect(all('[data-tip]').map((t) => t.dataset.tip)).toEqual(['tab-dreams'])
    await press(q('[data-tip-ok]'), '«Понятно»')
    useAuthStore().logout('discard')
    expect(readTipsSeen()).toEqual(['tab-dreams'])
    const again = await phone('a')
    await mount(again, '/')
    expect(q('[data-tip]')).toBeNull()
  })

  it('(д) сдвиг мечты на «Мечтах» — только срок, без «платёж»; причина — в карточке цели', async () => {
    const A = await phone('a')
    A.store.ensureTermSnap()
    // Новый платёж 900 000 после снимка месяца: 1 200 000 − 323 000 − 900 000 < взносов очереди — мечты сдвигаются.
    A.store.householdDoc.obligations = [
      ...A.store.householdDoc.obligations,
      { id: 'gym', name: 'Спортзал', note: '', day: 12, category: 'd4', versions: [{ from: '2000-01', amount: 900_000 }], updatedAt: T0 },
    ]
    const { state, ctx } = A.store.planInput(KEY)
    const snap = A.store.termSnapFor(KEY)
    const shifted = A.store.householdDoc.goals.map((g) => [g.id, dreamShift(state, ctx, snap, g.id, 'a')] as const).filter(([, s]) => s)
    expect(shifted.length).toBeGreaterThan(0)
    await mount(A, '/')
    const notes = [...all('[data-hero-note]'), ...all('[data-row-note]')].map(txt)
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) expect(n).not.toMatch(/платёж|·/)
    for (const [, s] of shifted) expect(notes).toContain(txt({ textContent: shiftShort(s!) } as Element))
    const [goalId, s] = shifted[0]!
    await mount(A, `/goals/${goalId}`)
    expect(txt(q('[data-goal-shift]'))).toContain(`${txt({ textContent: shiftShort(s!) } as Element)} · платёж «Спортзал» с этого месяца`)
  })

  it('(е) сегмент: ползунок под активной; «Месяц» — экран меняется сразу, ползунок переезжает', async () => {
    const A = await phone('a')
    const router = await mount(A, '/week')
    const slider = () => q('[role="group"][aria-label="План"] [data-segment-slider]')!
    expect(slider().style.transform).toBe('translateX(0%)')
    await press(q('[data-plan-view="month"]'), '«Месяц»')
    expect(router.currentRoute.value.path).toBe('/month')
    expect(q('[data-plan-view="month"]')!.getAttribute('aria-current')).toBe('page')
    // Новый экран рисует ползунок на прежнем месте и через два кадра везёт его под «Месяц».
    await vi.waitFor(() => expect(slider().style.transform).toBe('translateX(100%)'), { timeout: 2000 })
  })
})
