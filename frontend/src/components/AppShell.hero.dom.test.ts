// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import Dreams from '@/views/Dreams.vue'
import AppShell from './AppShell.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * FG-21 (пачка 2 «Figma», 47:2): на «Мечтах» с главной мечтой шапка оболочки не рисуется — её место на обложке
 * (`ShellPeople` — тот же источник аватаров). Ушли с «Мечт» — шапка оболочки вернулась, второй шапки нет.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const page = (name: string) => defineComponent({ render: () => h('div', name) })

async function mount(goals: 'main' | 'none') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const doc = planFamilyDoc()
  if (goals === 'none') doc.goals = []
  useFinanceStore().setHouseholdDoc(doc, 1)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', name: 'dreams', component: Dreams },
          { path: 'month', name: 'month', component: page('Месяц') },
          { path: 'settings', name: 'settings', component: page('Настройки') },
        ],
      },
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
  await nextTick()
  return router
}

const shellHeader = () => document.querySelector('[data-shell-header]')
const people = () => document.querySelectorAll('[data-shell-people]')
const settingsLinks = () => document.querySelectorAll('a[aria-label="Настройки"]')

it('«Мечты» с главной мечтой: шапки оболочки нет, «Мечты», аватары и «Настройки» — на обложке, по одному разу', async () => {
  await mount('main')
  expect(document.querySelector('[data-dreams-cover]')).not.toBeNull()
  expect(shellHeader()).toBeNull()
  expect(people()).toHaveLength(1)
  expect(document.querySelector('[data-dreams-cover] [data-shell-people]')).not.toBeNull()
  expect(settingsLinks()).toHaveLength(1)
  expect(document.querySelectorAll('header')).toHaveLength(1)
  expect(document.querySelector('header')!.textContent).toContain('Мечты')
})

it('ушли с «Мечт» на «Месяц» — шапка оболочки прежняя, одна; вернулись — снова на обложке', async () => {
  const router = await mount('main')
  await router.push('/month')
  await nextTick()
  await nextTick()
  expect(shellHeader()).not.toBeNull()
  expect(document.querySelectorAll('header')).toHaveLength(1)
  expect(document.querySelector('header')!.textContent).toContain('План')
  expect(people()).toHaveLength(1)

  await router.push('/')
  await nextTick()
  await nextTick()
  expect(shellHeader()).toBeNull()
  expect(document.querySelectorAll('header')).toHaveLength(1)
})

it('без главной мечты — пустой экран с шапкой оболочки', async () => {
  await mount('none')
  expect(document.querySelector('[data-dreams-cover]')).toBeNull()
  expect(shellHeader()).not.toBeNull()
  expect(document.body.textContent).toContain('На что копим?')
})
