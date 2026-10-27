// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { RouterView, createRouter, createMemoryHistory, createWebHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import Dreams from './Dreams.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-14 → FG-21 (пачка 2 «Figma», 47:2): «Сбылось · N ›» у «Целей» открывает лист сбывшихся, строка ведёт на экран
 * сбывшейся; при новом заходе на «Мечты» лист закрыт (было — альбом-карточка, раскрывавшаяся на месте).
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

async function open() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const doc = planFamilyDoc()
  doc.goals = doc.goals.map((g) => (g.id === 'car' ? { ...g, doneAt: '2026-09-05T07:00:00.000Z' } : g))
  useFinanceStore().setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Dreams)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return router
}

const link = () => document.querySelector<HTMLButtonElement>('[data-done-link]')!
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-done-row]')]

describe('FG-21: «Сбылось · N ›» → лист сбывшихся', () => {
  it('лист закрыт → ссылка открывает строку «Машина» → нажатие на строку — экран сбывшейся, лист закрыт', async () => {
    const router = await open()
    expect(document.querySelector('[data-done-album-card]')).toBeNull()
    expect(link().textContent).toContain('Сбылось · 1')
    expect(rows()).toHaveLength(0)

    link().click()
    await nextTick()
    expect(document.querySelector('[data-done-sheet]')).not.toBeNull()
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Машина')])
    expect(rows()[0]!.textContent).toContain('сен 2026 · за')

    rows()[0]!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/goals/car'))
    await nextTick()
    expect(rows()).toHaveLength(0)
  })

  it('новый заход на «Мечты» — лист закрыт', async () => {
    await open()
    link().click()
    await nextTick()
    expect(rows()).toHaveLength(1)
    app!.unmount()
    document.body.innerHTML = ''
    await open()
    expect(rows()).toHaveLength(0)
  })

  it('«назад» со сбывшейся — «Мечты» со ссылкой, лист закрыт', async () => {
    // Настоящая история браузера и RouterView: «Мечты» уходят со строки и возвращаются «назад», как в оболочке.
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member', 'a'))
    const doc = planFamilyDoc()
    doc.goals = doc.goals.map((g) => (g.id === 'car' ? { ...g, doneAt: '2026-09-05T07:00:00.000Z' } : g))
    useFinanceStore().setHouseholdDoc(doc, 1)
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: Dreams },
        { path: '/goals/:id', component: { render: () => null } },
      ],
    })
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(RouterView) })
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()

    link().click()
    await nextTick()
    rows()[0]!.click()
    await vi.waitFor(() => expect(document.querySelector('[data-done-link]')).toBeNull())

    router.back()
    await vi.waitFor(() => expect(link()).toBeTruthy())
    expect(rows()).toHaveLength(0)
  })
})
