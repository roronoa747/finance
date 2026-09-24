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
import {
  accountBalance,
  budgetAmounts,
  countedPayments,
  lastAccountFor,
  lumpPlan,
  nextObligationDue,
  paidFor,
  prepaySaved,
} from '../src/lib/finance'
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
    // B синкает после A: syncHousehold сначала берёт свежую ревизию A (GET), сливает
    // и пушит на неё — 409 тут не возникает, push один. Настоящий 409 (ревизия
    // сдвинулась между GET и push) — в сценарии «настоящий 409» ниже.
    await B.store.syncHousehold(B.client)
    expect(B.client.pushHouseholdDoc).toHaveBeenCalledTimes(1)
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
      expect(prepaySaved(p.store.payments, p.store.credits)).toBe(plan.saved)
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

  it('настоящий 409: A пушит между GET и push телефона B → B сливает из server_doc и повторяет; обе отметки у всех, общая пара списана один раз', async () => {
    const A = await phone()
    const B = await phone()

    setOnline(false)
    at('2026-09-24T08:00:00Z')
    A.store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })
    // B не видит отметки A: та же аренда вторым нажатием и кредит.
    at('2026-09-24T08:02:00Z')
    B.store.markPaid('obligation', 'rent', 'b', { accountId: 'card' })
    at('2026-09-24T08:10:00Z')
    B.store.markPaid('credit', 'loan', 'b', { accountId: 'card' })
    setOnline(true)

    // Первый push B задерживается: пока он в пути, A успевает синкнуться — сервер
    // уходит на ревизию 2, а B пушит с ревизией 1, взятой GET-ом.
    const realPush = B.client.pushHouseholdDoc
    let pushesB = 0
    const conflicts: number[] = []
    B.client.pushHouseholdDoc = vi.fn(async (rev: number, data: SyncDoc) => {
      pushesB++
      if (pushesB === 1) {
        await A.store.syncHousehold(A.client)
        expect(server.rev).toBe(2)
      }
      try {
        return await realPush(rev, data)
      } catch (err) {
        if (err instanceof ApiError) conflicts.push(err.status)
        throw err
      }
    }) as ApiClient['pushHouseholdDoc']

    await B.store.syncHousehold(B.client)
    expect(B.client.getHouseholdDoc).toHaveBeenCalledTimes(2) // pull в phone() + GET синка — повтор без GET
    expect(pushesB).toBe(2)
    expect(conflicts).toEqual([409])
    expect(server.rev).toBe(3)
    await A.store.pullHousehold(A.client)

    const card = server.data.accounts[0]
    // 1 000 000 − 220 000 аренда (пара rent/2026-09 — одна, из двух записей) − 58 000 кредит.
    expect(accountBalance(card, server.data.payments)).toBe(722_000)
    expect(server.data.payments).toHaveLength(3)
    for (const { store } of [A, B]) {
      expect(store.payments).toHaveLength(3)
      expect(countedPayments(store.payments).map((p) => `${p.kind}:${p.targetId}`).sort()).toEqual([
        'credit:loan',
        'obligation:rent',
      ])
      // Засчитана ранняя запись пары — отметка A.
      expect(paidFor(store.payments, 'obligation', 'rent', '2026-09')?.by).toBe('a')
      expect(store.accounts[0].amount).toBe(accountBalance(card, server.data.payments))
      expect(store.accounts[0].amount).toBe(722_000)
      expect(store.credits[0].principal).toBe(969_500)
      expect(store.status).toBe('idle')
    }
  })

  it('A офлайн отметил аренду с карты, B не видя сделал взнос в цель с карты → у обоих карта 1 000 000 − 220 000 − 50 000', async () => {
    server.data.goals = [
      {
        id: 'japan', name: 'Япония', need: 1_500_000, seed: 0, have: 0, monthly: 100_000, hue: 'teal',
        planPct: 0, movements: [], updatedAt: T0,
      },
    ]
    const A = await phone()
    const B = await phone()

    setOnline(false)
    at('2026-09-24T08:00:00Z')
    A.store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })

    // Взнос позже отметки A: так делает GoalDetail — взнос + сдвиг счёта. Якорь не
    // переезжает на «сейчас», иначе офлайн-отметка A после слияния не списалась бы.
    setOnline(true)
    at('2026-09-24T08:10:00Z')
    B.store.contribute('japan', 50_000, 'b')
    B.store.shiftAccountAmount('card', -50_000)
    expect(B.store.accounts[0].amount).toBe(950_000)
    await B.store.syncHousehold(B.client)

    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect(server.rev).toBe(3)

    const card = server.data.accounts[0]
    expect(card.amount).toBe(950_000)
    expect(card.amountSetAt).toBe(T0)
    expect(accountBalance(card, server.data.payments)).toBe(730_000)
    for (const { store } of [A, B]) {
      expect(store.accounts[0].amount).toBe(1_000_000 - 220_000 - 50_000)
      expect(store.goals[0].have).toBe(50_000)
      expect(store.status).toBe('idle')
    }
  })

  it('A отметил аренду, B сверил карту с банком, A поправил сумму отметки → у обоих карта = сверенная, второго списания нет', async () => {
    const A = await phone()
    const B = await phone()

    at('2026-09-24T08:00:00Z')
    const record = A.store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })!
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect(B.store.accounts[0].amount).toBe(780_000)

    // Банк уже списал аренду и ещё 5 000 комиссии: B вводит остаток — новая база и якорь.
    at('2026-09-24T08:30:00Z')
    B.store.setAccountAmount('card', 775_000)
    await B.store.syncHousehold(B.client)

    // A (сверки не видел) правит отметку: на самом деле заплатили 230 000.
    at('2026-09-24T09:00:00Z')
    const edited = A.store.editPaid(record, { amount: 230_000, accountId: 'card' })!
    // Момент оплаты — исходный: запись до якоря сверки, остаток она не двигает.
    // С `at` = момент правки карта стала бы 775 000 − 230 000.
    expect(edited.at).toBe(record.at)
    expect(edited.updatedAt).toBe('2026-09-24T09:00:00.000Z')
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect(server.rev).toBe(4)

    const card = server.data.accounts[0]
    expect(card.amountSetAt).toBe('2026-09-24T08:30:00.000Z')
    expect(accountBalance(card, server.data.payments)).toBe(775_000)
    for (const { store } of [A, B]) {
      expect(store.accounts[0].amount).toBe(775_000)
      expect(paidFor(store.payments, 'obligation', 'rent', '2026-09')?.amount).toBe(230_000)
      expect(store.payments.filter((p) => !p.deletedAt)).toHaveLength(1)
      expect(store.status).toBe('idle')
    }
  })

  // ---- Приёмка Блока 1: сценарии, прогнанные в браузере на стенде §6 ----

  it('приёмка: документ прода без payments и якорей — цифры экранов те же, что у клиента Блока 0', async () => {
    // Документ как в проде до деплоя Блока 1. Ожидаемые числа сняты в браузере с
    // клиента Блока 0 (main, 2c098a9) на этом же документе 24 сентября по Алматы.
    server.data = {
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
      categories: [
        { key: 'd1', name: 'Жильё', note: '', amount: 260_000, updatedAt: T0 },
        { key: 'd2', name: 'Кредиты', note: '', amount: 58_000, updatedAt: T0 },
        { key: 'd3', name: 'Цели', note: '', amount: 100_000, updatedAt: T0 },
        { key: 'd4', name: 'Еда и быт', note: '', amount: 300_000, updatedAt: T0 },
        { key: 'd5', name: 'Свободно', note: '', amount: 0, updatedAt: T0 },
      ],
      obligations: [
        { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2026-01', amount: 220_000 }], updatedAt: T0 },
        { id: 'util', name: 'Коммуналка', note: '', day: 8, category: 'd1', estimate: true, versions: [{ from: '2026-01', amount: 35_000 }], updatedAt: T0 },
        { id: 'slack', name: 'Slack', note: '', day: 12, category: 'd4', every: 'month', versions: [{ from: '2026-01', amount: 3_000 }], updatedAt: T0 },
        { id: 'netflix', name: 'Netflix', note: '', day: 18, category: 'd4', every: 'month', versions: [{ from: '2026-01', amount: 4_990 }], updatedAt: T0 },
        { id: 'icloud', name: 'iCloud', note: '', day: 5, month: 10, category: 'd4', every: 'year', versions: [{ from: '2026-01', amount: 11_990 }], updatedAt: T0 },
      ],
      credits: [{ id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 7, updatedAt: T0 }],
      goals: [
        { id: 'trip', name: 'Поездка', need: 2_000_000, seed: 600_000, have: 600_000, monthly: 100_000, hue: 'teal', planPct: 0.3, movements: [], updatedAt: T0 },
      ],
      wishlist: [],
      accounts: [
        { id: 'card', name: 'Kaspi Gold', note: '', kind: 'card', amount: 1_000_000, updatedAt: T0 },
        { id: 'dep', name: 'Депозит', note: '', kind: 'deposit', amount: 2_000_000, updatedAt: T0 },
      ],
    } as SyncDoc
    at('2026-09-24T18:00:00Z')
    const A = await phone()

    const overview = await screen(A.pinia, Overview, '/')
    expect(overview).toContain(money(478_011)) // Свободно в сентябре
    expect(overview).toContain(money(308_989)) // Еда и быт
    expect(overview).toContain('Через 16 дней')
    expect(overview).toContain(money(324_990)) // Списаний до неё
    expect(overview).toContain(`На счетах ${plain(1_000_000)} ₸ — хватает, остаётся ${plain(675_010)} ₸.`)
    const capital = await screen(A.pinia, Capital, '/capital')
    expect(capital).toContain(money(2_600_000)) // Чистый капитал
    expect(capital).toContain('24 платежей')
    expect(capital).toContain(`переплата ${plain(374_102)}`)
    // Открытие ничего не пишет: ни отметок, ни якорей, ни push.
    expect(A.store.payments).toEqual([])
    expect(A.store.accounts.find((a) => a.id === 'card')?.amount).toBe(1_000_000)
    expect(A.client.pushHouseholdDoc).not.toHaveBeenCalled()
  })

  it('приёмка: «Впереди» — оплачен только ранний платёж → он уходит ниже неоплаченного позднего', async () => {
    const A = await phone()
    const ahead = (html: string) => html.slice(html.indexOf('Впереди'))
    const before = ahead(await screen(A.pinia, Overview, '/'))
    expect(before.indexOf('Аренда')).toBeLessThan(before.indexOf('Кредит')) // по дню: 5-е раньше 15-го

    setActivePinia(A.pinia)
    A.store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })
    const after = ahead(await screen(A.pinia, Overview, '/'))
    expect(after.indexOf('Кредит')).toBeLessThan(after.indexOf('Аренда'))
    expect(after).toContain(`оплачено · дальше 5 октября · ${plain(220_000)} ₸`)
  })

  it('приёмка: коммуналку-оценку отметили оба офлайн разными суммами → списана одна, ранняя, у обоих', async () => {
    server.data.obligations.push({
      id: 'util', name: 'Коммуналка', note: '', day: 8, category: 'd1', estimate: true,
      versions: [{ from: '2026-01', amount: 35_000 }], updatedAt: T0,
    })
    const A = await phone()
    const B = await phone()

    setOnline(false)
    at('2026-09-24T08:00:00Z')
    A.store.markPaid('obligation', 'util', 'a', { period: '2026-09', amount: 35_000, accountId: 'card' })
    at('2026-09-24T08:05:00Z')
    B.store.markPaid('obligation', 'util', 'b', { period: '2026-09', amount: 36_000, accountId: 'card' })

    setOnline(true)
    await A.store.syncHousehold(A.client)
    await B.store.syncHousehold(B.client) // 409 → слияние из server_doc
    await A.store.pullHousehold(A.client)

    expect(server.data.payments!.filter((p) => !p.deletedAt)).toHaveLength(2)
    for (const { store } of [A, B]) {
      expect(paidFor(store.payments, 'obligation', 'util', '2026-09')?.amount).toBe(35_000)
      expect(store.accounts[0].amount).toBe(965_000)
    }
  })

  it('приёмка (правка критика): «Оплатил» → взнос в цель с той же карты → партнёр снял отметку — деньги вернулись у обоих', async () => {
    const A = await phone()
    const B = await phone()

    at('2026-09-24T08:00:00Z')
    A.store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })
    at('2026-09-24T08:10:00Z')
    A.store.shiftAccountAmount('card', -50_000) // взнос в цель со счёта (GoalDetail)
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)
    expect(B.store.accounts[0].amount).toBe(730_000)

    at('2026-09-24T08:20:00Z')
    B.store.unmarkPaid('obligation', 'rent', '2026-09')
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    for (const { store } of [A, B]) {
      expect(store.accounts[0].amount).toBe(950_000)
      expect(store.accounts[0].amountSetAt).toBe(T0) // сдвиг не двигал якорь сверки
    }
  })

  it('приёмка: «снизить платёж» — второй телефон видит новый платёж и счётчик; снятие с него возвращает платёж первому', async () => {
    const A = await phone()
    const B = await phone()
    const term = lumpPlan(1_000_000, 0.33, 58_000, 200_000, 'term')!
    const lower = lumpPlan(800_000, 0.33, 58_000, 100_000, 'payment')!

    setActivePinia(A.pinia)
    at('2026-09-24T08:00:00Z')
    A.store.applyPrepayment('loan', 'a', { amount: 200_000, mode: 'term', accountId: 'card' })
    at('2026-09-24T08:05:00Z')
    A.store.applyPrepayment('loan', 'a', { amount: 100_000, mode: 'payment' }) // счёт — прошлый (Р-5)
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)

    expect(lower.payment).toBe(50_750)
    expect(term.saved + lower.saved).toBe(181_913)
    expect(B.store.credits[0].payment).toBe(lower.payment)
    expect(B.store.credits[0].principal).toBe(700_000)
    expect(B.store.accounts[0].amount).toBe(700_000)
    expect(prepaySaved(B.store.payments, B.store.credits)).toBe(181_913)
    expect(await screen(B.pinia, Capital, '/capital')).toContain(money(181_913))

    setActivePinia(B.pinia)
    at('2026-09-24T09:00:00Z')
    B.store.removePrepayment(B.store.payments.find((p) => p.kind === 'prepay' && p.mode === 'payment')!.id)
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)
    for (const { store } of [A, B]) {
      expect(store.credits[0].payment).toBe(58_000)
      expect(store.credits[0].principal).toBe(800_000)
      expect(store.accounts[0].amount).toBe(800_000)
      expect(prepaySaved(store.payments, store.credits)).toBe(term.saved)
    }
  })
})
