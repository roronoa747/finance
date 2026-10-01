// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, computed, defineComponent, h, nextTick, type App } from 'vue'
import { createRouter, createMemoryHistory, useRoute, RouterView } from 'vue-router'
import { PhHeart, PhCalendarBlank, PhWallet } from '@phosphor-icons/vue'
import Tabs from './Tabs.vue'

/** Вкладки в DOM (B2C-12): переход по ссылке двигает aria-current; «+» — событие, не переход. */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('kit/Tabs в DOM', () => {
  it('aria-current следует за маршрутом; «+» не меняет адрес', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: { render: () => h('div') } }],
    })
    const plus: number[] = []
    const Shell = defineComponent({
      setup() {
        const route = useRoute()
        const items = computed(() => [
          { to: '/', label: 'Мечты', icon: PhHeart, active: route.path === '/' },
          { to: '/week', label: 'Неделя', icon: PhCalendarBlank, active: route.path.startsWith('/week') },
          { to: '/money', label: 'Деньги', icon: PhWallet, active: route.path.startsWith('/money') },
        ])
        return () => h('div', [h(RouterView), h(Tabs, { items: items.value, onPlus: () => plus.push(1) })])
      },
    })
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Shell)
    app.use(router)
    app.mount(root)
    await nextTick()

    const links = () => [...document.querySelectorAll<HTMLAnchorElement>('nav a')]
    const current = () => links().find((a) => a.getAttribute('aria-current') === 'page')?.textContent?.trim()
    expect(current()).toBe('Мечты')

    links()[1].click()
    // RouterLink ведёт переход асинхронно (guards → push): ждём очередь микрозадач и рендер.
    await new Promise((r) => setTimeout(r, 20))
    await nextTick()
    expect(router.currentRoute.value.path).toBe('/week')
    expect(current()).toBe('Неделя')

    document.querySelector<HTMLButtonElement>('nav button[aria-label="Добавить"]')!.click()
    expect(plus).toEqual([1])
    expect(router.currentRoute.value.path).toBe('/week')
  })
})
