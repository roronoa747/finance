// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '../src/stores/finance'
import { startDemo } from '../src/lib/demo'
import AccountSheet from '../src/components/capital/AccountSheet.vue'
import { at } from './support/family'

/**
 * Блок 5а «понятность» (PN-35), 12 октября 2026: лист счёта демо открыт на телефоне, сумма Kaspi Gold исправлена в поле
 * (`NumFieldBlur` пишет по уходу из поля) и лист стянут вниз, не уводя фокус, — правка записана в документ, лист закрыт.
 * Стянули чуть-чуть — лист на месте, поле в фокусе, ничего не записано. Настоящие touch-жесты на 390 px — стенд Playwright
 * (Handoff блока); здесь — тот же поток касаний в DOM.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  at('2026-10-12T07:00:00Z')
  // Телефон: окно `sm:` (≥ 640 px) не тянется.
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q }) as MediaQueryList)
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function kaspiSheet() {
  const pinia = createPinia()
  setActivePinia(pinia)
  startDemo()
  await nextTick()
  const finance = useFinanceStore()
  const open = ref<string | null>('acc-kaspi')
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(AccountSheet, { accountId: open.value, onClose: () => (open.value = null) }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  await nextTick()
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  Object.defineProperty(dialog, 'offsetHeight', { value: 640, configurable: true })
  // Сумма счёта — единственное числовое поле листа Kaspi Gold.
  const field = dialog.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!
  const kaspi = () => finance.accounts.find((a) => a.id === 'acc-kaspi')!
  const was = kaspi().amount
  expect(field.value.replace(/\D/g, '')).toBe(String(was))
  return { kaspi, was, open, dialog, field }
}

function touch(el: HTMLElement, type: string, y: number) {
  const t = new Touch({ identifier: 1, target: el, clientX: 200, clientY: y })
  const end = type === 'touchend'
  el.dispatchEvent(new TouchEvent(type, { touches: end ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }))
}

/** Палец на поле суммы, медленно вниз на `dy` за 400 мс, отпустил; лист доезжает. */
async function pullDown(el: HTMLElement, dy: number) {
  touch(el, 'touchstart', 300)
  for (let k = 1; k <= 4; k++) {
    vi.advanceTimersByTime(100)
    touch(el, 'touchmove', 300 + (dy * k) / 4)
  }
  touch(el, 'touchend', 300 + dy)
  vi.advanceTimersByTime(200)
  await nextTick()
}

function type(field: HTMLInputElement, value: string) {
  field.focus()
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('e2e / понятность Блок 5а — лист стянут вниз', () => {
  it('сумма Kaspi Gold исправлена и лист стянут — правка записана, лист закрыт', async () => {
    const { kaspi, was, open, field } = await kaspiSheet()
    type(field, String(was + 35_000))
    expect(document.activeElement).toBe(field)
    await pullDown(field, 260)

    expect(open.value).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(kaspi().amount).toBe(was + 35_000)
  })

  it('недотянул — лист на месте, поле в фокусе, ничего не записано', async () => {
    const { kaspi, was, open, dialog, field } = await kaspiSheet()
    type(field, String(was + 35_000))
    await pullDown(field, 60)

    expect(open.value).toBe('acc-kaspi')
    expect(dialog.isConnected).toBe(true)
    expect(document.activeElement).toBe(field)
    expect(kaspi().amount).toBe(was)
  })
})
