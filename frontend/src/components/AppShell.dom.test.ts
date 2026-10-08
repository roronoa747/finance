// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import AppShell from './AppShell.vue'
import HeaderActions from './kit/HeaderActions.vue'

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

it('B2C-107: «Деньги» → цель (сверху) → назад — то же место; «Мечты» → «План» → «Мечты» — место «Мечт»; query — без прыжка', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', component: page('Мечты') },
          { path: 'month', component: page('Месяц') },
          { path: 'money', component: page('Деньги') },
          { path: 'goals/:id', component: page('Цель') },
        ],
      },
    ],
  })
  await router.push('/money')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(createPinia())
  app.use(router)
  app.mount(root)
  await nextTick()
  const main = document.querySelector('main')!
  const settle = async () => {
    await nextTick()
    await nextTick()
  }

  main.scrollTop = 640
  await router.push('/money?account=kaspi')
  await settle()
  expect(main.scrollTop).toBe(640)

  await router.push('/goals/g1')
  await settle()
  expect(main.textContent).toContain('Цель')
  expect(main.scrollTop).toBe(0)
  main.scrollTop = 120

  // Вложенный экран не корень: на место его возвращает только «назад».
  await router.push('/goals/g2')
  await settle()
  expect(main.scrollTop).toBe(0)
  router.back()
  await new Promise((r) => setTimeout(r, 0))
  await settle()
  expect(router.currentRoute.value.path).toBe('/goals/g1')
  expect(main.scrollTop).toBe(120)

  router.back()
  await new Promise((r) => setTimeout(r, 0))
  await settle()
  expect(router.currentRoute.value.path).toBe('/money')
  expect(main.scrollTop).toBe(640)

  // Вкладки: у каждой своё место.
  await router.push('/')
  await settle()
  expect(main.scrollTop).toBe(0)
  main.scrollTop = 900
  await router.push('/month')
  await settle()
  expect(main.scrollTop).toBe(0)
  main.scrollTop = 300
  await router.push('/')
  await settle()
  expect(main.scrollTop).toBe(900)
  await router.push('/month')
  await settle()
  expect(main.scrollTop).toBe(300)
  await router.push('/money')
  await settle()
  expect(main.scrollTop).toBe(640)
})

// ТЗ B2C-13 «Тесты»: «+» открывает лист на Sheet, Escape закрывает (критик Блока 3).
it('«+» открывает лист «Добавить» на Sheet, Escape закрывает', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AppShell, children: [{ path: '', component: page('Мечты') }] }],
  })
  await router.push('/')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(createPinia())
  app.use(router)
  app.mount(root)
  await nextTick()

  expect(document.querySelector('[role="dialog"]')).toBeNull()
  ;(document.querySelector('nav button[aria-label="Добавить"]') as HTMLButtonElement).click()
  await nextTick()
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog).not.toBeNull()
  expect(dialog!.textContent).toContain('Загрузить выписку')

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await nextTick()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

// Возврат смоука: шапка по макетам — у вложенного экрана «назад» и его действия справа (HeaderActions →
// #shell-actions), вкладок на экранах-потоках нет; у корня — без «назад», шестерёнка только на «Мечтах».
it('вложенный экран: «назад» к корню, карандаш экрана — в шапке, без вкладок; корень — без «назад», с вкладками', async () => {
  const goal = defineComponent({
    render: () =>
      h('div', [h(HeaderActions, null, () => h('button', { type: 'button', 'aria-label': 'Изменить цель' })), 'Экран цели']),
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', component: page('Мечты') },
          { path: 'week', component: page('Неделя') },
          { path: 'goals/:id', component: goal },
        ],
      },
    ],
  })
  await router.push('/goals/g1')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(createPinia())
  app.use(router)
  app.mount(root)
  await nextTick()
  await nextTick()

  const header = document.querySelector('header')!
  expect(header.querySelector('#shell-actions button[aria-label="Изменить цель"]')).not.toBeNull()
  expect(document.querySelector('main')!.querySelector('[aria-label="Изменить цель"]')).toBeNull()
  expect(header.querySelector('button[aria-label="Назад"]')).not.toBeNull()
  expect(header.querySelector('a[aria-label="Настройки"]')).toBeNull()
  expect(document.querySelector('nav')).toBeNull()

  ;(header.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click()
  await router.isReady()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
  expect(router.currentRoute.value.path).toBe('/')
  expect(document.querySelector('header button[aria-label="Назад"]')).toBeNull()
  expect(document.querySelector('[aria-label="Изменить цель"]')).toBeNull()
  expect(document.querySelector('header a[aria-label="Настройки"]')).not.toBeNull()
  expect(document.querySelector('nav')).not.toBeNull()

  await router.push('/week')
  await nextTick()
  // «Неделя» — корень без шестерёнки и аватаров (g2).
  expect(document.querySelector('header a[aria-label="Настройки"]')).toBeNull()
  expect(document.querySelector('header button[aria-label="Назад"]')).toBeNull()
})
