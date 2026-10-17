// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import Wishes from './Wishes.vue'

/**
 * AI-15 (бэклог «ИИ»; «Из скриншота» отменено владельцем 2026-10-18 — осталось «+» → форма сразу): адрес `/wishes?new=1`
 * открывает лист «Новое желание», закрытие снимает параметр — тот же «+» снова откроет лист.
 */
let app: App | null = null
let router: Router

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

async function open(path: string, role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc({ wishlist: [] }), 1)
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Wishes)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  for (let i = 0; i < 6; i++) await nextTick()
  return finance
}

const dialog = () => document.querySelector('[role="dialog"]')
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 6; i++) await nextTick()
}

describe('AI-15: «+» → «Новое желание» сразу', () => {
  it('/wishes?new=1 открывает лист; закрытие убирает параметр', async () => {
    await open('/wishes?new=1')
    expect(dialog()?.textContent).toContain('Новое желание')
    ;(document.querySelector('[role="dialog"] [aria-label="Закрыть"]') as HTMLButtonElement).click()
    await flush()
    expect(router.currentRoute.value.query.new).toBeUndefined()
    expect(dialog()).toBeNull()
  })

  it('«Добавить в список» пишет желание и снимает параметр', async () => {
    const finance = await open('/wishes?new=1')
    const name = document.querySelector('input[placeholder="Например, сковорода"]') as HTMLInputElement
    name.value = 'Плед'
    name.dispatchEvent(new Event('input'))
    await nextTick()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Добавить в список'))!.click()
    await flush()
    expect(finance.wishlist.map((w) => w.name)).toEqual(['Плед'])
    expect(router.currentRoute.value.query.new).toBeUndefined()
    expect(dialog()).toBeNull()
  })

  it('/wishes без параметра — лист закрыт; viewer по адресу листа не видит', async () => {
    await open('/wishes')
    expect(dialog()).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    await open('/wishes?new=1', 'viewer')
    expect(dialog()).toBeNull()
  })
})
