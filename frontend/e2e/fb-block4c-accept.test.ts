// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createWebHistory, RouterView, type Router } from 'vue-router'
import { createAppRouter } from '../src/router'
import { startDemo } from '../src/lib/demo'
import { useAuthStore } from '../src/stores/auth'

/**
 * Приёмка FB-22 (часть 4в Блока 4 «Фидбек»): обычный путь владельца-админа «Мечты» → шестерёнка → «Настройки» →
 * ссылка «Цифры» (видна только `authStore.admin`) → «Назад» → «Назад» идёт по истории, как до починки, и кончается на
 * «Мечтах». На стенде (Go с `ADMIN_EMAILS`, Chrome 390) — тот же путь касаниями; здесь — настоящий роутер на
 * web-истории, демо-семья, сети нет.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function openAsAdmin(start: string) {
  setActivePinia(createPinia())
  startDemo()
  useAuthStore().admin = true
  window.history.replaceState(null, '', start)
  const router = createAppRouter(createWebHistory())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  await router.isReady()
  app.mount(root)
  await nextTick()
  return router
}

const backButton = () => document.querySelector('header button[aria-label="Назад"]') as HTMLButtonElement | null

async function tapLink(router: Router, selector: string, to: string) {
  ;(document.querySelector(selector) as HTMLAnchorElement).click()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(to))
  await nextTick()
}

async function pressBack(router: Router) {
  const trail = [router.currentRoute.value.path]
  for (let i = 0; i < 6 && backButton(); i++) {
    const was = router.currentRoute.value.fullPath
    backButton()!.click()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).not.toBe(was))
    await nextTick()
    trail.push(router.currentRoute.value.path)
  }
  return trail
}

describe('e2e / приёмка FB-22 — «Цифры» ссылкой из «Настроек»', () => {
  it('админ: «Мечты» → «Настройки» → «Цифры» → «Назад» × 2 → «Мечты» по истории, записей не прибавилось', async () => {
    const router = await openAsAdmin('/')
    await tapLink(router, 'header a[aria-label="Настройки"]', '/settings')
    await tapLink(router, 'a[href="/admin"]', '/admin')
    expect(document.querySelector('header')!.textContent).toContain('Цифры')
    const length = window.history.length
    expect(await pressBack(router)).toEqual(['/admin', '/settings', '/'])
    expect(backButton()).toBeNull()
    expect(window.history.length).toBe(length)
    // Шли назад по истории, а не к корню `replace`-ом: «вперёд» у «Мечт» — «Настройки».
    expect(window.history.state?.forward).toBe('/settings')
  })

  it('не админ: ссылки «Цифры» в «Настройках» нет', async () => {
    const router = await openAsAdmin('/')
    useAuthStore().admin = false
    await tapLink(router, 'header a[aria-label="Настройки"]', '/settings')
    expect(document.querySelector('a[href="/admin"]')).toBeNull()
  })
})
