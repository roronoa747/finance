import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import { createAppRouter } from '@/router'
import type { SpendTotal } from '@/lib/statements/types'
import type { SyncDoc } from '@/types/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import { money } from '@/lib/money'
import YourOrder from './YourOrder.vue'

/**
 * «Ваш порядок» (B2C-56; SSR): статьи по `order`, пустые — тоже, подписи порогов; лист «Жизни» —
 * подсказка «по выпискам прошлого месяца»; одна брендовая «Готово»; viewer — не сюда.
 * «Сейчас» — 2 октября 2026; прошлый месяц — сентябрь.
 */
const brandButtons = (html: string) =>
  [...html.matchAll(/<button[^>]*\bbg-brand text-brand-ink[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim())
const names = (html: string) => [...html.matchAll(/data-article="(\w+)"/g)].map((m) => m[1])
const total = (categoryId: string, amount: number): SpendTotal => ({
  id: `a:month:2026-09:${categoryId}`, by: 'a', kind: 'month', period: '2026-09', categoryId, amount, ops: 1, updatedAt: T0,
})

describe('views/YourOrder.vue — «Ваш порядок» (B2C-56)', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T07:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function family(role: 'member' | 'viewer' = 'member', extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs(role, 'a'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({
      uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-30', ops_count: 9, created_at: T0 }],
    })
    await useOperationsStore().loadUploads()
    return useFinanceStore()
  }

  it('статьи — по order документа, пустые тоже (нет плана — все семь); подписи порогов', async () => {
    await family('member', {
      moneyArticles: [
        { id: 'debts', order: 3, on: true, amount: 0, updatedAt: T0 },
        { id: 'reserve', order: 4, on: true, amount: 0, updatedAt: T0 },
      ],
      moneySettings: { reserveMonths: 2, cushionMonths: 6, costlyRate: 30, updatedAt: T0 },
    })
    const html = await renderScreen(YourOrder, '/week/order')
    expect(names(html)).toEqual(['must', 'life', 'debts', 'reserve', 'cushion', 'dreams', 'spend'])
    expect(html).toContain('Дорогие долги')
    expect(html).toContain('2 месяца трат')
    expect(html).toContain(`дороже 30 %`)
    expect(html).toContain('6 месяцев')
    expect(html).toContain('Сверху — что важнее')
  })

  it('одна брендовая кнопка — «Готово»', async () => {
    await family()
    expect(brandButtons(await renderScreen(YourOrder, '/week/order'))).toEqual(['Готово'])
  })

  it('лист «Жизни»: сумма, подсказка «по выпискам прошлого месяца» (articleFact), разделы чипами', async () => {
    // Сентябрь: продукты 90 000 + дом 30 000 → «Жизнь» 120 000; кафе 20 000 — «Траты»; аренда — в плане.
    await family('member', { spendTotals: [total('sc_food', 90_000), total('sc_home', 30_000), total('sc_cafe', 20_000), total('sc_rent', 220_000)] })
    const html = await renderScreen(YourOrder, '/week/order', undefined, [screenMixin({ open: 'life' })])
    expect(html).toContain(`по выпискам прошлого месяца ${money(120_000)}`)
    expect(html).toContain('В месяц')
    expect(html).toContain('Продукты')
    expect(html).not.toContain('>Аренда<')
    // «Траты»: подсказка — кафе 20 000.
    const spend = await renderScreen(YourOrder, '/week/order', undefined, [screenMixin({ open: 'spend' })])
    expect(spend).toContain(`по выпискам прошлого месяца ${money(20_000)}`)
  })

  it('лист «Дорогих долгов» при активном плане — строка плана без полей; «Обязательное» — без полей', async () => {
    await family('member', {
      plans: [{ id: 'plan', status: 'active', by: 'a', startedAt: '2026-09-10T05:00:00.000Z', endedAt: null, keptGoalIds: [], cushionGoalId: 'cushion', creditIds: ['cc', 'loan'], months: 24, lump: 0, forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null }, result: null, updatedAt: T0 }],
    })
    const debts = await renderScreen(YourOrder, '/week/order', undefined, [screenMixin({ open: 'debts' })])
    expect(debts).toContain('по плану «Сначала долги»')
    expect(debts).not.toContain('Дороже, %')
    const must = await renderScreen(YourOrder, '/week/order', undefined, [screenMixin({ open: 'must' })])
    expect(must).toContain('из платежей месяца')
    expect(must).not.toContain('В месяц')
  })

  it('viewer сюда не попадает: прямой адрес — в разбор', async () => {
    await family('viewer')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/week/order?from=salary&person=a&period=2026-10')
    expect(router.currentRoute.value.path).not.toBe('/week/order')
  })
})
