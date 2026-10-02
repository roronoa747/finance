// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { ruleMatchOf } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import HistorySquare from './HistorySquare.vue'

/**
 * B2C-44: раздел задним числом из «Истории» — нажатие на операцию → лист «куда отнести?» с теми же
 * ответами, что у незнакомого продавца «Недели» (`CategoryChips`) → `recategorize` с продавцом
 * строки; строка и итоги месяца (`spendTotals`) пересчитаны.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-25T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const op = (id: string, date: string, amount: number, merchant: string): Operation => ({
  id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false,
})

describe('B2C-44: «куда отнести?» из «Истории»', () => {
  it('нажатие на операцию → чипы разделов → recategorize(продавец, раздел); строка и spendTotals — в «Продуктах»', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs('member'))
    const finance = useFinanceStore()
    finance.setHouseholdDoc(planFamilyDoc(), 1)
    const ops = useOperationsStore()
    const a = op('o1', '2026-09-11', -3_000, 'Непонятно ТОО')
    const b = op('o2', '2026-09-20', -2_000, 'Непонятно ТОО')
    ops.ops.o1 = a
    ops.ops.o2 = b
    const spy = vi.spyOn(ops, 'recategorize')
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money/history')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(HistorySquare)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()

    const row = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.includes('Непонятно ТОО'))!
    expect(row.textContent).toContain('Не разобрано')
    row.click()
    await nextTick()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Непонятно ТОО — куда отнести?')
    for (const t of ['Продукты', 'Между своими']) expect(dialog.textContent).toContain(t)
    ;[...dialog.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim() === 'Продукты')!.click()
    await nextTick()
    await nextTick()

    expect(spy).toHaveBeenCalledWith(ruleMatchOf(a), { categoryId: 'sc_food' })
    expect(ops.all.map((o) => o.categoryId)).toEqual(['sc_food', 'sc_food'])
    const food = (finance.householdDoc.spendTotals ?? []).find((t) => t.kind === 'month' && t.period === '2026-09' && t.categoryId === 'sc_food')
    expect(food?.amount).toBe(5_000)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Не разобрано')
  })
})
