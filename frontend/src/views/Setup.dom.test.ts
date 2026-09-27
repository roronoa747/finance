// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import Setup from './Setup.vue'

/**
 * Мастер пишет ответы при переходе на шаг кода: там человек уходит отправлять код, iOS может
 * перезагрузить вкладку — раньше всё введённое пропадало и мастер начинался заново.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  // Запись планирует синк — сети в тесте нет, запрос просто не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function openSetup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/setup')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Setup)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return { store, router }
}

const title = () => document.querySelector('h1')!.textContent!.trim()
const input = (label: string) =>
  [...document.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent!.trim() === text)

async function type(label: string, value: string) {
  const el = input(label)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function click(text: string) {
  button(text)!.click()
  await nextTick()
}

describe('мастер: ответы записаны до шага кода', () => {
  it('на шаге «Пригласите партнёра» доход и жильё уже в документе, назад нельзя, «Перейти к бюджету» не задваивает', async () => {
    const { store, router } = await openSetup()
    await type('Зарплата в месяц', '500 000')
    await click('Дальше')
    await type('Платёж в месяц', '200 000')
    await click('Дальше')
    await click('Кредитов нет')
    expect(store.setupDone).toBe(false)
    await click('Пока без цели')

    expect(title()).toBe('Пригласите партнёра')
    expect(store.setupDone).toBe(true)
    expect(store.people.find((p) => p.id === 'a')?.salary).toBe(500_000)
    const rent = store.obligations.filter((o) => !o.deletedAt)
    expect(rent.length).toBeGreaterThan(0)
    expect(document.querySelector('[aria-label="Назад"]')).toBeNull()

    await click('Перейти к бюджету')
    await router.isReady()
    expect(store.obligations.filter((o) => !o.deletedAt)).toHaveLength(rent.length)
    expect(store.people.filter((p) => p.id === 'a')).toHaveLength(1)
  })

  it('до шага кода ничего не пишется — «Назад» и правка доступны', async () => {
    const { store } = await openSetup()
    await type('Зарплата в месяц', '500 000')
    await click('Дальше')
    expect(store.setupDone).toBe(false)
    expect(store.people.find((p) => p.id === 'a')).toBeUndefined()
    expect(document.querySelector('[aria-label="Назад"]')).not.toBeNull()
  })
})
