import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { fxToTenge } from '../src/lib/finance'
import { normalizeMerchant, unknownGroups } from '../src/lib/statements/model'
import { assignIds } from '../src/lib/statements/model'
import { DEMO_TOKEN, useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { WalletStatus } from '../src/types/api'
import Settings from '../src/views/Settings.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, serverTap, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 1 «Касание» бэклога «Apple Pay» (AP-08): касание Apple Pay пишет сервер (`serverTap`, как AP-03), телефон
 * подтягивает и раскладывает, выписка заменяет; два телефона Ильяса, телефон Аруны и viewer на фейковом сервере.
 * Четверг 15 октября 2026: неделя 12–18 (W42).
 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const STATUS: WalletStatus = {
  connected: false, phones: 0,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
}
const USD_RATE = 480.5

type Phone = { pinia: Pinia; client: ApiClient; calls: ReturnType<typeof walletFake>; store: ReturnType<typeof useFinanceStore> }

function walletFake(status: WalletStatus) {
  const state = { ...status }
  return {
    walletStatus: vi.fn(async () => ({ ...state })),
    walletConnect: vi.fn(async () => {
      Object.assign(state, { connected: true, phones: state.phones + 1 })
      return { key: ['ffk', 'C'.repeat(43)].join('_') }
    }),
    walletDisconnect: vi.fn(async () => {
      Object.assign(state, { connected: false, phones: 0 })
    }),
    // Курса ещё нет — ответа нет (как без сети): книга спросит снова на следующем pull.
    fxRates: vi.fn(async (code: string) => {
      if (!rates.ready) throw new Error('offline')
      return { code, rates: code === 'USD' ? { '2026-10-14': USD_RATE } : {}, partial: false }
    }),
  }
}
/** Курс Нацбанка «опубликован»: до этого ручка курсов не отвечает. */
const rates = { ready: false }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', o: { role?: 'member' | 'viewer'; demo?: boolean; status?: WalletStatus } = {}): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const role = o.role ?? 'member'
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: o.demo ? DEMO_TOKEN : `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const calls = walletFake(o.status ?? STATUS)
  const client = { ...backend(server), ...statementsFor(st, user, slot), ...calls } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  useApplePayStore().userAgent = IPHONE
  await useApplePayStore().load(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, calls, store }
}

/** Телефон подтягивает свои операции (старт, «Неделя», возврат в приложение) и шлёт документ. */
async function pull(p: Phone) {
  setActivePinia(p.pinia)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const weekTotal = (p: Phone, categoryId?: string) =>
  (p.store.householdDoc.spendTotals ?? [])
    .filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W42' && (!categoryId || t.categoryId === categoryId))
    .reduce((a, t) => a + t.amount, 0)
const opsOf = (p: Phone) => {
  setActivePinia(p.pinia)
  return useOperationsStore().all
}

describe('e2e / Apple Pay Блок 1 — касание', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-15T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
    rates.ready = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('касание → «Неделя» Ильяса: Magnum — «Продукты», незнакомое — в вопросах; ответ — раздел; Аруна видит только итог', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    serverTap(st, 'u-a', { id: 'a000000000000001', date: '2026-10-14', amount: -5_000, merchant: 'Magnum' })
    serverTap(st, 'u-a', { id: 'a000000000000002', date: '2026-10-15', amount: -1_200, merchant: 'ZZ Bakery' })

    await pull(A)
    expect(weekTotal(A)).toBe(6_200)
    expect(weekTotal(A, 'sc_food')).toBe(5_000)
    expect(unknownGroups(opsOf(A)).map((g) => g.label)).toEqual(['ZZ Bakery'])
    expect(text(await screen(A.pinia, Week, '/week'))).toMatch(/6\s200/)

    // «Куда отнести?» → «Кафе»: правило, раздел у операции, итог переписан.
    setActivePinia(A.pinia)
    await useOperationsStore().recategorize({ merchant: normalizeMerchant('ZZ Bakery') }, { categoryId: 'sc_cafe' }, A.client)
    await A.store.syncHousehold(A.client)
    expect(weekTotal(A, 'sc_cafe')).toBe(1_200)
    // На сервере — раздел, поля сервера на месте.
    expect(st.ops.get('u-a')!.get('a000000000000002')).toMatchObject({ category_id: 'sc_cafe', source: 'tap' })

    setActivePinia(B.pinia)
    await B.store.pullHousehold(B.client)
    expect(weekTotal(B, 'sc_cafe')).toBe(1_200)
    expect(weekTotal(B, 'sc_food')).toBe(5_000)
    await useOperationsStore().pull(B.client)
    expect(opsOf(B)).toEqual([])
  })

  it('валюта: USD до курса — 0 и не в итогах; курс опубликован — тенге по fxToTenge, назад на сервер', async () => {
    const A = await phone(server, st, 'a')
    serverTap(st, 'u-a', { id: 'a000000000000003', bank: 'card', date: '2026-10-14', amount: 0, merchant: 'Apple Store', fx_currency: 'USD', fx_amount: 622 })

    await pull(A)
    expect(opsOf(A).find((o) => o.id === 'a000000000000003')!.amount).toBe(0)
    expect(weekTotal(A)).toBe(0)

    rates.ready = true
    await pull(A)
    const tenge = fxToTenge(6.22, USD_RATE)
    expect(opsOf(A).find((o) => o.id === 'a000000000000003')!.amount).toBe(-tenge)
    expect(weekTotal(A)).toBe(tenge)
    expect(st.ops.get('u-a')!.get('a000000000000003')).toMatchObject({ amount: -tenge, fx_currency: 'USD', fx_amount: 622 })
  })

  it('выписка с той же покупкой: одна операция, надгробие ушло; второй телефон Ильяса — без телефонной; фантом убран', async () => {
    const A = await phone(server, st, 'a')
    const A2 = await phone(server, st, 'a') // второй телефон того же человека
    serverTap(st, 'u-a', { id: 'a000000000000004', date: '2026-10-13', amount: -5_000, merchant: 'Magnum' })
    serverTap(st, 'u-a', { id: 'a000000000000005', date: '2026-10-12', amount: -777, merchant: 'Отклонённая' })
    await pull(A)
    await pull(A2)
    expect(opsOf(A2).map((o) => o.id).sort()).toEqual(['a000000000000004', 'a000000000000005'])

    const operations: Omit<Operation, 'id'>[] = [
      { bank: 'kaspi', date: '2026-10-13', amount: -5_000, kind: 'purchase', merchant: 'MAGNUM ALMATY KZ', categoryId: null, internal: false },
      { bank: 'kaspi', date: '2026-10-14', amount: -2_000, kind: 'purchase', merchant: 'Small', categoryId: null, internal: false },
    ]
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-10-01', to: '2026-10-14', skipped: 0, operations: assignIds(operations) }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'kaspi.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)

    expect(opsOf(A).filter((o) => o.source)).toEqual([])
    expect(weekTotal(A)).toBe(7_000) // 5 000 + 2 000 — без дубля и без фантома
    expect(st.ops.get('u-a')!.get('a000000000000004')).toMatchObject({ deleted: true, source: 'tap' })
    expect(st.ops.get('u-a')!.get('a000000000000005')).toMatchObject({ deleted: true })

    await pull(A2)
    expect(opsOf(A2).filter((o) => o.source)).toEqual([])
    expect(opsOf(A2)).toHaveLength(2)
    expect(weekTotal(A2)).toBe(7_000)
  })

  it('«Отключить» в настройках — ручка вызвана, карточка снова «Подключить»', async () => {
    const A = await phone(server, st, 'a', { status: { ...STATUS, connected: true, phones: 1 } })
    const before = text(await screen(A.pinia, Settings, '/settings'))
    expect(before).toContain('Apple Pay')
    expect(before).toContain('Отключить')
    setActivePinia(A.pinia)
    await useApplePayStore().disconnect(A.client)
    expect(A.calls.walletDisconnect).toHaveBeenCalledOnce()
    const after = text(await screen(A.pinia, Settings, '/settings'))
    expect(after).toContain('Подключить')
    expect(after).toContain('Траты появятся сами после оплаты')
    // На «Неделе» iPhone снова зовёт тихой строкой.
    expect(text(await screen(A.pinia, Week, '/week'))).toContain('Траты сами с Apple Pay')
  })

  it('viewer и демо: ни карточки, ни строки, ни запросов Apple Pay', async () => {
    const V = await phone(server, st, 'a', { role: 'viewer' })
    const D = await phone(server, st, 'a', { demo: true })
    for (const p of [V, D]) {
      expect(p.calls.walletStatus).not.toHaveBeenCalled()
      expect(text(await screen(p.pinia, Settings, '/settings'))).not.toContain('Apple Pay')
      expect(text(await screen(p.pinia, Week, '/week'))).not.toContain('Apple Pay')
    }
  })
})
