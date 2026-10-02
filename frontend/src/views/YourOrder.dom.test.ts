// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { apiClient } from '@/api/client'
import { money } from '@/lib/money'
import type { SyncDoc } from '@/types/finance'
import YourOrder from './YourOrder.vue'

/**
 * B2C-56: перестановка статей в «Ваш порядок» — за ⋮⋮ пальцем (pointer-события, как на iPhone) и
 * стрелками у фокуса; порядок пишется в документ сразу, с `updatedAt`. «Готово» — порядок пройден,
 * назад в разбор с тем же источником.
 */
const NOW = '2026-10-02T07:00:00.000Z'
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(NOW))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open(path = '/week/order', extra: Partial<SyncDoc> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  finance.setHouseholdDoc(planFamilyDoc(extra), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(YourOrder)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return { finance, router }
}

const grip = (id: string) => document.querySelector(`[data-article="${id}"] button[aria-label^="Переставить"]`) as HTMLElement
const shown = () => [...document.querySelectorAll('[data-article]')].map((x) => x.getAttribute('data-article'))
const pointer = (type: string, clientY: number) => new PointerEvent(type, { bubbles: true, clientY, pointerId: 1 })

describe('B2C-56: перестановка статей', () => {
  it('палец: «Запас» тянут вниз на строку — он ниже «Дорогих долгов»; порядок записан с updatedAt', async () => {
    const { finance } = await open()
    expect(shown()).toEqual(['must', 'life', 'reserve', 'debts', 'cushion', 'dreams', 'spend'])
    const g = grip('reserve')
    g.dispatchEvent(pointer('pointerdown', 100))
    g.dispatchEvent(pointer('pointermove', 170)) // больше половины строки (60 px) — меняются местами
    await nextTick()
    expect(shown()).toEqual(['must', 'life', 'debts', 'reserve', 'cushion', 'dreams', 'spend'])
    // Пока палец на экране — в документ не пишется.
    expect(finance.householdDoc.moneyArticles).toEqual([])
    g.dispatchEvent(pointer('pointerup', 170))
    await nextTick()
    expect(finance.householdDoc.moneyArticles!.map((a) => [a.id, a.order, a.updatedAt])).toEqual([
      ['debts', 3, NOW],
      ['reserve', 4, NOW],
    ])
    expect(finance.moneyArticles.map((a) => a.id)).toEqual(['must', 'life', 'debts', 'reserve', 'cushion', 'dreams', 'spend'])
  })

  it('стрелки: «Траты» вверх — над «Мечтами»; край списка не двигает', async () => {
    const { finance } = await open()
    grip('spend').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(shown()).toEqual(['must', 'life', 'reserve', 'debts', 'cushion', 'spend', 'dreams'])
    expect(finance.householdDoc.moneyArticles!.map((a) => [a.id, a.order, a.updatedAt])).toEqual([
      ['spend', 6, NOW],
      ['dreams', 7, NOW],
    ])
    grip('must').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    expect(shown()[0]).toBe('must')
  })

  it('«Готово» — порядок пройден (orderedAt), назад в разбор с тем же источником', async () => {
    const { finance, router } = await open('/week/order?from=salary&person=a&period=2026-10')
    const replace = vi.spyOn(router, 'replace')
    const done = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Готово')!
    done.click()
    await nextTick()
    expect(finance.moneySettings.orderedAt).toBe(NOW)
    expect(replace).toHaveBeenCalledWith({ path: '/week/breakdown', query: { from: 'salary', person: 'a', period: '2026-10' } })
  })
})

describe('ревью frontend Б11, Н-3: открытый напрямую «Ваш порядок»', () => {
  it('сам подтягивает загрузки выписок — в листе «Жизни» подсказка «по выпискам прошлого месяца»', async () => {
    const uploads = vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({
      uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-30', ops_count: 3, created_at: NOW }],
    })
    await open('/week/order', {
      spendTotals: [{ id: 'a:month:2026-09:sc_food', by: 'a', kind: 'month', period: '2026-09', categoryId: 'sc_food', amount: 64_000, ops: 3, updatedAt: NOW }],
    })
    expect(uploads).toHaveBeenCalled()
    ;(document.querySelector('[data-article="life"] button') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.body.textContent).toContain(`по выпискам прошлого месяца ${money(64_000)}`))
    uploads.mockRestore()
  })
})
