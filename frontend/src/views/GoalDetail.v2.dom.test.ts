// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Цель v2 (пачка 2 «Figma», 78:50, FG-24): «Пополнить» на обложке у срока, «В месяц | Осталось» ячейками; «В месяц» открывает
 * лист «Взнос в месяц» — поле пишет взнос, «Снять» открывает «Снять средства»; viewer — ячейка не кнопка, «Пополнить» нет.
 */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
})

async function open(role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, role === 'viewer' ? 'b' : 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc(), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/goals/trip')
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

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const tick = async () => {
  for (let i = 0; i < 3; i++) await nextTick()
}

describe('FG-24: экран цели v2', () => {
  it('обложка: срок и «Пополнить» в нижней строке; ячейки «В месяц» и «Осталось»; «Подробнее» нет', async () => {
    const finance = await open()
    const trip = finance.goals.find((g) => g.id === 'trip')!
    const cover = q('[data-goal-cover]')!
    expect(cover.querySelector('[data-goal-term]')!.textContent).toMatch(/^к [а-я]+ \d{4}/)
    expect(cover.querySelector('[data-goal-deposit]')!.textContent!.trim()).toBe('Пополнить')
    expect(q('[data-goal-monthly-value]')!.textContent!.replace(/\s/g, ' ')).toBe(money(trip.monthly).replace(/\s/g, ' '))
    expect(q('[data-goal-left]')!.textContent).toContain('Осталось')
    expect(q('details')).toBeNull()
    expect(document.body.textContent).not.toContain('Ритм цели')
  })

  it('«В месяц» → лист: поле пишет взнос (`setGoalMonthly`), «Осталось N взносов» подписью', async () => {
    const finance = await open()
    const set = vi.spyOn(finance, 'setGoalMonthly')
    ;(q('[data-goal-monthly]') as HTMLButtonElement).click()
    await tick()
    expect(q('[role="dialog"]')!.textContent).toContain('Взнос в месяц')
    expect(q('[data-goal-left-line]')!.textContent).toMatch(/^Осталось \d+ взнос/)
    const input = q<HTMLInputElement>('[role="dialog"] input')!
    input.focus()
    input.value = '73 000'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new Event('blur'))
    await tick()
    expect(set).toHaveBeenCalledWith('trip', 73_000)
    expect(finance.goals.find((g) => g.id === 'trip')!.monthly).toBe(73_000)
  })

  it('«Снять» из листа взноса — лист «Снять средства»', async () => {
    await open()
    ;(q('[data-goal-monthly]') as HTMLButtonElement).click()
    await tick()
    ;(q('[data-goal-withdraw]') as HTMLButtonElement).click()
    await tick()
    const titles = [...document.querySelectorAll('[role="dialog"] h3')].map((h) => h.textContent)
    expect(titles).toContain('Снять средства')
    expect(titles).not.toContain('Взнос в месяц')
  })

  it('viewer: «Пополнить» нет, ячейка «В месяц» — не кнопка, лист не открывается', async () => {
    await open('viewer')
    expect(q('[data-goal-deposit]')).toBeNull()
    const cell = q('[data-goal-monthly]')!
    expect(cell.tagName).toBe('DIV')
    cell.click()
    await tick()
    expect(q('[role="dialog"]')).toBeNull()
  })
})
