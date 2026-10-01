// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import PlanSquare from './PlanSquare.vue'

/**
 * B2C-43: переключатель «Сначала долги» в квадрате «План». Выключение — только через лист
 * подтверждения (`cancelPlan`); включение план не выбирает, а раскрывает «Копить или гасить?» —
 * план выбирается там кнопкой «Выбрать этот план».
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  // happy-dom без прокрутки: включение просит показать сравнение.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(withPlan: boolean) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc({ plans: withPlan ? [planOf()] : [] }), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/plan')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(PlanSquare)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  const toggle = () => document.querySelector<HTMLButtonElement>('[role="switch"]')!
  const button = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === t)
  const compare = () => [...document.querySelectorAll('details')].find((d) => d.querySelector('summary')?.textContent?.includes('Копить или гасить?'))!
  return { store, toggle, button, compare }
}

describe('B2C-43: переключатель «Сначала долги»', () => {
  it('выключение — лист подтверждения; «Оставить» — план на месте; «Отменить план» — cancelPlan, переключатель выключен', async () => {
    const { store, toggle, button } = await mount(true)
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    toggle().click()
    await nextTick()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Цели возобновятся, история плана останется.')
    expect(store.activePlan?.id).toBe('plan')
    button('Оставить')!.click()
    await nextTick()
    expect(store.activePlan?.id).toBe('plan')

    toggle().click()
    await nextTick()
    button('Отменить план')!.click()
    await nextTick()
    expect(store.activePlan).toBeNull()
    expect(store.plans[0].status).toBe('cancelled')
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  })

  it('включение — план не выбран, раскрыто «Копить или гасить?» с «Выбрать этот план»; выбор — план активен, остаёмся в квадрате', async () => {
    const { store, toggle, button, compare } = await mount(false)
    expect(compare().open).toBe(false)
    toggle().click()
    await nextTick()
    await nextTick()
    expect(store.activePlan).toBeNull()
    expect(compare().open).toBe(true)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    button('Выбрать этот план')!.click()
    await nextTick()
    expect(store.activePlan).not.toBeNull()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
  })
})
