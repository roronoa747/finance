// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { Goal, SyncDoc } from '@/types/finance'
import { money } from '@/lib/money'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/** Подушка (понятность Р-12): экран фонда «Подушка» — PN-19 (тост «уже есть»), PN-20 (нужно · есть · хватит на N). */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const pot = (p: Partial<Goal> = {}): Goal => ({
  id: 'pot', name: 'Подушка', need: 0, seed: 0, have: 0, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], template: 'cushion', fund: 'cushion', updatedAt: T0, ...p,
})

async function open(path: string, goals: Goal[] = [pot()], extra: Partial<SyncDoc> = {}, role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc({ goals, goalOrder: null, ...extra }), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GoalDetail)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  for (let i = 0; i < 3; i++) await nextTick()
  return finance
}

const page = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const norm = (s: string) => s.replace(/\s+/g, ' ')

describe('PN-19: «Новая мечта → Подушка», а подушка уже есть', () => {
  it('`?fund=exists` — тост «Подушка уже есть»; без адреса — тоста нет', async () => {
    await open('/goals/pot?fund=exists')
    expect(document.querySelector('[data-closer]')?.textContent).toBe('Подушка уже есть')
    app?.unmount()
    document.body.innerHTML = ''
    await open('/goals/pot')
    expect(document.querySelector('[data-closer]')).toBeNull()
    expect(page()).not.toContain('Подушка уже есть')
  })
})

describe('PN-20: экран подушки — нужно · есть · хватит на N месяцев', () => {
  const card = () => document.querySelector('[data-cushion-cover]')
  const spendOf = (finance: ReturnType<typeof useFinanceStore>) => {
    const plan = finance.monthPlanOf('2026-09')
    return plan.duesTotal + plan.spendTotal
  }

  it('частично: «Хватит на 1,2 месяца», строка «нужно на 3 месяца», сумма — в герое; «Соберём в …» — только в «Подробнее»', async () => {
    let finance = await open('/goals/pot')
    const spend = spendOf(finance)
    expect(spend).toBeGreaterThan(0)
    // 1,2 месяца трат: have = 1,2 × месяц трат плана (целое).
    const have = Math.round(spend * 1.2)
    app?.unmount()
    document.body.innerHTML = ''
    finance = await open('/goals/pot', [pot({ have, seed: have })])
    const item = finance.monthPlanOf('2026-09').queue.find((q) => q.goalId === 'pot')!
    expect(item.need).toBe(3 * spend)
    expect(card()?.textContent).toBe('Хватит на 1,2 месяца')
    expect(card()?.className).not.toContain('text-ok')
    // Сумма «нужно» — одна, в герое (/ux Б6: не дублировать в карточке).
    expect(norm(document.querySelector('[data-cushion-need]')!.textContent!)).toBe('нужно на 3 месяца')
    // Герой — «есть из нужно», как у всех.
    expect(page()).toContain(norm(`из ${money(item.need)}`))
    const card0 = card()!.closest('div')!.textContent!
    expect(card0).not.toContain('Соберём')
    // «Чтобы успеть за год» и «дорожает» у фонда нет.
    expect(page()).not.toContain('Чтобы успеть за год')
    expect(page()).not.toContain('дорожает')
    // FG-24: «Соберём в … · осталось N взносов», поле порога и подсказка формулы — в листе «Взнос в месяц» (ячейка «В месяц»).
    ;(document.querySelector('[data-goal-monthly]') as HTMLElement).click()
    await nextTick()
    expect(document.querySelector('[data-goal-left-line]')?.textContent ?? '').toMatch(/^Соберём в .+ · осталось \d+ взнос/)
    expect(document.querySelector('input[aria-label="Порог фонда — месяцев трат"]')).not.toBeNull()
    expect(document.querySelector('[aria-label="Как считается «нужно»"]')).not.toBeNull()
    // `/ux`: месяцы — не деньги: у поля порога знака «₸» нет (у поля взноса — есть).
    const months = document.querySelector('input[aria-label="Порог фонда — месяцев трат"]')!
    expect(months.parentElement?.querySelector('[data-num-suffix]') ?? null).toBeNull()
    expect(document.querySelector('input[aria-label="Откладывать в месяц"]')!.parentElement?.querySelector('[data-num-suffix]')?.textContent).toBe('₸')
  })

  it('пусто — «Хватит на 0 месяцев»; собрано — «✓» цветом «готово», «Собрано» в карточке нет', async () => {
    let finance = await open('/goals/pot')
    expect(card()?.textContent).toBe('Хватит на 0 месяцев')
    const need = 3 * spendOf(finance)
    app?.unmount()
    document.body.innerHTML = ''
    finance = await open('/goals/pot', [pot({ have: need + 10_000, seed: need + 10_000 })])
    expect(card()?.textContent).toMatch(/^Хватит на 3(,\d)? месяца ✓$/)
    expect(card()?.className).toContain('text-ok')
    expect(card()!.parentElement!.textContent).not.toContain('Собрано')
  })

  it('без платежей и трат плана — «Пока не на что считать»', async () => {
    const finance = await open('/goals/pot', [pot({ have: 100_000, seed: 100_000 })], { obligations: [], credits: [], spendPlans: [], spendTotals: [] })
    expect(spendOf(finance)).toBe(0)
    expect(card()?.textContent).toBe('Пока не на что считать')
  })

  it('свой порог 2 месяца — «нужно на 2 месяца»', async () => {
    const finance = await open('/goals/pot', [pot({ fundMonths: 2 })])
    expect(norm(document.querySelector('[data-cushion-need]')!.textContent!)).toBe('нужно на 2 месяца')
    expect(page()).toContain(norm(`из ${money(2 * spendOf(finance))}`))
  })

  it('viewer видит то же, без поля порога', async () => {
    await open('/goals/pot', [pot()], {}, 'viewer')
    expect(card()?.textContent).toBe('Хватит на 0 месяцев')
    expect(document.querySelector('[data-cushion-need]')).not.toBeNull()
    expect(document.querySelector('input[aria-label="Порог фонда — месяцев трат"]')).toBeNull()
  })

  it('«Запас» — прежний вид («Соберём в …»), мечта — без «хватит»', async () => {
    const res: Goal = { ...pot({ id: 'res', name: 'Запас', fund: 'reserve', template: 'cushion-3' }) }
    await open('/goals/res', [res])
    expect(card()).toBeNull()
    expect(page()).toMatch(/к [а-я]+ \d{4}|срока пока нет|взнос не задан/)
    app?.unmount()
    document.body.innerHTML = ''
    await open('/goals/trip', [pot(), { ...pot({ id: 'trip', name: 'Отпуск', need: 500_000, fund: null, template: null }) }])
    expect(card()).toBeNull()
    expect(page()).not.toContain('Хватит на')
  })

  it('старая мечта с картинкой подушки (до блока, без `fund`) — мечта: без «хватит»; «за год» снят с экрана (FG-24)', async () => {
    await open('/goals/old', [pot(), pot({ id: 'old', name: 'На чёрный день', need: 900_000, fund: null, template: 'cushion' })])
    expect(card()).toBeNull()
    expect(page()).not.toContain('Хватит на')
    expect(page()).not.toContain('Чтобы успеть за год')
  })
})
