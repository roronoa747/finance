import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc } from '../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '../src/types/api'
import { nextCreditDue } from '../src/lib/finance'
import Capital from '../src/views/Capital.vue'

/**
 * Блок 2 «Правка денег» (PV-09…PV-13): два телефона — два стора Pinia на одном
 * фейковом сервере с ревизиями и 409, как в e2e Блока 1 RP. Браузерная проверка —
 * на стенде §6 (скрипты в scratchpad сессии, не в репо).
 */

describe('PV-09: кит окон', () => {
  it('токен затемнения --scrim — в светлой и тёмной теме, окна берут цвет только из него', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../src/style.css'), 'utf-8')
    const block = (sel: string) => {
      const at = css.indexOf(`${sel} {`)
      return css.slice(at, css.indexOf('\n}', at))
    }
    expect(block(':root')).toMatch(/--scrim:/)
    expect(block('.dark')).toMatch(/--scrim:/)
    expect(css).toMatch(/--color-scrim: var\(--scrim\)/)

    // Экраны блока — без литерального затемнения.
    for (const file of ['../src/views/Capital.vue', '../src/components/PaidRow.vue']) {
      const src = readFileSync(resolve(import.meta.dirname, file), 'utf-8')
      expect(src).not.toMatch(/bg-black|fixed inset-0|<select/)
    }
  })
})

describe('e2e / Блок 2 паритета — правка денег на двух телефонах', () => {
  let server: { rev: number; data: SyncDoc }
  const T0 = '2026-09-01T00:00:00.000Z'

  function backend(): ApiClient {
    const snapshot = (): HouseholdDocResponse => ({
      household_id: 'h-family',
      rev: server.rev,
      data: JSON.parse(JSON.stringify(server.data)),
      updated_at: new Date().toISOString(),
    })
    return {
      getHouseholdDoc: vi.fn(async () => snapshot()),
      pushHouseholdDoc: vi.fn(async (rev: number, data: SyncDoc) => {
        if (rev !== server.rev) {
          const conflict: ConflictResponse<HouseholdDocResponse> = { error: 'conflict', server_doc: snapshot() }
          throw new ApiError('conflict', 409, conflict)
        }
        server = { rev: server.rev + 1, data: JSON.parse(JSON.stringify(data)) }
        return snapshot()
      }),
    } as unknown as ApiClient
  }

  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  async function phone() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useFinanceStore()
    const client = backend()
    await store.pullHousehold(client)
    return { store, client, pinia }
  }

  /** Экран глазами телефона: SSR-рендер на его сторе. */
  async function screen(pinia: Pinia, view: Component, path: string) {
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push(path)
    const app = createSSRApp(view)
    app.use(router)
    return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  }

  beforeEach(() => {
    // Таймеры подделаны: запланированный синк не уходит в настоящий apiClient.
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    vi.stubGlobal('navigator', { onLine: true })
    server = {
      rev: 1,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [
          { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
        ],
        accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
        obligations: [
          { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
        ],
        credits: [
          { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
        ],
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('PV-10: правка ставки у кредита с отметкой не меняет остаток; правка остатка — якорь; второй телефон видит день и ставку', async () => {
    const A = await phone()
    const B = await phone()

    at('2026-09-24T08:00:00Z')
    A.store.markPaid('credit', 'loan', 'a', { accountId: 'card' })
    expect(A.store.credits[0].principal).toBe(969_500)

    at('2026-09-24T09:00:00Z')
    A.store.updateCredit('loan', { annualRate: 0.25, day: 20 })
    expect(A.store.credits[0].principal).toBe(969_500)
    expect(A.store.householdDoc.credits[0].principalSetAt).toBe(T0)
    await A.store.syncHousehold(A.client)

    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(B.store.credits[0]).toMatchObject({ annualRate: 0.25, day: 20, principal: 969_500 })
    // Следующий платёж — в новый день (сентябрь оплачен, дальше октябрь).
    expect(nextCreditDue(B.store.credits[0], B.store.payments)).toMatchObject({ period: '2026-10', day: 20 })
    const capitalB = await screen(B.pinia, Capital, '/capital?credit=loan')
    expect(capitalB).toContain('value="25,0"')
    expect(capitalB).toContain('Платёж 20 октября')

    // Сверка с банком на втором телефоне — новая база и якорь; отметка до якоря в ней.
    at('2026-09-25T08:00:00Z')
    B.store.updateCredit('loan', { principal: 960_000 })
    expect(B.store.householdDoc.credits[0].principalSetAt).toBe('2026-09-25T08:00:00.000Z')
    expect(B.store.credits[0].principal).toBe(960_000)
    await B.store.syncHousehold(B.client)
    setActivePinia(A.pinia)
    await A.store.pullHousehold(A.client)
    expect(A.store.credits[0].principal).toBe(960_000)
  })
})
