// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import type { SyncDoc } from '@/types/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import Breakdown from './Breakdown.vue'

/**
 * B2C-57: второе нажатие на чип выключает статью и меняет «Остаётся»; «Разложить» исполняет взносы,
 * досрочку и запись `kind: 'breakdown'` ровно один раз; повторный заход — «Разложено»; порядок не
 * пройден — сначала «Ваш порядок».
 *
 * Семья `planFamilyDoc`, зарплата Ильяса 700 000 на «Kaspi Gold»; «Дорогие долги» — 50 000 в месяц в
 * кредитку 40 %. Обязательное 323 000 + Жизнь 150 000 + Долги 50 000 + Мечты 130 000 = 653 000,
 * остаётся 47 000.
 */
const PATH = '/week/breakdown?from=salary&person=a&period=2026-10'
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function doc(extra: Partial<SyncDoc> = {}): SyncDoc {
  return planFamilyDoc({
    payments: [{ id: 's-a', kind: 'salary', targetId: 'a', period: '2026-10', amount: 700_000, accountId: 'card', by: 'a', at: '2026-10-10T05:00:00.000Z', updatedAt: T0 }],
    moneyArticles: [{ id: 'debts', order: 4, on: true, amount: 50_000, updatedAt: T0 }],
    moneySettings: { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, orderedAt: T0, updatedAt: T0 },
    ...extra,
  })
}

async function mount(pinia: Pinia, path = PATH) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Breakdown)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return router
}

async function open(extra: Partial<SyncDoc> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  finance.setHouseholdDoc(doc(extra), 1)
  const router = await mount(pinia)
  return { finance, router, pinia }
}

const ring = () => document.querySelector('[data-ring]')?.getAttribute('aria-label') ?? ''
const chip = (key: string) => document.querySelector(`[data-chip="${key}"]`) as HTMLButtonElement
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

describe('B2C-57: разбор кольцом в браузере', () => {
  it('первое нажатие на чип выбирает статью, второе — выключает: «Остаётся» 47 000 → 177 000', async () => {
    await open()
    expect(ring()).toContain(`Остаётся ${money(47_000)}`)
    chip('dreams').click()
    await nextTick()
    expect(chip('dreams').getAttribute('aria-pressed')).toBe('true')
    expect(ring()).toContain(`Остаётся ${money(47_000)}`)
    chip('dreams').click()
    await nextTick()
    expect(chip('dreams').getAttribute('aria-pressed')).toBe('false')
    expect(ring()).toContain(`Остаётся ${money(177_000)}`)
  })

  it('«Разложить» — взносы, досрочка и запись разбора ровно один раз; повторный заход — «Разложено»', async () => {
    const { finance, pinia } = await open()
    button('Разложить')!.click()
    await nextTick()
    const recs = finance.allocations
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ kind: 'breakdown', source: 'salary', sourceId: 'a', period: '2026-10', by: 'a', total: 700_000 })
    expect(recs[0].parts).toEqual([
      { target: 'must', amount: 323_000 },
      { target: 'life', amount: 150_000 },
      { target: 'debts', amount: 50_000 },
      { target: 'dreams', amount: 130_000 },
    ])
    // Досрочка 50 000 в кредитку со счёта зарплаты; взносы целей — по их месячному взносу.
    const prepays = finance.payments.filter((p) => p.kind === 'prepay' && !p.deletedAt)
    expect(prepays).toHaveLength(1)
    expect(prepays[0]).toMatchObject({ targetId: 'cc', amount: 50_000, accountId: 'card' })
    const put = (id: string) => finance.goals.find((g) => g.id === id)!.movements.reduce((s, m) => s + m.amount, 0)
    expect([put('cushion'), put('trip'), put('car')]).toEqual([30_000, 40_000, 60_000])
    // Теперь — «Разложено», кнопки нет: второй раз не разложить.
    expect(document.body.textContent).toContain('Разложено')
    expect(button('Разложить')).toBeUndefined()

    app!.unmount()
    document.body.innerHTML = ''
    await mount(pinia)
    expect(document.body.textContent).toContain('Разложено')
    expect(button('Разложить')).toBeUndefined()
    expect(finance.allocations).toHaveLength(1)
  })

  it('порядок не пройден — участник сначала в «Ваш порядок» с тем же источником', async () => {
    // Переход грузит экран отдельным чанком — ждём на настоящих таймерах.
    vi.useRealTimers()
    const { router } = await open({ moneySettings: null })
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/week/order?from=salary&person=a&period=2026-10'), { timeout: 5000 })
  })
})
