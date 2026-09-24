import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import { createSSRApp, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '../src/router'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { ApiClient, ApiError } from '../src/api/client'
import type { SyncDoc } from '../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '../src/types/api'
import { budgetAmounts, lastAccountFor, lumpPlan, nextObligationDue, prepaySaved } from '../src/lib/finance'
import { money, plain } from '../src/lib/money'
import Overview from '../src/views/Overview.vue'
import Capital from '../src/views/Capital.vue'

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
    return renderToString(app)
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

  it('RP-07: «оплатил аренду» одним нажатием → виден следующий платёж, карта уменьшилась; второй телефон после синка видит то же', async () => {
    // В августе аренду уже платили с карты (до сверки 1 сентября) — счёт больше не спрашивается.
    server.data.payments = [
      {
        id: 'aug', kind: 'obligation', targetId: 'rent', period: '2026-08', amount: 220_000,
        accountId: 'card', by: 'b', at: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
      },
    ]
    const A = await phone()
    const B = await phone()

    setActivePinia(A.pinia)
    expect(await screen(A.pinia, Overview, '/')).toContain('Оплатил')

    // Одно нажатие = то, что делает кнопка: счёт прошлой оплаты, сумма по графику.
    at('2026-09-24T08:00:00Z')
    expect(lastAccountFor(A.store.payments, 'rent', A.store.accounts)).toBe('card')
    A.store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })

    const shownA = await screen(A.pinia, Overview, '/')
    expect(shownA).toContain(`оплачено · дальше 5 октября · ${plain(220_000)} ₸`)
    expect(A.store.accounts[0].amount).toBe(780_000)

    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    const shownB = await screen(B.pinia, Overview, '/')
    expect(shownB).toContain(`оплачено · дальше 5 октября · ${plain(220_000)} ₸`)
    expect(await screen(B.pinia, Capital, '/capital')).toContain(money(780_000))
  })

  it('RP-08: досрочка «сократить срок» меняет остаток и срок, показывает сэкономленное — у обоих, до тенге', async () => {
    const A = await phone()
    const B = await phone()
    const plan = lumpPlan(1_000_000, 0.33, 58_000, 200_000, 'term')!

    setActivePinia(A.pinia)
    at('2026-09-24T08:00:00Z')
    A.store.applyPrepayment('loan', 'a', { amount: 200_000, mode: 'term', accountId: 'card' })
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)

    for (const p of [A, B]) {
      expect(p.store.credits[0].principal).toBe(plan.left)
      expect(p.store.accounts[0].amount).toBe(800_000)
      expect(prepaySaved(p.store.payments)).toBe(plan.saved)
      const capital = await screen(p.pinia, Capital, '/capital')
      expect(capital).toContain(money(800_000))
      expect(capital).toContain(`${plan.months} платежей`)
      expect(capital).toContain('Досрочками уже сэкономили на процентах')
      expect(capital).toContain(money(plan.saved))
      const payoff = await screen(p.pinia, Capital, '/capital?payoff=loan')
      expect(payoff).toContain('Применённые досрочки')
      expect(payoff).toContain('сократили срок')
    }
  })

  it('RP-09: рабочая группа не спрашивает «оставить?», годовая досуговая перед продлением — спрашивает; ответ и «отменить» — у обоих', async () => {
    const sub = (id: string, name: string, amount: number, extra: Record<string, unknown> = {}) => ({
      id, name, note: '', day: 10, category: 'd4' as const, versions: [{ from: '2000-01', amount }], updatedAt: T0, ...extra,
    })
    server.data.obligations.push(
      { id: 'work', name: 'Рабочие', note: '', day: 1, category: 'd4', versions: [], group: true, noAsk: true, updatedAt: T0 },
      sub('slack', 'Slack', 3_000, { parentId: 'work', keptAt: null }),
      sub('netflix', 'Netflix', 4_990, { keptAt: '2026-06-01T07:00:00.000Z' }),
      // Продление 5 октября — через 11 дней.
      sub('icloud', 'iCloud', 11_990, { every: 'year', month: 10, day: 5, keptAt: '2026-01-10T07:00:00.000Z' }),
    )
    const A = await phone()
    const B = await phone()

    let overview = await screen(A.pinia, Overview, '/')
    expect(overview).toContain('Оставить «iCloud»?')
    expect(overview).toContain('Продлится 5 октября')
    expect(overview).not.toContain('Оставить «Slack»?')

    setActivePinia(A.pinia)
    at('2026-09-24T08:00:00Z')
    A.store.keepSubscription('icloud')
    overview = await screen(A.pinia, Overview, '/')
    expect(overview).toContain('Оставить «Netflix»?')
    expect(overview).toContain('Раз в квартал сверяем подписки')

    // Партнёр тот же вопрос не получает — ответ в общем документе.
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    overview = await screen(B.pinia, Overview, '/')
    expect(overview).not.toContain('Оставить «iCloud»?')
    expect(overview).toContain('Оставить «Netflix»?')

    // «Отменить» — надгробие: подписка ушла у обоих, спрашивать больше некого.
    setActivePinia(B.pinia)
    B.store.removeObligation('netflix')
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    overview = await screen(A.pinia, Overview, '/')
    expect(overview).not.toContain('Оставить «')
    const capital = await screen(A.pinia, Capital, '/capital')
    expect(capital).not.toContain('Netflix')
    // Группа видна с подписками и итогом; годовая — «в год».
    expect(capital).toContain('Рабочие')
    expect(capital).toContain('1 подписка · рабочие')
    expect(capital).toContain('Slack')
    expect(capital).toContain('в год')

    // Бюджет месяца от группировки не изменился.
    const doc = A.store.householdDoc
    const flat = { ...doc, obligations: doc.obligations.filter((o) => !o.group).map((o) => ({ ...o, parentId: null })) }
    expect(budgetAmounts(doc)).toEqual(budgetAmounts(flat))
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
