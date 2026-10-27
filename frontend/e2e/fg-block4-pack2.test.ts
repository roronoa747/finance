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
import { monthFeed, netWorth, liveAccounts, liveCredits, openGoals } from '../src/lib/finance'
import { money } from '../src/lib/money'
import type { Operation } from '../src/lib/statements/types'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Goal, WishItem } from '../src/types/finance'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Блок 4 «Пачка 2 · Вид» бэклога «Figma» (FG-19…FG-25) — нажатиями во всём приложении. Семья `planFamilyDoc` на фейковом
 * сервере, суббота 12 сентября 2026. Главная мечта — «Япония» 300 000 из 1 000 000 (30 %); «Велосипед» сбылся; «Тур» — поездка
 * 1–5 сентября (прошла); желания — общее и Ильяса.
 */

type Phone = { pinia: Pinia; client: ReturnType<typeof backend>; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer

const goal = (id: string, name: string, extra: Partial<Goal> = {}): Goal => ({
  id, name, need: 1_000_000, seed: 0, have: 0, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})
const wish = (id: string, name: string, price: number, extra: Partial<WishItem> = {}): WishItem => ({
  id, name, price, by: 'a', addedOn: '2026-09-01', bought: false, updatedAt: T0, ...extra,
})
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
const norm = (s: string) => s.replace(/\s+/g, ' ')
const byText = (sel: string, text: string) => all(sel).find((el) => txt(el) === text) ?? null
async function press(el: Element | null, what: string) {
  expect(el, what).toBeTruthy()
  vi.setSystemTime(Date.now() + 1000) // нажатие при замёрзших часах Vue отбрасывает
  ;(el as HTMLElement).click()
  await tick()
}
async function type(input: HTMLInputElement | null, value: string, what: string) {
  expect(input, what).toBeTruthy()
  input!.focus()
  input!.value = value
  input!.dispatchEvent(new Event('input'))
  await tick()
  input!.dispatchEvent(new Event('blur'))
  await tick()
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('ff_tips_seen', JSON.stringify(['tab-week', 'tab-month', 'tab-money', 'tab-dreams']))
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] } as never)
  server = fakeServer(planFamilyDoc({
    goals: [
      goal('japan', 'Япония', { seed: 300_000, have: 300_000, main: true }),
      goal('tour', 'Тур', { seed: 200_000, have: 200_000, from: '2026-09-01', to: '2026-09-05', budget: 150_000 }),
      goal('bike', 'Велосипед', { seed: 230_000, have: 230_000, need: 230_000, doneAt: '2026-08-20T07:00:00.000Z' }),
    ],
    wishlist: [wish('w1', 'Кофемашина', 145_000, { list: 'all' }), wish('w2', 'Наушники', 89_000)],
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

describe('e2e / «Figma» Блок 4 — пачка 2', () => {
  it('(а) кит: «Изменить цель» — поле 44 с «₸» внутри, подпись без «, ₸», «Готово» 44 с окантовкой, «Удалить цель» плашкой; «Кто вносит» — сегмент 36', async () => {
    const A = await phone('a')
    await mount(A, '/goals/japan')
    await press(q('button[aria-label="Меню цели"]'), '«···»')
    await press(byText('[role="dialog"] button', 'Изменить цель'), '«Изменить цель»')
    const label = all('[role="dialog"] label').find((l) => txt(l.querySelector('span')) === 'Сколько нужно')!
    expect(label, 'подпись «Сколько нужно» без «, ₸»').toBeTruthy()
    const input = label.querySelector('input')!
    expect(input.className).toContain('h-11')
    expect(txt(label.querySelector('[data-num-suffix]'))).toBe('₸')
    const done = byText('[role="dialog"] button', 'Готово')!
    expect(done.className).toContain('h-11')
    expect(done.className).toContain('--brand-edge')
    const remove = byText('[role="dialog"] button', 'Удалить цель')!
    expect(remove.className).toContain('h-8')
    expect(remove.className).toContain('mx-auto')
    expect(remove.className).not.toContain('w-full')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await tick()
    // «Пополнить» → лист: «Кто вносит» — сегмент 36 (кнопки 30 в капсуле с отступом 3).
    await press(q('[data-goal-deposit]'), '«Пополнить» на обложке')
    const seg = all('[role="dialog"] [role="group"] button').find((b) => txt(b) === 'Ильяс')!
    expect(seg.className).toContain('h-[30px]')
    expect(seg.parentElement!.className).toContain('p-[3px]')
  })

  it('(б) «Мечты»: обложка «30 %» и «Япония», шапка на фото; «Сбылось · 1 ›» → лист → экран сбывшейся; желания без подписи «чьё»', async () => {
    const A = await phone('a')
    const router = await mount(A, '/')
    const cover = q('[data-dreams-cover]')!
    expect(norm(txt(cover))).toMatch(/30\s%\s*Япония/)
    expect(cover.querySelector('header')).not.toBeNull()
    expect(cover.querySelector('[data-shell-people]')).not.toBeNull()
    expect(q('[data-done-album-card]')).toBeNull()
    expect(txt(q('[data-done-link]'))).toBe('Сбылось · 1')
    await press(q('[data-done-link]'), '«Сбылось · 1 ›»')
    expect(txt(q('[role="dialog"] h3'))).toBe('Сбылось · 1')
    await press(q('[data-done-row]'), 'строка «Велосипед»')
    expect(router.currentRoute.value.path).toBe('/goals/bike')

    await router.push('/')
    await tick()
    const wishes = q('[data-all-wishes]')!.closest('div')!.parentElement!
    expect(txt(wishes)).toContain('Кофемашина')
    expect(txt(wishes)).not.toContain('общие')
    expect(wishes.querySelectorAll('.size-14').length).toBeGreaterThan(0)
  })

  it('(в) «+» → «Расход» → «Выписка» — `/week?upload=1`; «Доход» — лист дохода; «Месяц» → «История» = операции месяца', async () => {
    const A = await phone('a')
    const ops = useOperationsStore()
    for (const o of [op('o1', '2026-09-02', 7_000, 'MAGNUM', 'sc_food'), op('o2', '2026-09-10', 5_000, 'SMALL', 'sc_food'), op('o3', '2026-08-30', 3_000, 'COFFEE', 'sc_cafe')]) ops.ops[o.id] = o
    let router = await mount(A, '/month')
    await press(q('nav button[aria-label="Добавить"]'), '«+»')
    await press(q('[data-add-expense]'), 'плитка «Расход»')
    expect(txt(q('[data-add-back]'))).toBe('‹ Добавить')
    await press(byText('[role="dialog"] button', 'Выписка') ?? all('[role="dialog"] button').find((b) => txt(b).startsWith('Выписка'))!, '«Выписка»')
    expect(router.currentRoute.value.fullPath).toBe('/week?upload=1')

    router = await mount(A, '/month')
    await press(q('nav button[aria-label="Добавить"]'), '«+»')
    expect(q('[data-add-back]'), 'снова «Добавить»').toBeNull()
    await press(q('[data-add-income]'), 'плитка «Доход»')
    expect(router.currentRoute.value.fullPath).toBe('/month?income=1')

    router = await mount(A, '/month')
    expect(q('[data-afford-open]')).toBeNull()
    await press(q('[data-month-feed]'), '«История»')
    const { marked, categories } = ops.totalMarks(ops.shown)
    const feed = monthFeed(ops.shown, { month: '2026-09', marked, categories })
    expect(feed.count).toBe(2)
    expect(txt(q('[data-feed-meta]'))).toBe('2 операции')
    expect(all('[role="dialog"] [data-feed-op]').map((r) => r.dataset.feedOp)).toEqual(['o2', 'o1'])
  })

  it('(г) цель: «Пополнить» на обложке → взнос; «В месяц» → лист → взнос изменён, «Снять» оттуда; прошедшая поездка — «Съездили?» → «Сбылось»', async () => {
    const A = await phone('a')
    await mount(A, '/goals/japan')
    await press(q('[data-goal-deposit]'), '«Пополнить»')
    await type(q<HTMLInputElement>('[role="dialog"] input[inputmode]'), '50000', 'сумма взноса')
    await press(byText('[role="dialog"] button', 'Внести'), '«Внести»')
    expect(A.store.goals.find((g) => g.id === 'japan')!.movements.map((m) => m.amount)).toEqual([50_000])
    expect(txt(q('[data-goal-movement]'))).toBe(norm(`+${money(50_000)}`))

    await press(q('[data-goal-monthly]'), 'ячейка «В месяц»')
    await type(q<HTMLInputElement>('[role="dialog"] input[inputmode]'), '73000', 'взнос в месяц')
    expect(A.store.goals.find((g) => g.id === 'japan')!.monthly).toBe(73_000)
    await press(q('[data-goal-withdraw]'), '«Снять»')
    expect(all('[role="dialog"] h3').map(txt)).toContain('Снять средства')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await tick()

    await mount(A, '/goals/tour')
    expect(txt(q('[data-goal-term]'))).toBe('1–5 сентября')
    expect(txt(q('[data-trip-label]'))).toBe('Потрачено в поездке')
    const ask = q('[data-trip-ask]')!
    expect(txt(ask)).toContain('Съездили?')
    expect(q('[data-goal-deposit]'), 'у прошедшей поездки «Пополнить» нет').toBeNull()
    await press(ask.querySelector('[data-goal-done]'), '«Сбылось»')
    expect(A.store.goals.find((g) => g.id === 'tour')!.doneAt).toBeTruthy()
  })

  it('(д) «Деньги»: рамки «счета» и «долги» = капитал; калькулятор — «−N мес.», «Подробнее ›» раскрывает лесенку', async () => {
    const A = await phone('a')
    await mount(A, '/money')
    const worth = netWorth(liveAccounts(A.store.accounts), liveCredits(A.store.credits), openGoals(A.store.goals))
    const digits = (s: string) => Number(s.replace(/\D/g, ''))
    expect(txt(q('[data-worth-assets]'))).toMatch(/^счета \d/)
    expect(txt(q('[data-worth-debts]'))).toMatch(/^долги \d/)
    expect(digits(txt(q('[data-worth-assets]'))) - digits(txt(q('[data-worth-debts]')))).toBe(worth)

    await mount(A, '/money?payoff=loan')
    await type(q<HTMLInputElement>('[role="dialog"] input[inputmode]'), '58000', 'добавка к платежу')
    expect(txt(q('[data-payoff-months]'))).toMatch(/^−\d+ мес\.$/)
    expect(txt(q('[data-payoff-saved]'))).toMatch(/^переплата меньше на \d/)
    const ladder = q<HTMLDetailsElement>('[data-payoff-ladder]')!
    expect(ladder.open).toBe(false)
    await press(ladder.querySelector('summary'), '«Подробнее ›»')
    expect(ladder.open).toBe(true)
    expect(txt(ladder)).toContain('Отдача падает')
  })

  it('(е) вход: «‹ Назад» над «Реально.», коробка Google 52 — и пока кнопки нет', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/access')
    await router.isReady()
    app?.unmount()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(RouterView) })
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await tick()
    const page = document.body.innerHTML
    expect(page.indexOf('‹ Назад')).toBeGreaterThan(-1)
    expect(page.indexOf('‹ Назад')).toBeLessThan(page.indexOf('Реально.'))
    const box = q('[data-testid="google-button"]')!
    expect(box.className).toContain('h-[52px]')
    expect(box.childElementCount, 'GIS ещё не дорисовал кнопку').toBe(0)
  })

  it('(ж) viewer: без «+», «Истории» месяца, «Пополнить» и галочек желаний', async () => {
    const V = await phone('b', 'viewer')
    await mount(V, '/month')
    expect(q('nav button[aria-label="Добавить"]')).toBeNull()
    expect(q('[data-month-feed]')).toBeNull()
    await mount(V, '/goals/japan')
    expect(q('[data-goal-deposit]')).toBeNull()
    expect(q('[data-goal-monthly]')!.tagName).toBe('DIV')
    await mount(V, '/wishes')
    expect(q('[aria-label="Отметить купленным"]')).toBeNull()
  })
})
