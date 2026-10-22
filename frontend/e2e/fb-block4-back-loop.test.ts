// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createWebHistory, RouterView, type Router } from 'vue-router'
import { createAppRouter } from '../src/router'
import { startDemo } from '../src/lib/demo'

/**
 * FB-22 (часть 4в Блока 4 «Фидбек»): шаги владельца со стенда — «Цифры» или «Свой кружок» открыты холодно (новая
 * вкладка, PWA на последнем адресе, ввод адреса) → «Назад» гонял «Настройки» ↔ экран по кругу до перезагрузки.
 * Настоящий роутер приложения на web-истории (только она пишет `history.state.back`), демо-семья, сети нет.
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

/** Новый документ на адресе `start`: история браузера без `back`, как после ввода адреса или холодного запуска. */
async function openCold(start: string) {
  setActivePinia(createPinia())
  startDemo()
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

/** «Назад» шапки, пока он есть (до 6 раз): пройденные экраны. */
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

describe('e2e / FB-22 — «Назад» без круга', () => {
  it('«Цифры» в новой вкладке: «Назад» → «Настройки» → «Назад» → «Мечты»; на «Мечтах» «Назад» нет', async () => {
    const router = await openCold('/admin')
    expect(document.querySelector('header')!.textContent).toContain('Цифры')
    expect(await pressBack(router)).toEqual(['/admin', '/settings', '/'])
    expect(backButton()).toBeNull()
    expect(document.querySelector('header')!.textContent).toContain('Мечты')
  })

  it('«Свой кружок» в новой вкладке: «Назад» → «Настройки» → «Назад» → «Мечты»', async () => {
    const router = await openCold('/settings/me')
    expect(await pressBack(router)).toEqual(['/settings/me', '/settings', '/'])
  })

  it.each(['/goals/new', '/goals/nope', '/wishes', '/people/a', '/money/debts/faster'])(
    'остальные вложенные экраны в новой вкладке: %s → «Назад» → «Мечты», записей не прибавилось',
    async (start) => {
      const router = await openCold(start)
      const length = window.history.length
      expect(await pressBack(router)).toEqual([start, '/'])
      expect(window.history.length).toBe(length)
    },
  )

  it('история, испорченная прежним «Назад» («Настройки» с `back` на «Цифры»), выходит на «Мечты»', async () => {
    const router = await openCold('/admin')
    await router.push('/settings')
    await nextTick()
    expect(window.history.state?.back).toBe('/admin')
    expect(await pressBack(router)).toEqual(['/settings', '/admin', '/settings', '/'])
  })

  it('обычный путь «Мечты» → шестерёнка → «Свой кружок»: «Назад» по истории, как был', async () => {
    const router = await openCold('/')
    ;(document.querySelector('header a[aria-label="Настройки"]') as HTMLAnchorElement).click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings'))
    await nextTick()
    ;(document.querySelector('a[href="/settings/me"]') as HTMLAnchorElement).click()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings/me'))
    await nextTick()
    expect(await pressBack(router)).toEqual(['/settings/me', '/settings', '/'])
    // Шли по истории: «вперёд» у «Мечт» — «Настройки».
    expect(window.history.state?.forward).toBe('/settings')
  })
})
