// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { goalDoneMonth, goalMonths } from '@/lib/finance'
import { monthBy, monthIn } from '@/lib/dates'
import { money, pct } from '@/lib/money'
import type { SyncDoc } from '@/types/finance'
import GoalDetail from './GoalDetail.vue'
import Dreams from './Dreams.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Ревью frontend Б14, Н-2: срок и «нужно» цели — одно место (`goalTerm` от строки плана месяца). Экран фонда — от
 * порога плана (процент и дата = план), цель при нехватке остатка — та же дата, что на «Мечтах».
 */
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

const KEY = '2026-09'

/** Семья плана: Ильяс пришла, Аруна ждём; «Машина» просит 600 000 — остатка не хватает; «Запас» — фонд со своей суммой 800 000. */
function familyDoc(): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: [
      ...doc.goals.map((g) => (g.id === 'car' ? { ...g, monthly: 600_000 } : g)),
      { id: 'res', name: 'Запас', need: 800_000, seed: 300_000, have: 300_000, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], fund: 'reserve', updatedAt: T0 },
    ],
    payments: [{ id: 'sal-a', kind: 'salary', targetId: 'a', period: KEY, amount: 700_000, accountId: null, by: 'a', at: '2026-09-10T05:00:00.000Z', updatedAt: T0 }],
    spendPlans: [
      { id: 'a:sc_taxi', by: 'a', categoryId: 'sc_taxi', amount: 80_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['trip', 'res', 'car', 'cushion'], updatedAt: T0 },
  })
}

async function open(view: Component, path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(familyDoc(), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  for (let i = 0; i < 3; i++) await nextTick()
  return finance
}

const page = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')
const norm = (s: string) => s.replace(/\s+/g, ' ')

describe('Н-2: срок и «нужно» — из плана месяца', () => {
  it('экран фонда: «нужно» — порог плана, процент и дата — как в плане, не от своей суммы 800 000', async () => {
    const finance = await open(GoalDetail, '/goals/res')
    const item = finance.monthPlanOf(KEY).queue.find((q) => q.id === 'res')!
    expect(item.need).not.toBe(800_000)
    expect(item.doneMonth).toBeTruthy()
    expect(page()).toContain(norm(`из ${money(item.need)}`))
    expect(page()).not.toContain(norm(`из ${money(800_000)}`))
    expect(page()).toContain(`${pct(300_000, item.need)}`)
    expect(page()).toContain(`Соберём в ${monthIn(item.doneMonth!)}`)
    expect(page()).not.toContain('мечта ваша')
    expect(page()).toContain('Собрано')
    expect(page()).not.toContain('До мечты')
  })

  // Р-116 (B2C-108): срок цели живёт только на экране цели — на «Мечтах» строка цели без «к <месяц>».
  it('цель при нехватке остатка: дата экрана = прогону плана, не по своему взносу; на «Мечтах» срока нет', async () => {
    const finance = await open(GoalDetail, '/goals/car')
    const item = finance.monthPlanOf(KEY).queue.find((q) => q.id === 'car')!
    expect(item.given).toBeLessThan(item.want)
    const own = goalDoneMonth(goalMonths(item.need - item.have, 600_000), KEY)
    expect(item.doneMonth).not.toBe(own)
    expect(page()).toContain(`Будет вашей в ${monthIn(item.doneMonth!)}`)
    if (own) expect(page()).not.toContain(`Будет вашей в ${monthIn(own)}`)

    app?.unmount()
    document.body.innerHTML = ''
    await open(Dreams, '/')
    expect(page()).toContain('Машина')
    expect(page()).not.toContain(monthBy(item.doneMonth!, KEY))
  })

  it('выключенная цель — «На паузе» без строки взносов', async () => {
    const finance = await open(GoalDetail, '/goals/car')
    finance.pauseGoal('car', true)
    for (let i = 0; i < 3; i++) await nextTick()
    expect(page()).toContain('На паузе')
    expect(page()).not.toContain('осталось')
  })
})

describe('Н-9: порог фонда полем «Месяцев трат»', () => {
  const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Порог фонда — месяцев трат"]')

  it('фонд: правка 1 → 2 — свой порог, «нужно» плана вдвое, экран показывает новое «из»', async () => {
    const finance = await open(GoalDetail, '/goals/res')
    const before = finance.monthPlanOf(KEY).queue.find((q) => q.id === 'res')!.need
    const input = field()!
    expect(input.value).toBe('1')
    input.focus()
    input.value = '2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur'))
    for (let i = 0; i < 3; i++) await nextTick()
    expect(finance.goals.find((g) => g.id === 'res')!.fundMonths).toBe(2)
    const after = finance.monthPlanOf(KEY).queue.find((q) => q.id === 'res')!.need
    expect(after).toBe(before * 2)
    expect(page()).toContain(norm(`из ${money(after)}`))
  })

  it('цель — поля нет', async () => {
    await open(GoalDetail, '/goals/car')
    expect(field()).toBeNull()
  })
})
