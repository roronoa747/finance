// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { closerDays } from '@/lib/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-09 (Р-15): после пополнения — тост «{имя} ближе на N дней» (4 с), после снятия — нет; без темпа — нет.
 * «Отпуск»: план взноса 40 000 в месяц.
 */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.useRealTimers()
})

async function open(monthly = 40_000) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  const doc = planFamilyDoc()
  doc.goals = doc.goals.map((g) => (g.id === 'trip' ? { ...g, monthly, movements: [] } : g))
  finance.setHouseholdDoc(doc, 1)
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

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const dialogButton = (text: string) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const closer = () => document.querySelector('[data-closer]')?.textContent?.trim() ?? null

async function enter(amount: string, submit: string) {
  const input = document.querySelector('[role="dialog"] input') as HTMLInputElement
  input.value = amount
  input.dispatchEvent(new Event('input'))
  await nextTick()
  dialogButton(submit).click()
  await nextTick()
  await nextTick()
}

describe('PN-09: тост «ближе на N дней» на экране цели', () => {
  it('пополнение 100 000 при темпе 40 000 → «Отпуск ближе на 76 дней»; через 4 с тоста нет', async () => {
    const finance = await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    button('Пополнить').click()
    await nextTick()
    await enter('100 000', 'Внести')
    expect(finance.goals.find((g) => g.id === 'trip')!.movements).toHaveLength(1)
    expect(closerDays(100_000, 40_000)).toBe(76)
    expect(closer()).toBe('Отпуск ближе на 76 дней')
    vi.advanceTimersByTime(3_900)
    await nextTick()
    expect(closer()).toBe('Отпуск ближе на 76 дней')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(closer()).toBeNull()
  })

  it('склонение: 21 день, 2 дня; снятие — без тоста', async () => {
    const finance = await open()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    button('Пополнить').click()
    await nextTick()
    // 27 632 / 40 000 × 30,4 = 21,0 → 21 день.
    await enter('27 632', 'Внести')
    expect(closer()).toBe('Отпуск ближе на 21 день')
    button('Пополнить').click()
    await nextTick()
    // 2 632 / 40 000 × 30,4 = 2,0 → 2 дня; новый тост перебивает прежний.
    await enter('2 632', 'Внести')
    expect(closer()).toBe('Отпуск ближе на 2 дня')
    vi.advanceTimersByTime(4_000)
    await nextTick()
    expect(closer()).toBeNull()

    const withdraw = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Снять'))!
    withdraw.click()
    await nextTick()
    await enter('5 000', 'Снять')
    expect(finance.goals.find((g) => g.id === 'trip')!.movements).toHaveLength(3)
    // Снятие записано, тоста нет — ни своего, ни прежнего.
    expect(closer()).toBeNull()
  })

  it('без плана взноса и без прошлых движений темпа нет — тоста нет', async () => {
    const finance = await open(0)
    button('Пополнить').click()
    await nextTick()
    await enter('100 000', 'Внести')
    expect(finance.goals.find((g) => g.id === 'trip')!.movements).toHaveLength(1)
    expect(closer()).toBeNull()
  })
})
