// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { RouterView, createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import type { WishItem } from '@/types/finance'
import { T0, authAs, planFamilyDoc } from '@/test/planFamily'
import Wishes from './Wishes.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-34: «Уже купили» свёрнуто, как альбом «Сбылось» — нажатие раскрывает (и сумма), повторное сворачивает;
 * «назад» с другого экрана — как оставили (`history.state.boughtOpen`), новый заход — свёрнуто. Viewer — так же.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T08:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const wish = (w: Partial<WishItem> & Pick<WishItem, 'id' | 'name' | 'price'>): WishItem => ({
  by: 'a', addedOn: '2026-09-10T06:00:00.000Z', bought: false, updatedAt: T0, ...w,
})
const wishlist = [
  wish({ id: 'pan', name: 'Сковорода', price: 18_000 }),
  wish({ id: 'vac', name: 'Пылесос', price: 180_000, bought: true, boughtOn: '2026-09-20T15:00:00.000Z' }),
  wish({ id: 'iron', name: 'Утюг', price: 25_000, bought: true, boughtOn: '2026-09-22T15:00:00.000Z' }),
]

async function open(role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  useFinanceStore().setHouseholdDoc(planFamilyDoc({ wishlist }), 1)
  // Настоящая история браузера и RouterView: экран уходит и возвращается «назад», как в оболочке.
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/wishes', component: Wishes },
      { path: '/elsewhere', component: { render: () => null } },
    ],
  })
  await router.push('/wishes')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return router
}

const toggle = () => document.querySelector<HTMLButtonElement>('[data-bought-toggle]')!
const text = () => document.body.textContent ?? ''

describe('PN-34: «Уже купили» свёрнуто', () => {
  for (const role of ['member', 'viewer'] as const) {
    it(`${role}: свёрнуто → нажатие раскрывает купленное и сумму → повторное сворачивает`, async () => {
      await open(role)
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(toggle().textContent).toContain('Уже купили · 2')
      expect(text()).toContain('Сковорода')
      expect(text()).not.toContain('Пылесос')
      expect(document.querySelector('[data-bought-sum]')).toBeNull()

      toggle().click()
      await nextTick()
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(text()).toContain('Пылесос')
      expect(text()).toContain('Утюг')
      expect(document.querySelector('[data-bought-sum]')!.textContent).toBe(money(205_000))

      toggle().click()
      await nextTick()
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(text()).not.toContain('Пылесос')
    })
  }

  it('«назад» с другого экрана — раскрыто, как оставили; новый заход — свёрнуто', async () => {
    const router = await open()
    toggle().click()
    await nextTick()
    await router.push('/elsewhere')
    await vi.waitFor(() => expect(document.querySelector('[data-bought-toggle]')).toBeNull())

    router.back()
    await vi.waitFor(() => expect(toggle().getAttribute('aria-expanded')).toBe('true'))
    expect(text()).toContain('Пылесос')

    await router.push('/elsewhere')
    await router.push('/wishes')
    await nextTick()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
  })
})
