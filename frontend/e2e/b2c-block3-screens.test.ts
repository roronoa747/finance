import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { money } from '../src/lib/money'
import { budgetAmounts, duesTotal, monthDues } from '../src/lib/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import type { SyncDoc } from '../src/types/finance'
import type { SpendTotal } from '../src/lib/statements/types'
import type { OperationWire } from '../src/types/api'
import Dreams from '../src/views/Dreams.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 3 B2C — экраны и лёгкий флоу. Часть 1 (B2C-14): главный «Мечты» у семьи с
 * планом и итогами выписок — процент героя, «Свободно» по факту (посчитано руками), карточка
 * решения ведёт на «Неделю». Части 2–5 — B2C-15, B2C-18, B2C-19, B2C-21.
 */
type Phone = { pinia: Pinia; client: ApiClient; user: string }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${slot}`, user: { id: user, email: `${slot}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, user }
}

const total = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: T0,
})

describe('e2e / B2C Блок 3 — часть 1: главный «Мечты» (B2C-14)', () => {
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
    at('2026-09-17T07:00:00Z') // четверг, ISO-неделя 2026-W38 (14–20 сентября)
    // Семья с планом месяца: Ильяс a / Дана b; главная мечта — «Машина» (200 000 из 3 000 000).
    const doc: SyncDoc = planFamilyDoc({
      goals: planFamilyDoc().goals.map((g) => (g.id === 'car' ? { ...g, main: true } : g)),
      spendTotals: [
        total('a', 'week', '2026-W38', 'sc_food', 62_000),
        total('b', 'week', '2026-W38', 'sc_food', 20_000),
        total('a', 'week', '2026-W38', 'sc_cafe', 28_000),
        total('a', 'week', '2026-W38', '_unknown', 10_000),
        total('a', 'month', '2026-09', 'sc_food', 184_000),
        total('b', 'month', '2026-09', 'sc_food', 40_000),
        total('a', 'month', '2026-09', 'sc_credit', 58_000),
        total('a', 'month', '2026-09', '_unknown', 40_000),
      ],
    })
    doc.people[1].name = 'Дана'
    server = fakeServer(doc)
    st = fakeStatements()
    // Загрузки обоих покрывают неделю и месяц; у Ильяса — незнакомый продавец этой недели.
    for (const [slot, user, id] of [['a', 'u-a', '1'], ['b', 'u-b', '2']] as const) {
      st.uploads.push({ id: `00000000-0000-4000-8000-00000000000${id}`, slot, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-17', ops_count: 10, created_at: T0, user })
    }
    const op: OperationWire = { id: 'op-1', bank: 'kaspi', date: '2026-09-16', amount: -10_000, kind: 'purchase', merchant: 'IP SERIKOV', category_id: null, internal: false, updated_at: T0 }
    st.ops.set('u-a', new Map([[op.id, op]]))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('герой 7 % и «будет вашей в июле 2030»; картина недели по обоим; «Свободно» сходится с ручным расчётом; решение — незнакомый продавец → /week', async () => {
    const A = await phone(server, st, 'a')
    const html = await screen(A.pinia, Dreams, '/')

    // Герой: 200 000 / 3 000 000 = 7 %; по 60 000 в месяц — 47 взносов с сентября 2026 → июль 2030.
    expect(html).toContain('До мечты')
    expect(html).toContain('7 %')
    expect(html).toContain(`Машина · 200 000 из ${money(3_000_000)} · будет вашей в июле 2030`)

    // Неделя: 62 000 + 20 000 продукты, 28 000 кафе, 10 000 не разобрано = 120 000, обе выписки.
    expect(html).toContain('Эта неделя · 14–20 сентября')
    expect(html).toContain(money(120_000))
    expect(html).toContain('по выпискам обоих')
    expect(html).toContain(money(82_000))
    expect(html).toContain(`не разобрано ${money(10_000)}`)

    // «Свободно до конца месяца» руками: доход 1 200 000 − платежи сентября (аренда 220 000 +
    // кредит 58 000 + кредитка 25 000 + рассрочка 20 000 = 323 000) − взносы в цели 130 000 −
    // траты по выпискам (продукты 224 000 + не разобрано 40 000; кредит 58 000 уже в плане) = 483 000.
    setActivePinia(A.pinia)
    const s = useFinanceStore()
    const state = { ...s.householdDoc, credits: s.credits }
    expect(duesTotal(monthDues(state, '2026-09'))).toBe(323_000)
    expect(budgetAmounts(state).d3).toBe(130_000)
    expect(html).toContain(money(483_000))
    expect(html).toContain('по факту выписок обоих · 3 дня до зарплаты · Дана')

    // Ближайшее решение — незнакомый продавец недели (10 000 ₸), ведёт на «Неделю».
    expect(html).toContain('Не разобрано: 1 продавец')
    expect(html).toContain(`${money(10_000)} за неделю`)
    expect(html).toContain('>Разобрать<')
    let vm: Record<string, any> = {}
    const grab = { created(this: any) { if ('onPrimary' in this.$.setupState) vm = this.$.setupState } }
    await screen(A.pinia, Dreams, '/', undefined, [grab])
    expect(vm.shown?.kind).toBe('unknown')
    expect(vm.shown?.to).toBe('/week')

    // У Даны незнакомых нет (операции личные) — её решение: зарплата 20-го через 3 дня → «пришла?».
    const B = await phone(server, st, 'b')
    const htmlB = await screen(B.pinia, Dreams, '/')
    expect(htmlB).toContain(money(483_000))
    expect(htmlB).not.toContain('Не разобрано:')
    expect(htmlB).toContain('Пришла зарплата Дана?')

    // viewer видит герой и цифры, но без решений и «Новой мечты».
    const V = await phone(server, st, 'b', 'viewer')
    const htmlV = await screen(V.pinia, Dreams, '/')
    expect(htmlV).toContain('7 %')
    expect(htmlV).toContain(money(483_000))
    expect(htmlV).not.toContain('Пришла зарплата')
    expect(htmlV).not.toContain('Новая мечта')
  })
})
