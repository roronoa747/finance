// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import PlanSwitch from './PlanSwitch.vue'
import { PLAN_VIEW_KEY } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth'
import { authAs } from '@/test/planFamily'

/**
 * B2C-93 (Р-89, Р-99, Р-104): переключатель «Неделя | Месяц» меняет маршрут и запоминает выбор; вкладка «План»
 * открывает последний вид; пустое или недоступное хранилище — «Неделя»; viewer — всегда «Месяц».
 */
let app: App | null = null

const page = (view: 'week' | 'month') => defineComponent({ render: () => h('div', [h(PlanSwitch, { view }), view]) })

async function mount(role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', component: { render: () => h('div', 'Мечты') } },
          { path: 'week', component: page('week') },
          { path: 'month', component: page('month') },
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
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
  }
  const tab = () => [...document.querySelectorAll('nav a')].find((a) => a.textContent?.includes('План')) as HTMLAnchorElement
  const seg = (v: 'week' | 'month') => document.querySelector(`[data-plan-view="${v}"]`) as HTMLButtonElement
  return { router, settle, tab, seg }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('«План»: переключатель и память вида', () => {
  it('пустое хранилище — вкладка ведёт на «Неделю»; «Месяц» меняет маршрут и запоминается; вкладка открывает последний вид', async () => {
    const { router, settle, tab, seg } = await mount()
    expect(tab().getAttribute('href')).toBe('/week')
    tab().click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/week')
    expect(seg('week').getAttribute('aria-selected')).toBe('true')
    expect(tab().getAttribute('aria-current')).toBe('page')

    seg('month').click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/month')
    expect(JSON.parse(localStorage.getItem(PLAN_VIEW_KEY)!)).toBe('month')
    expect(seg('month').getAttribute('aria-selected')).toBe('true')
    expect(tab().getAttribute('aria-current')).toBe('page')

    // Ушли на «Мечты» и вернулись вкладкой — «Месяц».
    await router.push('/')
    await settle()
    expect(tab().getAttribute('href')).toBe('/month')
    tab().click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/month')

    // И обратно: «Неделя» запоминается так же.
    seg('week').click()
    await settle()
    expect(router.currentRoute.value.path).toBe('/week')
    await router.push('/')
    await settle()
    expect(tab().getAttribute('href')).toBe('/week')
  })

  it('хранилище бросает при чтении или в нём мусор — «Неделя»', async () => {
    localStorage.setItem(PLAN_VIEW_KEY, '{не json')
    const broken = await mount()
    expect(broken.tab().getAttribute('href')).toBe('/week')
    app?.unmount()
    document.body.innerHTML = ''

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('закрыто')
    })
    const closed = await mount()
    expect(closed.tab().getAttribute('href')).toBe('/week')
  })

  it('viewer: вкладка «План» — всегда «Месяц», что бы ни помнило устройство', async () => {
    localStorage.setItem(PLAN_VIEW_KEY, JSON.stringify('week'))
    const { tab } = await mount('viewer')
    expect(tab().getAttribute('href')).toBe('/month')
  })

  it('точка на «Месяце» — только когда она задана и открыта «Неделя»', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => h('div') } }] })
    app = createApp({ render: () => h('div', [h(PlanSwitch, { view: 'week', dot: true }), h(PlanSwitch, { view: 'month', dot: true }), h(PlanSwitch, { view: 'week' })]) })
    app.use(router)
    app.mount(root)
    await nextTick()
    expect(document.querySelectorAll('[data-plan-dot]')).toHaveLength(1)
    expect(document.querySelector('[data-plan-view="month"] [data-plan-dot]')).not.toBeNull()
  })
})
