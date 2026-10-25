// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { ruleMatchOf } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import HistorySquare from './HistorySquare.vue'
import HistoryMonths from './HistoryMonths.vue'

/**
 * B2C-44: раздел задним числом из «Истории» — нажатие на операцию → лист «куда отнести?» с теми же
 * ответами, что у незнакомого продавца «Недели» (`CategoryChips`) → `recategorize` с продавцом
 * строки; строка и итоги месяца (`spendTotals`) пересчитаны.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-25T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const op = (id: string, date: string, amount: number, merchant: string): Operation => ({
  id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false,
})

describe('B2C-44: «куда отнести?» из «Истории»', () => {
  it('нажатие на операцию → чипы разделов → recategorize(продавец, раздел); строка и spendTotals — в «Продуктах»', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member'))
    const finance = useFinanceStore()
    finance.setHouseholdDoc(planFamilyDoc(), 1)
    const ops = useOperationsStore()
    const a = op('o1', '2026-09-11', -3_000, 'Непонятно ТОО')
    const b = op('o2', '2026-09-20', -2_000, 'Непонятно ТОО')
    ops.ops.o1 = a
    ops.ops.o2 = b
    const spy = vi.spyOn(ops, 'recategorize')
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money/history')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(HistorySquare)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()

    const row = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes('Непонятно ТОО'))!
    expect(row.textContent).toContain('Не разобрано')
    row.click()
    await nextTick()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Мне вернули') // лист операции (FB-04)
    for (const t of ['Продукты', 'Между своими']) expect(dialog.textContent).toContain(t)
    ;[...dialog.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim() === 'Продукты')!.click()
    await nextTick()
    await nextTick()

    expect(spy).toHaveBeenCalledWith(ruleMatchOf(a), { categoryId: 'sc_food' })
    expect(ops.all.map((o) => o.categoryId)).toEqual(['sc_food', 'sc_food'])
    const food = (finance.householdDoc.spendTotals ?? []).find((t) => t.kind === 'month' && t.period === '2026-09' && t.categoryId === 'sc_food')
    expect(food?.amount).toBe(5_000)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Не разобрано')
  })

  it('ручная трата (бэклог «Ручная трата», критик): строка не кнопка — «куда отнести?» завёл бы правило семьи по заметке', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    const ops = useOperationsStore()
    ops.ops.h1 = { ...op('h1', '2026-09-11', -2_500, 'Базар'), bank: 'hand', note: 'Базар', categoryId: 'sc_food' }
    ops.ops.o1 = op('o1', '2026-09-12', -3_000, 'Непонятно ТОО')
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money/history')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(HistorySquare)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()

    expect(document.body.textContent).toContain('Базар')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.some((x) => x.textContent?.includes('Базар'))).toBe(false)
    expect(buttons.some((x) => x.textContent?.includes('Непонятно ТОО'))).toBe(true)
  })
})

describe('B2C-58, B2C-89: записи денег в «Истории» (Р-85)', () => {
  it('старый разбор — «Разложено», откуда и кто, части по статьям; запись плана — по целям; нажатие — сводка месяца плана', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member'))
    const finance = useFinanceStore()
    // Зарплату Ильяса разобрала Аруна: Жизнь 150 000, Мечты 50 000.
    finance.setHouseholdDoc(
      planFamilyDoc({
        allocations: [
          {
            id: 'r1', kind: 'breakdown', source: 'salary', sourceId: 'a', period: '2026-09', by: 'b',
            at: '2026-09-12T07:00:00.000Z', updatedAt: '2026-09-12T07:00:00.000Z', total: 200_000,
            parts: [{ target: 'dreams', amount: 50_000 }, { target: 'life', amount: 150_000 }],
          },
          {
            id: 'p1', kind: 'plan', source: 'salary', sourceId: 'b', period: '2026-09', by: 'b',
            at: '2026-09-20T07:00:00.000Z', updatedAt: '2026-09-20T07:00:00.000Z', total: 500_000,
            parts: [{ target: 'trip', amount: 40_000 }, { target: 'prepay:loan', amount: 30_000 }],
          },
        ],
      }),
      1,
    )
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money/history')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(HistorySquare)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()

    const row = [...document.querySelectorAll<HTMLElement>('button')].find((x) => x.textContent?.includes('Разложено'))!
    expect(row.textContent).toContain('зарплата · Ильяс · Аруна')
    // Части — в порядке плана: Жизнь, потом Мечты.
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ')
    expect(text.indexOf('Жизнь')).toBeGreaterThan(-1)
    expect(text.indexOf('Жизнь')).toBeLessThan(text.indexOf('Мечты'))
    const push = vi.spyOn(router, 'push')
    row.click()
    await nextTick()
    expect(push).toHaveBeenCalledWith('/month?month=2026-09')
    // Запись «Отложить по плану» — по целям и досрочке, тем же путём в сводку месяца.
    const plan = [...document.querySelectorAll<HTMLElement>('button')].find((x) => x.textContent?.includes('Отложено по плану'))!
    expect(plan.textContent).toContain('зарплата · Аруна')
    expect(text).toContain('Отпуск')
    expect(text).toContain('Досрочка в «Кредит»')
  })
})

describe('RZ-08: раздел по адресу `?cat=<id>` («Открыть» совета про продавца)', () => {
  async function mountAt(path: string, view: Component = HistorySquare) {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    const ops = useOperationsStore()
    ops.ops.o1 = { ...op('o1', '2026-09-11', -3_000, 'Аптека у дома'), categoryId: 'sc_health' }
    ops.ops.o2 = { ...op('o2', '2026-09-12', -9_000, 'Магазин'), categoryId: 'sc_food' }
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(view)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    return router
  }
  const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="group"] button')].find((b) => b.textContent?.trim() === label)!

  it('чип раздела выбран, лента — его покупки; «Всё» снимает параметр и фильтр', async () => {
    const router = await mountAt('/money/history?cat=sc_health')
    expect(document.querySelector('[data-chip="sc_health"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(chip('Всё').getAttribute('aria-pressed')).toBe('false')
    expect(document.body.textContent).toContain('Аптека у дома')
    expect(document.body.textContent).not.toContain('Магазин')
    chip('Всё').click()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/money/history'))
    await nextTick()
    expect(chip('Всё').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('Магазин')
  })

  it('«История» (месяцы): с `?cat` лента «Все записи» раскрыта, чип выбран; без — свёрнута', async () => {
    await mountAt('/money/history?cat=sc_health', HistoryMonths)
    expect(document.querySelector('[data-history-feed]')!.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-chip="sc_health"]')!.getAttribute('aria-pressed')).toBe('true')
    app!.unmount()
    app = null
    document.body.innerHTML = ''
    await mountAt('/money/history', HistoryMonths)
    expect(document.querySelector('[data-history-feed]')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('раздела нет среди своих покупок (продавец партнёра) — чип всё равно виден и выбран', async () => {
    await mountAt('/money/history?cat=sc_cafe')
    expect(document.querySelector('[data-chip="sc_cafe"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).toContain('Здесь пока ничего.')
  })
})

describe('FB-04: лист операции из «Истории»', () => {
  async function history(role: 'member' | 'viewer') {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs(role))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
    const ops = useOperationsStore()
    ops.ops.s1 = { ...op('s1', '2026-09-11', -30_000, 'Дана К.'), kind: 'transfer-out', counterparty: 'Дана К.', categoryId: 'sc_people' }
    ops.ops.i1 = { ...op('i1', '2026-09-14', 30_000, 'Дана К.'), kind: 'transfer-in', counterparty: 'Дана К.' }
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money/history')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(HistorySquare)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    return ops
  }

  it('заметка и «Мне вернули» на месте; вернули переводом — приход ушёл из «Истории», строка траты — 0 и «вернули»', async () => {
    const ops = await history('member')
    expect(document.querySelectorAll('button').length).toBeGreaterThan(0)
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.includes('Дана К.'))
    // Перевод и приход — две строки (приход не трата — не кнопка, но строка есть).
    expect(document.body.textContent).toContain('+30')
    rows().find((b) => b.textContent?.includes('−'))!.click()
    await nextTick()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('[data-op-memo]')).toBeTruthy()
    ;(dialog.querySelector('[data-op-refund]') as HTMLElement).click()
    await nextTick()
    ;(dialog.querySelector('[data-op-income="i1"]') as HTMLElement).click()
    await nextTick()
    await nextTick()
    expect(ops.all.find((o) => o.id === 's1')?.refund).toEqual({ amount: 30_000, opId: 'i1' })
    expect(document.body.textContent).not.toContain('+30')
    expect(document.querySelector('[data-refund]')?.textContent?.replace(/\s/g, '')).toBe('вернули30000₸') // Р-12 «Figma»
  })

  it('viewer — строки операций не кнопки', async () => {
    await history('viewer')
    expect([...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Дана К.'))).toBe(false)
    expect(document.body.textContent).toContain('Дана К.')
  })
})
