// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { renderScreen } from '@/test/screenState'
import Access from './Access.vue'
import Money from './Money.vue'

/**
 * Демо (пивот 3, B2C-45): «Попробовать» — и «Деньги» показывают все три квадрата с данными: счета с
 * вкладом, план «Сначала долги» с шагом, «История» со своими операциями и отметками. Без запросов к `/api`.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('демо не ходит в сеть'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')

describe('B2C-45: демо — «Деньги» с данными во всех трёх квадратах', () => {
  // 1 октября — худший случай: месяц только начался, операции демо всё равно в нём.
  it('«Попробовать» → Капитал (вклад 14 %, платежи), План (включён, шаг), История (операции и отметки) — без /api', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/access')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Access)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('демо'))!.click()
    await nextTick()
    await nextTick()

    const capital = text(await renderScreen(Money, '/money'))
    expect(capital).toContain('Депозит Kaspi 14 % · общий')
    expect(capital).toContain('Аренда квартиры 5-го · оплачено')
    expect(capital).toContain('Автокредит')

    const plan = await renderScreen(Money, '/money/plan')
    expect(plan).toMatch(/role="switch" aria-checked="true"/)
    expect(text(plan)).toContain('Цели на паузе Машина')

    const history = text(await renderScreen(Money, '/money/history'))
    expect(history).not.toContain('Пока пусто')
    expect(history).toContain('Magnum')
    expect(history).toContain('между своими · не трата')
    expect(history).toContain('Аренда квартиры оплачено · Аруна')
    expect(history).toMatch(/Всё Операции Отметки Продукты/)

    expect(fetch).not.toHaveBeenCalled()
  })
})
