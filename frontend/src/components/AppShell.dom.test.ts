// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, createWebHistory, RouterView } from 'vue-router'
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
  // Тесты входа оставляют токен и флаг ИИ — следующий тест начинает без них.
  localStorage.clear()
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

// Критик Б17: «назад» на медленных данных — экран сперва короткий (браузер обрезает scrollTop), высота приходит позже.
it('B2C-107: «назад» на экран, чьи данные пришли позже, — место дописывается, когда высоты хватает', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
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

  // happy-dom не верстает: высоту и обрезку scrollTop, как в браузере, задаём сами.
  const main = document.querySelector('main')!
  let height = 3000
  let top = 0
  Object.defineProperty(main, 'clientHeight', { configurable: true, get: () => 800 })
  Object.defineProperty(main, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(main, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (y: number) => (top = Math.max(0, Math.min(y, height - 800))),
  })

  main.scrollTop = 640
  await router.push('/goals/g1')
  await nextTick()
  expect(main.scrollTop).toBe(0)

  height = 800 // данные «Денег» ещё не пришли — экран в один экран
  router.back()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
  expect(router.currentRoute.value.path).toBe('/money')
  expect(main.scrollTop).toBe(0)

  height = 3000 // пришли
  await new Promise((r) => setTimeout(r, 100))
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
  const dialog = () => document.querySelector('[role="dialog"]')
  expect(dialog()).not.toBeNull()
  // FG-23: плитки «Доход» / «Расход»; «Расход» — вторая страница того же листа, «‹ Добавить» возвращает.
  expect(dialog()!.textContent).toContain('Доход')
  ;(document.querySelector('[data-add-expense]') as HTMLButtonElement).click()
  await nextTick()
  expect(dialog()!.textContent).toContain('‹ Добавить')
  expect(dialog()!.textContent).toContain('Выписка')
  expect(document.querySelector('[data-add-income]')).toBeNull()
  ;(document.querySelector('[data-add-back]') as HTMLButtonElement).click()
  await nextTick()
  expect(document.querySelector('[data-add-income]')).not.toBeNull()

  // Закрыли на «Расходе» — открыли снова: «Добавить».
  ;(document.querySelector('[data-add-expense]') as HTMLButtonElement).click()
  await nextTick()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await nextTick()
  expect(dialog()).toBeNull()
  ;(document.querySelector('nav button[aria-label="Добавить"]') as HTMLButtonElement).click()
  await nextTick()
  expect(document.querySelector('[data-add-income]')).not.toBeNull()
  expect(document.querySelector('[data-add-back]')).toBeNull()
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

// Хвост §4 `/ux` Блока 1 «ИИ» (AI-09): `/privacy` — вне оболочки, оболочка размонтируется; «назад» — то же место.
it('AI-09: «Месяц» → «/privacy» (вне оболочки) → назад — место «Месяца» на месте', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: AppShell, children: [{ path: 'month', component: page('Месяц') }, { path: 'goals/:id', component: page('Цель') }] },
      { path: '/privacy', component: page('Политика') },
    ],
  })
  await router.push('/month')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(createPinia())
  app.use(router)
  app.mount(root)
  await nextTick()
  document.querySelector('main')!.scrollTop = 490

  await router.push('/privacy')
  await nextTick()
  expect(document.querySelector('main')).toBeNull()
  expect(document.body.textContent).toContain('Политика')

  router.back()
  await vi.waitFor(() => expect(document.querySelector('main')?.textContent).toContain('Месяц'))
  await nextTick()
  expect(document.querySelector('main')!.scrollTop).toBe(490)

  // Вперёд с вернувшейся оболочки — по-прежнему сверху.
  await router.push('/goals/g1')
  await nextTick()
  await nextTick()
  expect(document.querySelector('main')!.scrollTop).toBe(0)
})

// Хвост §4 критика Блока 1 «ИИ» (AI-09): оболочка освежает `/auth/me` при старте — один раз на вход.
it('AI-09: оболочка зовёт /auth/me при монтировании один раз на вход; флаг ИИ — из ответа', async () => {
  const { apiClient } = await import('@/api/client')
  const { useAuthStore } = await import('@/stores/auth')
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData({
    token: 'tok-ai-09',
    user: { id: 'u-a', email: 'a@example.com', created_at: '2026-10-01T00:00:00Z' },
    household: { id: 'h-1', name: 'Семья', created_by: 'u-a', created_at: '2026-10-01T00:00:00Z' },
    member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '2026-10-01T00:00:00Z' },
  })
  const me = vi.spyOn(apiClient, 'me').mockResolvedValue({ user: auth.user!, household: auth.household, member: auth.member, ai: true })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AppShell, children: [{ path: 'month', component: page('Месяц') }] }, { path: '/privacy', component: page('Политика') }],
  })
  await router.push('/month')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await vi.waitFor(() => expect(auth.ai).toBe(true))
  expect(me).toHaveBeenCalledTimes(1)

  // «Политика» и назад — оболочка смонтирована заново, но вход тот же: второго запроса нет.
  await router.push('/privacy')
  router.back()
  await vi.waitFor(() => expect(document.querySelector('main')).not.toBeNull())
  expect(me).toHaveBeenCalledTimes(1)
  me.mockRestore()
})

// Критик Блока 2 «ИИ»: память места живёт у роутера — выход и вход другим человеком без перезагрузки
// (`Root.vue`: оболочка по `isAuthenticated`) не возвращает ему места прежнего входа.
it('выход и вход другим человеком — «Месяц» сверху, а не на месте прежнего входа', async () => {
  const { apiClient } = await import('@/api/client')
  const { useAuthStore } = await import('@/stores/auth')
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  const login = (token: string) =>
    auth.setAuthData({
      token,
      user: { id: token, email: `${token}@example.com`, created_at: '2026-10-01T00:00:00Z' },
      household: { id: 'h-1', name: 'Семья', created_by: token, created_at: '2026-10-01T00:00:00Z' },
      member: { household_id: 'h-1', user_id: token, slot: 'a', display_name: 'a', role: 'member', joined_at: '2026-10-01T00:00:00Z' },
    })
  login('tok-first')
  const me = vi.spyOn(apiClient, 'me').mockImplementation(async () => ({ user: auth.user!, household: auth.household, member: auth.member }))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AppShell, children: [{ path: 'month', component: page('Месяц') }] }, { path: '/access', component: page('Вход') }],
  })
  try {
    await router.push('/month')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(RouterView) })
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    document.querySelector('main')!.scrollTop = 640

    // Выход — на «Вход» (вне оболочки), вход другим — снова «Месяц».
    await router.push('/access')
    auth.clearAuth()
    login('tok-second')
    await router.push('/month')
    await vi.waitFor(() => expect(document.querySelector('main')?.textContent).toContain('Месяц'))
    await nextTick()
    expect(document.querySelector('main')!.scrollTop).toBe(0)
  } finally {
    me.mockRestore()
  }
})

/*
 * FB-22: «Назад» по настоящей истории браузера (`history.state.back` пишет только web-история). Холодно открытые
 * «Цифры» или «Свой кружок» (новая вкладка, PWA на последнем адресе) уходят к «Настройкам» без круга.
 */
async function shellAt(start: string) {
  window.history.replaceState(null, '', start)
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [
          { path: '', component: page('Мечты') },
          { path: 'settings', component: page('Настройки') },
          { path: 'settings/me', component: page('Свой кружок') },
          { path: 'admin', component: page('Цифры') },
        ],
      },
    ],
  })
  await router.push(start)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(createPinia())
  app.use(router)
  app.mount(root)
  await nextTick()
  return router
}

/** Нажимает «Назад» шапки, пока он есть (не больше `max` раз), и возвращает пройденные адреса. */
async function backTrail(router: ReturnType<typeof createRouter>, max = 5) {
  const trail = [router.currentRoute.value.path]
  for (let i = 0; i < max; i++) {
    const back = document.querySelector('header button[aria-label="Назад"]') as HTMLButtonElement | null
    if (!back) break
    const was = router.currentRoute.value.fullPath
    back.click()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).not.toBe(was))
    await nextTick()
    trail.push(router.currentRoute.value.path)
  }
  return trail
}

it('FB-22: «Цифры» холодно → «Назад» → «Настройки» → «Назад» → «Мечты», а не снова «Цифры»', async () => {
  const router = await shellAt('/admin')
  expect(await backTrail(router)).toEqual(['/admin', '/settings', '/'])
})

it('FB-22: «Свой кружок» холодно → «Назад» → «Настройки» → «Назад» → «Мечты»', async () => {
  const router = await shellAt('/settings/me')
  expect(await backTrail(router)).toEqual(['/settings/me', '/settings', '/'])
})

it('FB-22: обычный путь «Мечты → Настройки → Цифры» — «Назад» по истории, как был', async () => {
  const router = await shellAt('/')
  await router.push('/settings')
  await router.push('/admin')
  await nextTick()
  expect(await backTrail(router)).toEqual(['/admin', '/settings', '/'])
  // По истории, а не заменой: вперёд браузера снова «Настройки».
  expect(window.history.state?.forward).toBe('/settings')
})
