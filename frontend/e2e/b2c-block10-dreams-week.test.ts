import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds, spendTotals } from '../src/lib/statements/model'
import type { Operation, ParsedStatement, SpendTotal } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { weekKey } from '../src/lib/dates'
import { freeByFact, untilPayday, weekPicture, type Decision } from '../src/lib/finance'
import { planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Access from '../src/views/Access.vue'
import Dreams from '../src/views/Dreams.vue'
import Money from '../src/views/Money.vue'
import Statements from '../src/views/Statements.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 10 (пивот 3, «Мечты и Неделя»): два телефона на фейковом сервере. Часть 1 — «Мечты»: строка
 * «Свободно» = `freeByFact`, недельного нет; часть 2 — одна очередь «Недели»: ответ на продавца у A → итоги и
 * «Свободно» у B пересчитались, «N из M» растёт; часть 3 — «Свободно» одно (сводка «Денег» — «останется на
 * счетах», «Доход» — «остаток по плану»); часть 4 — viewer без решений и загрузки; часть 5 — демо: итоги недели
 * из демо-операций той же функцией, что разбор. Нажатия — обработчиками компонентов (`screenMixin`).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? `u-v` : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

async function sync(from: Phone, to: Phone) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  setActivePinia(to.pinia)
  await to.store.pullHousehold(to.client)
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const op = (date: string, amount: number, merchant: string, categoryId: string | null = null): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
})

/** Выписка A за сентябрь: продукты, кафе и два незнакомых продавца на этой неделе (21–27 сентября). */
async function uploadA(A: Phone) {
  const parsed: ParsedStatement = {
    bank: 'kaspi', from: '2026-09-01', to: '2026-09-24', skipped: 0,
    operations: assignIds([
      op('2026-09-15', -30_000, 'Magnum', 'sc_food'),
      op('2026-09-22', -18_000, 'Magnum', 'sc_food'),
      op('2026-09-23', -6_000, 'Coffee Boom', 'sc_cafe'),
      op('2026-09-23', -12_000, 'ТОО Непонятное'),
      op('2026-09-24', -4_000, 'ИП Жансая'),
    ]),
  }
  setActivePinia(A.pinia)
  const ops = useOperationsStore()
  ops.setDraft([{ name: 'выписка.pdf', parsed }])
  await ops.send(A.client)
  await A.store.syncHousehold(A.client)
  return ops
}

const fact = (p: Phone) => {
  setActivePinia(p.pinia)
  const ops = useOperationsStore()
  return freeByFact({ ...p.store.householdDoc, credits: p.store.credits }, p.store.householdDoc.spendTotals ?? [], p.store.householdDoc.spendCategories ?? [], '2026-09', ops.uploads)
}

describe('e2e / B2C Блок 10 — «Мечты и Неделя» на двух телефонах', () => {
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
    at('2026-09-24T07:00:00Z') // четверг 24 сентября: неделя 21–27, до зарплаты Ильяса (10-го) — 16 дней
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('часть 1 — «Мечты»: строка «Свободно» = freeByFact у обоих, недельного нет', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    for (const p of [A, B]) {
      const html = text(await screen(p.pinia, Dreams, '/'))
      const free = fact(p)
      expect(free.byFact).toBe(true)
      expect(html).toContain(`Свободно ${text(money(free.amount))}`)
      for (const w of ['Итог недели', 'куда отнести', 'Загрузить выписку', 'Пришла зарплата', 'Не разобрано']) expect(html).not.toContain(w)
    }
  })

  it('часть 2 — очередь: одно решение за раз, ответ на продавца у A → «2 из 2», итоги и «Свободно» у B пересчитались', async () => {
    const A = await phone(server, st, 'a')
    const ops = await uploadA(A)
    const B = await phone(server, st, 'b')
    const before = fact(B).amount

    const html = await screen(A.pinia, Statements, '/week')
    expect(text(html)).toContain('1 из 2')
    expect(html.match(/<h2 class="type-h2 text-ink">/g)).toHaveLength(1)
    expect(text(html)).toContain('ТОО Непонятное — куда отнести?')

    // Ответ чипом «Подписки» (плановый раздел — из «Свободно» не вычитается): карточка — следующий продавец, «2 из 2».
    let after = ''
    const answered = await screen(A.pinia, Statements, '/week', undefined, [
      screenMixin({}, (s) => {
        const d = s.decision as Decision
        ;(s.answerUnknown as (g: unknown, to: unknown) => void)(d.group, { categoryId: 'sc_subscriptions' })
      }),
    ])
    after = text(answered)
    expect(after).toContain('ИП Жансая — куда отнести?')
    expect(after).toContain('2 из 2')
    expect(after).not.toContain('1 из 1')
    await vi.runOnlyPendingTimersAsync()
    await ops.flush(A.client)

    await sync(A, B)
    const week = (B.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W39' && t.amount > 0)
    expect(week.find((t) => t.categoryId === 'sc_subscriptions')?.amount).toBe(12_000)
    expect(week.find((t) => t.categoryId === '_unknown')?.amount).toBe(4_000)
    expect(fact(B).amount).toBe(before + 12_000)
    expect(text(await screen(B.pinia, Dreams, '/'))).toContain(`Свободно ${text(money(before + 12_000))}`)
    // На «Неделе» B — та же картина обоих: «Не разобрано» — 4 000.
    expect(text(await screen(B.pinia, Statements, '/week'))).toContain(`Не разобрано · ${text(money(4_000))}`)
  })

  it('часть 3 — «Свободно» одно: сводка «Денег» — «останется на счетах», «Доход» — «остаток по плану»; числа прежние', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    setActivePinia(A.pinia)
    const p = untilPayday({ people: A.store.people, obligations: A.store.obligations, credits: A.store.credits, accounts: A.store.householdAccounts, payments: A.store.payments })!
    const money_ = text(await screen(A.pinia, Money, '/money'))
    expect(money_).toContain(`останется на счетах ${text(money(p.shortfall))}`)
    expect(money_).toContain('остаток по плану')
    expect(money_.toLowerCase()).not.toContain('свободно')
    // Слово с числом — только на «Мечтах».
    expect(text(await screen(A.pinia, Dreams, '/'))).toContain('Свободно ')
  })

  it('часть 4 — viewer: «Мечты» и «Неделя» без решений, загрузки и брендовых кнопок; картина недели видна', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const V = await phone(server, st, 'b', 'viewer')
    const week = await screen(V.pinia, Statements, '/week')
    expect(text(week)).toContain('Итог недели')
    for (const w of ['куда отнести', 'Загрузить выписку', 'из 2']) expect(text(week)).not.toContain(w)
    expect(week).not.toContain('type-h2')
    expect(week).not.toContain('bg-brand text-brand-ink')
    const dreams = text(await screen(V.pinia, Dreams, '/'))
    for (const w of ['куда отнести', 'Загрузить выписку', '+ Новая', 'Добавить фото']) expect(dreams).not.toContain(w)
  })

  it('часть 5 — демо: итоги недели Ильяса = spendTotals демо-операций; сумма недели = операции + итоги Аруны; два решения', async () => {
    const pinia = createPinia()
    await screen(pinia, Access, '/access', undefined, [screenMixin({}, (s) => (s.startDemoMode as () => void)())])
    await nextTick()
    setActivePinia(pinia)
    const finance = useFinanceStore()
    const ops = useOperationsStore()
    const week = weekKey()
    const mine = (finance.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === week && t.amount > 0)
    const strip = (list: SpendTotal[]) => list.map(({ categoryId, amount }) => ({ categoryId, amount }))
    expect(strip(mine)).toEqual(strip(spendTotals(ops.all, 'a', 'week', week)))
    const pic = weekPicture(finance.householdDoc.spendTotals ?? [], finance.householdDoc.spendCategories ?? [], finance.people, week, ops.uploads)
    const opsWeek = ops.all.filter((o) => !o.internal && o.amount < 0 && weekKey(o.date) === week).reduce((a, o) => a - o.amount, 0)
    const aruna = (finance.householdDoc.spendTotals ?? []).filter((t) => t.by === 'b' && t.kind === 'week' && t.period === week).reduce((a, t) => a + t.amount, 0)
    expect(pic.total).toBe(opsWeek + aruna)
    const html = text(await screen(pinia, Statements, '/week'))
    expect(html).toContain(`Итог недели ${text(money(pic.total))}`)
    expect(html).toContain('1 из 2')
    expect(html).toContain('ИП Абенова — куда отнести?')
    // «История» демо — те же операции недели.
    expect(text(await screen(pinia, Money, '/money/history'))).toContain('ИП Абенова')
  })
})
