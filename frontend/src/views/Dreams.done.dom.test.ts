// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
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
 * PN-14 (Р-13, ворота done.html): альбом «Сбылось · N» нажатием раскрывается на месте, строка ведёт на экран
 * сбывшейся; при новом заходе на «Мечты» снова свёрнут (критик Блока 4 — SSR-тест раскрывал миксином, клика не было).
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

const album = () => document.querySelector<HTMLButtonElement>('[data-done-album]')!
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-done-row]')]

describe('PN-14: альбом «Сбылось» нажатием', () => {
  it('свёрнут → нажатие раскрывает строку «Машина» → нажатие на строку — экран сбывшейся', async () => {
    const router = await open()
    expect(album().getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)

    album().click()
    await nextTick()
    expect(album().getAttribute('aria-expanded')).toBe('true')
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Машина')])

    rows()[0]!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/goals/car'))
  })

  it('повторное нажатие сворачивает; новый заход — снова свёрнут', async () => {
    await open()
    album().click()
    await nextTick()
    album().click()
    await nextTick()
    expect(rows()).toHaveLength(0)

    album().click()
    await nextTick()
    app!.unmount()
    document.body.innerHTML = ''
    await open()
    expect(album().getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
  })
})
