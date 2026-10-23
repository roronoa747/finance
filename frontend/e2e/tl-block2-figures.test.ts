// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createWebHistory, RouterView } from 'vue-router'
import { createAppRouter } from '../src/router'
import { startDemo } from '../src/lib/demo'
import { useOperationsStore } from '../src/stores/operations'

/**
 * Блок 2 «Хвосты» (TL-04…TL-06; Р-7…Р-9): цифры экранов сходятся со строками. Демо-семья, настоящий роутер на
 * web-истории, сети нет.
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

async function openDemo(path: string) {
  setActivePinia(createPinia())
  startDemo()
  window.history.replaceState(null, '', path)
  const router = createAppRouter(createWebHistory())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(router)
  await router.isReady()
  app.mount(root)
  await flush()
  return router
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** Целые тенге из «12 400 ₸» / «12 400». */
const tenge = (el: Element | null) => Number(txt(el).replace(/[^\d]/g, ''))
const press = async (el: HTMLElement | null) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  el!.click()
  await flush()
}

describe('e2e / Хвосты Блок 2 — цифры сходятся', () => {
  it('TL-04: демо → «Неделя» → «Подписки»: крупная сумма листа равна сумме строк, отмеченной подписки в списке нет', async () => {
    await openDemo('/week')
    // Демо: «Яндекс Плюс» 4 990 сегодня ждёт «это платёж по Яндекс Плюс?» — отмечена, на «Неделе» её нет. Вторая
    // подписка того же продавца 1 990 — вне допуска платежа, трата (сценарий Х-5: крупно 1 990, в списке было 4 990 + 1 990).
    const today = new Date().toISOString().slice(0, 10)
    useOperationsStore().seedDemoOperations([{ id: 'demo-op-tl04', bank: 'kaspi', date: today, amount: -1_990, kind: 'purchase', merchant: 'Яндекс Плюс', categoryId: 'sc_subscriptions', internal: false }])
    await flush()
    await press(q('[data-row="sc_subscriptions"] button.row-open'))
    const sheet = q('[role="dialog"]')!
    expect(tenge(sheet.querySelector('[data-section-total]'))).toBe(1_990)
    expect(all('[role="dialog"] [data-section-op]').map((el) => el.dataset.sectionOp)).toEqual(['demo-op-tl04'])
    const rows = all('[role="dialog"] [data-section-ops] button b').reduce((s, el) => s + tenge(el), 0)
    expect(rows).toBe(1_990)
  })
})
