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
import { netWorth, liveAccounts, liveCredits, openGoals } from '../src/lib/finance'
import type { Operation } from '../src/lib/statements/types'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Goal, SyncDoc } from '../src/types/finance'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Приёмка Блока 4 «Пачка 2 · Вид» бэклога «Figma» — сценарии, которых нет в `fg-block4-pack2`: шапка «Мечт» не двоится при
 * переходах туда-обратно и без главной мечты; каждый пункт «+» ведёт на свой адрес, «Хватит?» нигде нет; «История» месяца
 * несёт строки «Истории» недели день в день; фонд — «Месяцев трат» без «₸»; «Купили?» / «Съездили?» прячут ячейки до ответа;
 * партнёр — участник с теми же действиями; «Деньги» без долгов. Семья `planFamilyDoc`, суббота 12 сентября 2026.
 */

type Phone = { pinia: Pinia; store: ReturnType<typeof useFinanceStore> }
let app: App | null = null
let server: FakeServer

const goal = (id: string, name: string, extra: Partial<Goal> = {}): Goal => ({
  id, name, need: 1_000_000, seed: 0, have: 0, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})
const op = (id: string, date: string, amount: number, merchant: string): Operation => ({
  id, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId: 'sc_food', internal: false,
})
const japan = goal('japan', 'Япония', { seed: 300_000, have: 300_000, main: true })
const bike = goal('bike', 'Велосипед', { seed: 230_000, have: 230_000, need: 230_000, doneAt: '2026-08-20T07:00:00.000Z' })
const pot = goal('pot', 'Подушка', { need: 0, monthly: 30_000, template: 'cushion', fund: 'cushion' })

async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(backend(server))
  return { pinia, store }
}
const family = (extra: Partial<SyncDoc>) => (server = fakeServer(planFamilyDoc(extra)))

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
async function goTo(router: Router, path: string) {
  await router.push(path)
  await tick()
}
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const dialogButton = (title: string) => all('[role="dialog"] button').find((b) => txt(b) === title) ?? null
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
/** Строки открытого листа «История»: «день|id операции» по порядку. */
const feedRows = () => {
  const out: string[] = []
  let day = ''
  for (const el of document.querySelectorAll('[role="dialog"] [data-feed-day], [role="dialog"] [data-feed-op]')) {
    if (el.hasAttribute('data-feed-day')) day = txt(el)
    else out.push(`${day}|${(el as HTMLElement).dataset.feedOp}`)
  }
  return out
}
/** Шапок на странице: оболочки и всего (`header` обложки «Мечт» — вторая). */
const headers = () => ({ shell: all('[data-shell-header]').length, all: all('header').length })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('ff_tips_seen', JSON.stringify(['tab-week', 'tab-month', 'tab-money', 'tab-dreams']))
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] } as never)
  family({ goals: [japan, bike, pot] })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('e2e / «Figma» Блок 4 — приёмка', () => {
  it('(1) шапка «Мечт» не двоится: «Мечты» → цель → «План» → «Мечты» — всегда одна шапка; без главной мечты — шапка оболочки и «Сбылось»', async () => {
    const A = await phone('a')
    const router = await mount(A, '/')
    expect(q('[data-dreams-cover]')).not.toBeNull()
    expect(headers(), '«Мечты»: шапка на обложке').toEqual({ shell: 0, all: 1 })
    await goTo(router, '/goals/japan')
    expect(headers(), 'цель: шапка оболочки вернулась').toEqual({ shell: 1, all: 1 })
    expect(q('[data-shell-header] [aria-label="Меню цели"]'), '«···» цели — в шапке оболочки').not.toBeNull()
    await goTo(router, '/month')
    expect(headers()).toEqual({ shell: 1, all: 1 })
    await goTo(router, '/')
    expect(headers(), 'снова «Мечты»').toEqual({ shell: 0, all: 1 })
    expect(all('[data-shell-people]').length, 'аватары — один раз').toBe(1)

    // Без главной мечты (только фонд и сбывшаяся): обложки нет, шапка оболочки, «Сбылось · 1» доступна.
    family({ goals: [bike, pot] })
    const B = await phone('a')
    await mount(B, '/')
    expect(q('[data-dreams-cover]')).toBeNull()
    expect(headers()).toEqual({ shell: 1, all: 1 })
    expect(txt(q('[data-done-link]'))).toBe('Сбылось · 1')
    expect(q('[data-new-goal]'), '«+» целей — только при главной мечте').toBeNull()

    // Без сбывшихся — ссылки нет.
    family({ goals: [japan, pot] })
    const C = await phone('a')
    await mount(C, '/')
    expect(q('[data-done-link]')).toBeNull()
    expect(q('[data-done-album-card]')).toBeNull()
  })

  it('(2) «+»: каждый пункт и плитка ведут на свой адрес, «Хватит ли?» нет нигде; `?afford=1` ничего не открывает', async () => {
    const A = await phone('a')
    const routes: Record<string, string> = {}
    for (const [page, title] of [['root', 'Мечта'], ['root', 'Желание'], ['root', 'Заметка'], ['root', 'Прикинуть кредит'], ['root', 'Доход'],
      ['expense', 'Трата'], ['expense', 'Выписка'], ['expense', 'Платёж или подписка'], ['expense', 'Долг']] as const) {
      const router = await mount(A, '/month')
      await press(q('nav button[aria-label="Добавить"]'), '«+»')
      expect(txt(q('[role="dialog"]'))).not.toMatch(/Хватит/)
      if (page === 'expense') await press(q('[data-add-expense]'), 'плитка «Расход»')
      await press(title === 'Доход' ? q('[data-add-income]') : dialogButton(title), title)
      routes[title] = router.currentRoute.value.fullPath
    }
    expect(routes).toEqual({
      'Мечта': '/goals/new', 'Желание': '/wishes', 'Заметка': '/week?note=1', 'Прикинуть кредит': '/money/debts?try=1', 'Доход': '/month?income=1',
      'Трата': '/week?spend=1', 'Выписка': '/week?upload=1', 'Платёж или подписка': '/money?add=payment', 'Долг': '/money?add=debt',
    })

    await mount(A, '/month?afford=1')
    expect(q('[role="dialog"]'), '«Хватит?» больше не открывается').toBeNull()
    expect(q('[data-afford-open]')).toBeNull()
  })

  it('(3) «История» месяца несёт строки «Истории» недели день в день; соседний месяц не входит', async () => {
    const A = await phone('a')
    const ops = useOperationsStore()
    for (const o of [
      op('w1', '2026-09-08', 4_000, 'MAGNUM'), op('w2', '2026-09-10', 6_000, 'SMALL'), op('w3', '2026-09-12', 2_500, 'COFFEE'),
      op('m1', '2026-09-02', 7_000, 'GALMART'), op('p1', '2026-08-30', 3_000, 'AUGUST'),
    ]) ops.ops[o.id] = o
    await mount(A, '/month')
    await press(q('[data-month-feed]'), '«История» месяца')
    const month = feedRows()
    expect(month.map((r) => r.split('|')[1])).toEqual(['w3', 'w2', 'w1', 'm1'])
    expect(txt(q('[data-feed-meta]'))).toBe('4 операции')
    await escape()

    await mount(A, '/week')
    await press(q('[data-week-feed]'), '«История» недели')
    const week = feedRows()
    expect(week.map((r) => r.split('|')[1])).toEqual(['w3', 'w2', 'w1'])
    expect(week.every((r) => month.includes(r)), 'та же строка в тот же день').toBe(true)
  })

  it('(4) фонд: «хватит на» над ячейками; в листе «Взнос в месяц» «₸» только у взноса, у «Месяцев трат» знака нет', async () => {
    const A = await phone('a')
    await mount(A, '/goals/pot')
    const cells = q('[data-goal-cells]')!
    expect(cells.querySelector('[data-cushion-cover]'), 'заголовок подушки — в карточке ячеек').not.toBeNull()
    await press(q('button[data-goal-monthly]'), '«В месяц»')
    const inputs = all('[role="dialog"] input[inputmode]')
    expect(inputs.length, 'взнос и месяцы трат').toBe(2)
    expect(all('[role="dialog"] [data-num-suffix]').map(txt)).toEqual(['₸'])
    const months = all('[role="dialog"] label').find((l) => txt(l).startsWith('Месяцев трат'))!
    expect(months, 'поле «Месяцев трат»').toBeTruthy()
    expect(months.querySelector('[data-num-suffix]'), 'у месяцев «₸» нет').toBeNull()
    expect(q('[data-goal-withdraw]'), '«Снять» — в листе').not.toBeNull()
  })

  it('(5) «Купили?» и «Съездили?» — строка с маленькими кнопками; ячеек и «Пополнить» нет до ответа, «Ещё нет» их возвращает', async () => {
    family({ goals: [
      japan,
      goal('tv', 'Телевизор', { need: 500_000, seed: 500_000, have: 500_000 }),
      goal('tour', 'Тур', { seed: 200_000, have: 200_000, from: '2026-09-01', to: '2026-09-05', budget: 150_000 }),
    ] })
    const A = await phone('a')
    for (const [id, ask, sel] of [['tv', 'Купили?', '[data-goal-ask]'], ['tour', 'Съездили?', '[data-trip-ask]']] as const) {
      await mount(A, `/goals/${id}`)
      const row = q(sel)!
      expect(txt(row.querySelector('span'))).toBe(ask)
      expect([...row.querySelectorAll('button')].map(txt)).toEqual(['Ещё нет', 'Сбылось'])
      for (const b of row.querySelectorAll('button')) expect(b.className, 'кнопки xs').toContain('h-[26px]')
      expect(q('[data-goal-cells]'), `${id}: ячеек нет до ответа`).toBeNull()
      expect(q('[data-goal-deposit]')).toBeNull()
      await press(row.querySelector('[data-goal-not-yet]'), '«Ещё нет»')
      expect(q(sel)).toBeNull()
      expect(q('[data-goal-cells]'), `${id}: ячейки вернулись`).not.toBeNull()
      expect(q('[data-goal-deposit]'), `${id}: «Пополнить» вернулась`).not.toBeNull()
    }
    expect(A.store.goals.filter((g) => g.doneAt).map((g) => g.id), '«Ещё нет» ничего не пишет').toEqual([])
  })

  it('(6) партнёр-участник: обложка и «+» целей, «Пополнить» и ячейка-кнопка, «История» месяца — как у первого', async () => {
    const B = await phone('b')
    await mount(B, '/')
    expect(q('[data-dreams-cover]')).not.toBeNull()
    expect(q('[data-new-goal]')).not.toBeNull()
    await mount(B, '/goals/japan')
    expect(q('[data-goal-deposit]')).not.toBeNull()
    expect(q('[data-goal-monthly]')!.tagName).toBe('BUTTON')
    await mount(B, '/month')
    expect(q('[data-month-feed]')).not.toBeNull()
    expect(q('nav button[aria-label="Добавить"]')).not.toBeNull()
  })

  it('(7) «Деньги» без долгов: одна рамка «счета N ₸» = капитал и тихое «долгов нет»', async () => {
    family({ goals: [japan], credits: [] })
    const A = await phone('a')
    await mount(A, '/money')
    const worth = netWorth(liveAccounts(A.store.accounts), liveCredits(A.store.credits), openGoals(A.store.goals))
    expect(q('[data-worth-debts]')).toBeNull()
    expect(txt(q('[data-worth-no-debts]'))).toBe('долгов нет')
    expect(txt(q('[data-worth-assets]'))).toMatch(/^счета \d[\d\s]* ₸$/)
    expect(Number(txt(q('[data-worth-assets]')).replace(/\D/g, ''))).toBe(worth)
    expect(q('[data-worth-formula]')).toBeNull()
  })
})
