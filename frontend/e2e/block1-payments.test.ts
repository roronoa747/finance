import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc } from '../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '../src/types/api'
import { nextObligationDue } from '../src/lib/finance'

/**
 * Блок 1 развития: «Оплатил», досрочка, подписки. Два телефона — два стора Pinia
 * на одном фейковом сервере с ревизиями и 409, как в two-clients-sync.
 */
describe('e2e / Блок 1 — отметки оплат на двух телефонах', () => {
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

  const setOnline = (onLine: boolean) => vi.stubGlobal('navigator', { onLine })
  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  async function phone() {
    setActivePinia(createPinia())
    const store = useFinanceStore()
    const client = backend()
    await store.pullHousehold(client)
    return { store, client }
  }

  beforeEach(() => {
    // Таймеры подделаны: запланированный синк не уходит в настоящий apiClient.
    vi.useFakeTimers()
    at('2026-09-24T07:00:00Z')
    setOnline(true)
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

  it('A отмечает аренду офлайн, B — кредит офлайн → после синка у обоих обе отметки, карта уменьшена на обе', async () => {
    const A = await phone()
    const B = await phone()

    setOnline(false)
    at('2026-09-24T08:00:00Z')
    A.store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    at('2026-09-24T08:10:00Z')
    B.store.markPaid('credit', 'loan', 'b', { accountId: 'card' })
    await A.store.syncHousehold(A.client)
    await B.store.syncHousehold(B.client)
    expect(A.store.status).toBe('offline')
    expect(B.store.status).toBe('offline')
    expect(server.rev).toBe(1)

    setOnline(true)
    await A.store.syncHousehold(A.client)
    // B пушит поверх ревизии A: 409 → слияние → повтор.
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    expect(server.rev).toBe(3)

    for (const { store } of [A, B]) {
      expect(store.payments.map((p) => p.targetId).sort()).toEqual(['loan', 'rent'])
      // 1 000 000 − 220 000 аренда − 58 000 кредит.
      expect(store.accounts[0].amount).toBe(722_000)
      // Тело первого платежа: 58 000 − 1 000 000 × 0,33 / 12 = 30 500.
      expect(store.credits[0].principal).toBe(969_500)
      expect(nextObligationDue(store.obligations[0], store.payments)?.period).toBe('2026-10')
      expect(store.status).toBe('idle')
    }
  })

  it('одну аренду отметили оба офлайн → записей две, списание одно; снятие у одного возвращает деньги обоим', async () => {
    const A = await phone()
    const B = await phone()

    setOnline(false)
    at('2026-09-24T08:00:00Z')
    A.store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    at('2026-09-24T08:02:00Z')
    B.store.markPaid('obligation', 'rent', 'b', { accountId: 'card' })

    setOnline(true)
    await A.store.syncHousehold(A.client)
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)

    for (const { store } of [A, B]) {
      expect(store.payments).toHaveLength(2)
      expect(store.accounts[0].amount).toBe(780_000)
    }

    // B снимает отметку — надгробие на обе записи пары.
    at('2026-09-24T09:00:00Z')
    B.store.unmarkPaid('obligation', 'rent', '2026-09')
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    for (const { store } of [A, B]) {
      expect(store.payments.every((p) => p.deletedAt)).toBe(true)
      expect(store.accounts[0].amount).toBe(1_000_000)
      expect(nextObligationDue(store.obligations[0], store.payments)?.period).toBe('2026-09')
    }
  })
})
