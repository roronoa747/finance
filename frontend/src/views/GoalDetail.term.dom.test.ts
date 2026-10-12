// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Хотфикс 2026-10-12 (владелец: «мечту редактируют — ничего не меняется»): «Сколько нужно» в листе правки — срок прежний,
 * взнос пересчитан; после закрытия листа тост «Взнос N в месяц — срок прежний» · «Оставить взнос» — вернуть взнос до листа
 * (тогда сдвигается срок).
 */
let app: App | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T08:00:00Z'))
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function open() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc(), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/goals/car')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GoalDetail)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const button = (text: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => norm(b.textContent) === text)
const field = (label: string) =>
  [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!
async function settle() {
  for (let i = 0; i < 4; i++) await nextTick()
}

describe('хотфикс 2026-10-12: правка суммы мечты — срок прежний, «Оставить взнос»', () => {
  it('сумма 3 000 000 → 1 300 000 и обратно в листе: тост только после закрытия; «Оставить взнос» — взнос до листа', async () => {
    const finance = await open()
    const car = () => finance.goals.find((g) => g.id === 'car')!
    q('[aria-label="Меню цели"]')!.click()
    await settle()
    button('Изменить цель')!.click()
    await settle()
    const need = field('Сколько нужно')
    for (const v of ['1 300 000', '2 000 000']) {
      need.focus()
      need.value = v
      need.dispatchEvent(new Event('input', { bubbles: true }))
      need.dispatchEvent(new Event('blur'))
      need.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await settle()
    }
    // 2 800 000 по 60 000 — 47 взносов; 1 800 000 на те же 47 — 38 298.
    expect(car()).toMatchObject({ need: 2_000_000, monthly: 38_298 })
    expect(q('[data-term]')).toBeNull()

    button('Готово')!.click()
    await settle()
    expect(norm(q('[data-term]')?.textContent)).toBe('Взнос 38 298 ₸ в месяц — срок прежний')

    q('[data-toast-action]')!.click()
    await settle()
    expect(car()).toMatchObject({ need: 2_000_000, monthly: 60_000 })
    expect(q('[data-term]')).toBeNull()
  })

  it('правили только название — тоста нет, взнос прежний', async () => {
    const finance = await open()
    q('[aria-label="Меню цели"]')!.click()
    await settle()
    button('Изменить цель')!.click()
    await settle()
    const name = field('Название')
    name.value = 'Машина мечты'
    name.dispatchEvent(new Event('blur'))
    await settle()
    button('Готово')!.click()
    await settle()
    expect(finance.goals.find((g) => g.id === 'car')).toMatchObject({ name: 'Машина мечты', monthly: 60_000 })
    expect(q('[data-term]')).toBeNull()
  })
})
