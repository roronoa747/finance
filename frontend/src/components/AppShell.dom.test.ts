// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import AppShell from './AppShell.vue'

/**
 * Прокрутка при смене экрана (хвост приёмки Блока 3): прокручивается не окно, а <main>
 * оболочки — SSR этого не видит, проверяем в DOM.
 */

let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const page = (name: string) => defineComponent({ render: () => h('div', { style: 'height: 3000px' }, name) })

it('новый экран — <main> наверх; параметр адреса того же экрана (окно Капитала, Б-15) — прокрутка остаётся', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', component: page('Обзор') },
          { path: 'capital', component: page('Капитал') },
          { path: 'plan', component: page('План') },
        ],
      },
    ],
  })
  await router.push('/capital')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(createPinia())
  app.use(router)
  app.mount(root)
  await nextTick()

  const main = document.querySelector('main')!
  main.scrollTop = 400
  await router.push('/capital?credit=cc')
  await nextTick()
  expect(main.scrollTop).toBe(400)

  await router.push('/plan')
  await nextTick()
  expect(document.querySelector('main')!.textContent).toContain('План')
  expect(main.scrollTop).toBe(0)
})
