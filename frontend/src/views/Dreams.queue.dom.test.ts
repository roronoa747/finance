// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { SyncDoc, WishItem } from '@/types/finance'
import Dreams from './Dreams.vue'
import GoalDetail from './GoalDetail.vue'
import Wishes from './Wishes.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * B2C-87 (Р-84): «Мечты» — цели в порядке очереди, герой — первая цель (фонд — нет); ⋮⋮ переставляет цели среди
 * целей; «Сделать главной» — первый пункт меню цели, переносит наверх; «Желания» — свой порядок, переживает
 * перезагрузку; viewer — без ⋮⋮.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const wish = (id: string, name: string): WishItem => ({ id, name, price: 10_000, by: 'a', addedOn: T0, bought: false, updatedAt: T0 }) as WishItem

/** Семья: «Подушка» — копилка (фонд), «Отпуск», «Машина», «Дача»; очередь — Подушка наверху. */
function familyDoc(): SyncDoc {
  const doc = planFamilyDoc({
    wishlist: [wish('w1', 'Кофемашина'), wish('w2', 'Кроссовки'), wish('w3', 'Наушники')],
  })
  doc.goals.push({ ...doc.goals[2]!, id: 'dacha', name: 'Дача' })
  doc.moneySettings = { ...doc.moneySettings!, potGoalId: 'cushion' }
  doc.goalOrder = { ids: ['cushion', 'trip', 'car', 'dacha'], updatedAt: T0 }
  return doc
}

async function open(screen: Component, path: string, role: 'member' | 'viewer' = 'member', doc: SyncDoc = familyDoc()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(screen)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-id]')].map((el) => el.dataset.id)
const grip = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"] [data-grip]`)!
const key = async (id: string, k: 'ArrowUp' | 'ArrowDown') => {
  grip(id).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  await nextTick()
  await nextTick()
}
const heroText = () => document.body.textContent ?? ''

describe('B2C-87: «Мечты» — очередь и «главная = первая»', () => {
  it('фонд наверху очереди — герой следующая цель; список — цели по очереди, без фонда', async () => {
    await open(Dreams, '/')
    expect(heroText()).toContain('Отпуск')
    expect(rows()).toEqual(['car', 'dacha'])
  })

  it('⋮⋮ «выше» — цель среди целей; фонд стоит; переставленная наверх списка — вторая после героя', async () => {
    const finance = await open(Dreams, '/')
    await key('dacha', 'ArrowUp')
    expect(rows()).toEqual(['dacha', 'car'])
    expect(finance.goalOrder?.ids).toEqual(['cushion', 'trip', 'dacha', 'car', 'debt'])
  })

  it('перенос цели вверх очереди — она герой (тот же порядок, что в плане месяца)', async () => {
    const finance = await open(Dreams, '/')
    finance.moveGoal('car', 0)
    await nextTick()
    // «Машины» нет в списке — значит, на экране она героем.
    expect(rows()).toEqual(['trip', 'dacha'])
    expect(heroText()).toContain('Машина')
    expect(finance.heroGoal?.id).toBe('car')
  })

  it('«Сделать главной» — первый пункт меню цели, переносит наверх: на «Мечтах» герой — она', async () => {
    const finance = await open(GoalDetail, '/goals/dacha')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === 'Меню цели')!.click()
    await nextTick()
    const items = [...document.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent?.trim() ?? '')
    const main = items.findIndex((t) => t.includes('Сделать главной'))
    expect(main).toBeGreaterThanOrEqual(0)
    expect(main).toBeLessThan(items.findIndex((t) => t.includes('Изменить цель')))
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Сделать главной'))!.click()
    await nextTick()
    expect(finance.goalOrder?.ids[0]).toBe('dacha')
    expect(finance.heroGoal?.id).toBe('dacha')
    app!.unmount()
    app = null
    document.body.innerHTML = ''
    await open(Dreams, '/', 'member', finance.householdDoc as SyncDoc)
    expect(rows()).toEqual(['trip', 'car'])
  })

  it('пауза из меню — «на паузе» на «Мечтах»', async () => {
    const finance = await open(GoalDetail, '/goals/car')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === 'Меню цели')!.click()
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Поставить на паузу'))!.click()
    await nextTick()
    expect(finance.goals.find((g) => g.id === 'car')?.pausedAt).toBeTruthy()
    app!.unmount()
    app = null
    document.body.innerHTML = ''
    await open(Dreams, '/', 'member', finance.householdDoc as SyncDoc)
    expect(document.querySelector('[data-id="car"]')?.textContent).toContain('на паузе')
  })

  it('viewer — без ⋮⋮', async () => {
    await open(Dreams, '/', 'viewer')
    expect(rows()).toEqual(['car', 'dacha'])
    expect(document.querySelector('[data-grip]')).toBeNull()
  })
})

describe('B2C-87: «Желания» — свой порядок', () => {
  beforeEach(() => localStorage.setItem('ff_wishes_view', JSON.stringify('list')))

  it('⋮⋮ переставляет; порядок переживает перезагрузку (новый стор из того же документа)', async () => {
    const finance = await open(Wishes, '/wishes')
    expect(rows()).toEqual(['w1', 'w2', 'w3'])
    await key('w3', 'ArrowUp')
    await key('w3', 'ArrowUp')
    expect(rows()).toEqual(['w3', 'w1', 'w2'])
    expect(finance.wishOrder?.ids).toEqual(['w3', 'w1', 'w2'])
    const saved = JSON.parse(JSON.stringify(finance.householdDoc)) as SyncDoc
    app!.unmount()
    app = null
    document.body.innerHTML = ''
    await open(Wishes, '/wishes', 'member', saved)
    expect(rows()).toEqual(['w3', 'w1', 'w2'])
  })

  it('viewer — без ⋮⋮', async () => {
    await open(Wishes, '/wishes', 'viewer')
    expect(rows()).toEqual(['w1', 'w2', 'w3'])
    expect(document.querySelector('[data-grip]')).toBeNull()
  })
})
