import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money, plain } from '../src/lib/money'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MoneyArticle, SyncDoc } from '../src/types/finance'
import Money from '../src/views/Money.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 11 «Разбор денег» (B2C-60): осталась часть 8 — статусы виджетов «Денег» и лист «Траты» (под «Подробнее» с
 * Блока 14). Кольцо разбора, «Ваш порядок», «как обычно» и старые адреса раскладки убраны в Блоке 14 (B2C-89, Р-78):
 * их смысл — запись денег месяца одним действием, оба телефона, viewer — проверяет `b2c-block14-month-plan.test.ts`.
 * Семья: Ильяс — 10-го, Аруна — 20-го; аренда 220 000 (5-го), кредитка 300 000 под 40 % с платежом 25 000 (22-го).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b' | 'c', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot === 'c' ? 'a' : slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const K = '2026-10'
const article = (id: MoneyArticle['id'], order: number, amount?: number): MoneyArticle => ({ id, order, on: true, ...(amount === undefined ? {} : { amount }), updatedAt: T0 })

function familyDoc(): SyncDoc {
  const base = planFamilyDoc()
  return {
    ...base,
    obligations: base.obligations.filter((o) => o.id === 'rent'),
    credits: base.credits.filter((c) => c.id === 'cc'),
    goals: [
      { id: 'trip', name: 'Отпуск', need: 3_000_000, seed: 40_000, have: 40_000, monthly: 50_000, hue: 'plum', planPct: 0, movements: [], main: true, updatedAt: T0 },
      { id: 'pot', name: 'Подушка', need: 1_500_000, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], updatedAt: T0 },
    ],
    moneyArticles: [
      article('must', 1), article('life', 2, 150_000), article('reserve', 3, 50_000), article('debts', 4, 30_000),
      article('cushion', 5, 20_000), article('dreams', 6), article('spend', 7, 60_000),
    ],
    moneySettings: { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'pot', orderedAt: null, updatedAt: T0 },
  }
}

describe('e2e / B2C Блок 11 — виджеты «Денег» после разбора (часть 8)', () => {
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
    at('2026-10-12T07:00:00Z') // 12 октября: зарплата Ильяса (10-го) пришла, Аруны (20-го) — нет
    server = fakeServer(familyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('часть 8 — статусы виджетов и лист «Траты»: тег раздела выше ориентира, доли = суммы «Истории» за месяц', async () => {
    const A = await phone(server, st, 'a')
    const parsed: ParsedStatement = {
      bank: 'kaspi', from: '2026-10-01', to: '2026-10-12', skipped: 0,
      operations: assignIds(
        ([
          ['2026-10-03', -40_000, 'Magnum', 'sc_food'], ['2026-10-08', -20_000, 'Magnum', 'sc_food'],
          ['2026-10-05', -24_000, 'Del Papa Cafe', 'sc_cafe'], ['2026-10-09', -16_000, 'Yandex Go', 'sc_transport'],
        ] as const).map(([date, amount, merchant, categoryId]): Omit<Operation, 'id'> => ({ bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false })),
      ),
    }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)

    // 100 000 трат: продукты 60 % (ориентир 61), кафе 24 % (ориентир 4, +20), транспорт 16 % (ориентир 7, +9).
    const money_ = text(await screen(A.pinia, Money, '/money'))
    expect(money_).toContain('Траты кафе и рестораны выше нормы')
    expect(money_).toContain(`${text(money(100_000))} из ${text(plain(210_000))}`)
    // Доход 1 200 000, аренда 220 000 + кредитка 25 000 = 20 % — низкая.
    expect(money_).toContain('нагрузка низкая')
    expect(money_).toContain('Платежи 0 из 2 оплачено')

    const sheet = text(await screen(A.pinia, Money, '/money', undefined, [screenMixin({}, (s) => { void s.norms; s.open = true })]))
    // Суммы листа — те же, что строки «Истории» по разделам (свои операции месяца).
    const history = ops.all.filter((o) => o.date.startsWith(K))
    for (const [id, name] of [['sc_food', 'Продукты'], ['sc_cafe', 'Кафе и рестораны'], ['sc_transport', 'Транспорт']] as const) {
      const sum = history.filter((o) => o.categoryId === id).reduce((a, o) => a - o.amount, 0)
      expect(sheet).toContain(`${name} ${text(money(sum))}`)
    }
    expect(sheet).toContain(`Продукты ${text(money(60_000))} · 60 %`)
    expect(sheet).toContain(`Кафе и рестораны ${text(money(24_000))} · 24 %`)
    expect(sheet).toContain('Черта — обычная доля')
  })
})
