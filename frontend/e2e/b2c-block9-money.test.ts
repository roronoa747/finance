import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ComponentOptions } from 'vue'
import { createMemoryHistory } from 'vue-router'
import type { ApiClient } from '../src/api/client'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money, pct, plain } from '../src/lib/money'
import { deposit, freeByFact, planFact, untilPayday } from '../src/lib/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Payment } from '../src/types/finance'
import { screenMixin } from '../src/test/screenState'
import Money from '../src/views/Money.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 9 (пивот 3, «Деньги без лишнего»): два телефона на фейковом сервере. Часть 1 — сводка
 * «До зарплаты» и «Оплатил» из «Платежей»; часть 2 — квадрат «План»; часть 3 — «История» (раздел
 * задним числом, партнёр видит отметку, но не операцию); часть 4 — права viewer; часть 5 — старые адреса;
 * части 6–7 — сценарии приёмки со стенда (план «Еды и быта» у партнёра, лист вклада по адресу).
 * Нажатия — обработчиками компонентов (`screenMixin`), как в браузере; браузерная проверка — стенд §6.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

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
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

/** Синк: телефон отправил, другой забрал. */
async function sync(from: Phone, to: Phone) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  setActivePinia(to.pinia)
  await to.store.pullHousehold(to.client)
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')

/** Нажатие «Оплатил» в строке нужного платежа (`PaidRow` с этим `targetId`). */
const tapPaid = (targetId: string): ComponentOptions => ({
  created() {
    if (this.$props?.targetId === targetId && 'tap' in this.$.setupState) (this.$.setupState.tap as () => void)()
  },
})

describe('e2e / B2C Блок 9 — «Деньги без лишнего» на двух телефонах', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  // Август кредит оплачивали с карты — «Оплатил» сентября одним нажатием с того же счёта (Р-5).
  const august: Payment = {
    id: 'aug-loan', kind: 'credit', targetId: 'loan', period: '2026-08', amount: 58_000, accountId: 'card', by: 'a',
    at: '2026-08-15T05:00:00.000Z', updatedAt: '2026-08-15T05:00:00.000Z',
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-09-12T07:00:00Z') // 12 сентября: до зарплаты Аруны (20-го) 8 дней, впереди кредит 15-го
    server = fakeServer(planFamilyDoc({ payments: [august] }))
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('часть 1 — сводка: сумма = untilPayday().dueTotal; «Оплатил» из «Платежей» уменьшает K, партнёр видит ✓', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    setActivePinia(A.pinia)
    const p = untilPayday({ people: A.store.people, obligations: A.store.obligations, credits: A.store.credits, accounts: A.store.householdAccounts, payments: A.store.payments })!
    expect(p.due.map((d) => d.targetId)).toEqual(['loan'])
    expect(p.dueTotal).toBe(58_000)
    expect(text(await screen(A.pinia, Money, '/money'))).toContain(`До зарплаты 8 дней хватает 1 списание · ${plain(p.dueTotal)} ₸`)

    // A нажимает «Оплатил» у кредита в «Платежах» — одна отметка со счёта прошлой оплаты.
    await screen(A.pinia, Money, '/money', undefined, [tapPaid('loan')])
    expect(A.store.payments.filter((x) => x.kind === 'credit' && x.period === '2026-09' && !x.deletedAt)).toEqual([
      expect.objectContaining({ targetId: 'loan', amount: 58_000, accountId: 'card', by: 'a' }),
    ])
    expect(text(await screen(A.pinia, Money, '/money'))).toContain('Списаний нет')

    await sync(A, B)
    const b = text(await screen(B.pinia, Money, '/money'))
    expect(b).toContain('Списаний нет')
    expect(b).toContain(`Кредит 15-го · оплачено ${money(58_000)}`)
    expect(await screen(B.pinia, Money, '/money')).toContain('aria-label="Оплачено — подробнее"')
  })

  it('часть 2 — план: «Выбрать этот план» → переключатель включён у обоих; «Шаг сделан» → досрочка шага, прогноз и «уже сэкономили»', async () => {
    server.data.payments = [august, { ...august, id: 'aug-cc', targetId: 'cc', amount: 25_000 }]
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    expect(await screen(A.pinia, Money, '/money/plan')).toMatch(/role="switch" aria-checked="false"/)

    // «Выбрать этот план» в раскрытом «Копить или гасить?» (подушка — «Подушка»).
    await screen(A.pinia, Money, '/money/plan', undefined, [screenMixin({ cushionGoalId: 'cushion' }, (s) => (s.choose as () => void)())])
    setActivePinia(A.pinia)
    const plan = A.store.activePlan!
    expect(plan).toMatchObject({ cushionGoalId: 'cushion', creditIds: ['cc', 'loan'] })
    await sync(A, B)
    const before = await screen(B.pinia, Money, '/money/plan')
    expect(before).toMatch(/role="switch" aria-checked="true"/)
    expect(text(before)).toContain(`Шаг сентября ${money(100_000)} досрочно`)
    expect(text(before)).toContain(`Уже сэкономили ${money(0)}.`)

    // «Шаг сделан» у A — досрочка 100 000 в кредитку с карты, с id плана.
    await screen(A.pinia, Money, '/money/plan', undefined, [screenMixin({}, (s) => (s.tap as () => void)())])
    setActivePinia(A.pinia)
    const step = A.store.payments.find((x) => x.kind === 'prepay' && !x.deletedAt)!
    expect(step).toMatchObject({ targetId: 'cc', amount: 100_000, planId: plan.id, accountId: 'card' })
    await sync(A, B)
    setActivePinia(B.pinia)
    const saved = planFact(B.store.activePlan!, B.store.payments, B.store.credits).savedInterest
    expect(saved).toBeGreaterThan(0)
    const after = text(await screen(B.pinia, Money, '/money/plan'))
    expect(after).toContain(`внесено по плану · ${money(100_000)}`)
    expect(after).toContain(`Уже сэкономили ${money(saved)}.`)
    expect(after).not.toContain('Шаг сделан')
  })

  it('часть 3 — история: раздел задним числом меняет spendTotals и «Свободно»; партнёр видит отметку, не операцию', async () => {
    at('2026-09-24T07:00:00Z')
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const op = (date: string, amount: number, merchant: string): Omit<Operation, 'id'> => ({
      bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false,
    })
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-09-01', to: '2026-09-23', operations: assignIds([op('2026-09-20', -12_000, 'ТОО Непонятное')]), skipped: 0 }
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(A.client)
    await A.store.syncHousehold(A.client)
    // Аренду A отметил вручную — отметка семьи.
    A.store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })

    const fact = () => freeByFact({ ...A.store.householdDoc, credits: A.store.credits }, A.store.householdDoc.spendTotals ?? [], A.store.householdDoc.spendCategories ?? [], '2026-09', ops.uploads)
    const unknownBefore = (A.store.householdDoc.spendTotals ?? []).find((t) => t.kind === 'month' && t.categoryId === '_unknown')?.amount
    expect(unknownBefore).toBe(12_000)
    const freeBefore = fact().amount
    const historyA = text(await screen(A.pinia, Money, '/money/history'))
    expect(historyA).toContain(`ТОО Непонятное Не разобрано −${money(12_000)}`)

    // Раздел задним числом: «Подписки» — плановый раздел, из «Свободно» не вычитается (Р-22).
    const target = ops.all[0]
    await screen(A.pinia, Money, '/money/history', undefined, [
      screenMixin({ opOpen: target }, (s) => (s.recategorize as (to: unknown) => void)({ categoryId: 'sc_subscriptions' })),
    ])
    await Promise.resolve()
    const totals = A.store.householdDoc.spendTotals ?? []
    expect(totals.find((t) => t.kind === 'month' && t.categoryId === 'sc_subscriptions')?.amount).toBe(12_000)
    expect(totals.find((t) => t.kind === 'month' && t.categoryId === '_unknown' && t.amount > 0)).toBeUndefined()
    expect(fact().amount).toBe(freeBefore + 12_000)
    expect(text(await screen(A.pinia, Money, '/money/history'))).toContain(`ТОО Непонятное Подписки −${money(12_000)}`)

    await sync(A, B)
    const historyB = text(await screen(B.pinia, Money, '/money/history'))
    expect(historyB).toContain('Аренда оплачено · Ильяс')
    expect(historyB).not.toContain('ТОО Непонятное')
  })

  it('часть 4 — права: viewer на /money, /money/plan, /money/history — без «Оплатил», «Добавить», полей и активного переключателя', async () => {
    server.data.plans = [{
      id: 'plan', status: 'active', by: 'a', startedAt: '2026-09-10T05:00:00.000Z', endedAt: null, keptGoalIds: [], cushionGoalId: 'cushion',
      creditIds: ['cc', 'loan'], months: 24, lump: 0, forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null }, result: null, updatedAt: T0,
    }]
    const V = await phone(server, st, 'b', 'viewer')
    for (const path of ['/money', '/money/plan', '/money/history', '/money?add=debt', '/money?income=1']) {
      const html = await screen(V.pinia, Money, path)
      expect(html, path).not.toMatch(/>\s*Оплатил\s*</)
      expect(html, path).not.toMatch(/>\s*(<svg[\s\S]*?<\/svg>\s*)?Добавить( счёт)?\s*</)
      expect(html, path).not.toMatch(/>\s*Шаг сделан\s*</)
      // Поля записи — нет; калькулятор «Копить или гасить?» в «Плане» — расчёт без записи, его переключатели остаются.
      if (path !== '/money/plan') expect(html, path).not.toContain('<input')
      expect(html, path).not.toMatch(/>\s*Выбрать этот план\s*</)
      if (path === '/money/plan') expect(html).toMatch(/role="switch" aria-checked="true"[^>]*\sdisabled(=""|\s|>)/)
    }
  })

  it('часть 6 (приёмка) — план «Еды и быта» из листа виден партнёру; доли «Дохода» = прежний Бюджет', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const before = text(await screen(A.pinia, Money, '/money'))
    // Нагрузка — жильё 220 000 + кредиты 103 000 от дохода 1 200 000 (формула «вместе с жильём» Бюджета).
    expect(before).toContain(`нагрузка ${pct(220_000 + 58_000 + 25_000 + 20_000, 1_200_000)} %`)
    expect(before).toContain(`еда и быт ${pct(150_000, 1_200_000)} %`)

    // A правит план в листе виджета (поле `NumFieldBlur` → `commit`).
    const editLiving: ComponentOptions = {
      created() {
        const s = this.$.setupState
        if ('living' in s && 'commit' in s) (s.commit as (t: string) => void)('222 000')
      },
    }
    await screen(A.pinia, Money, '/money', undefined, [editLiving])
    await sync(A, B)
    const b = text(await screen(B.pinia, Money, '/money'))
    expect(b).toContain(`план ${plain(222_000)}`)
    expect(b).toContain(`еда и быт ${pct(222_000, 1_200_000)} %`)
  })

  it('часть 7 (приёмка) — лист вклада по адресу: условия и расчёт `deposit()`', async () => {
    const dep = { annualRate: 0.14, months: 12, monthlyTopUp: 50_000, capitalize: true }
    server.data.accounts = [...server.data.accounts, { id: 'dep', name: 'Депозит', note: '', amount: 1_200_000, amountSetAt: T0, kind: 'deposit', updatedAt: T0, deposit: dep }]
    const A = await phone(server, st, 'a')
    const r = deposit({ principal: 1_200_000, ...dep })
    const html = text(await screen(A.pinia, Money, '/money?account=dep'))
    expect(html).toContain('Депозит 14 % · общий')
    expect(html).toContain(`Будет на счёте через 12 мес. ${money(Math.round(r.future))}`)
    expect(html).toContain(`Начислено процентов ${money(Math.round(r.interest))}`)
    expect(html).toContain(`Ваши взносы ${money(r.contributed)}`)
    expect(html).not.toContain('Заработал банк')
  })

  it('часть 5 — старые адреса с query ведут в квадраты и листы', async () => {
    const router = createAppRouter(createMemoryHistory())
    const cases: [string, string][] = [
      ['/budget', '/money'],
      ['/capital?credit=loan', '/money?credit=loan'],
      ['/capital/dep', '/money?account=dep'],
      ['/money/capital/dep?x=1', '/money?x=1&account=dep'],
      ['/money/budget?add=payment', '/money?add=payment'],
      ['/capital?advice=strategy', '/money/plan'],
      ['/plan', '/money/plan'],
    ]
    for (const [from, to] of cases) {
      await router.push(from)
      expect(router.currentRoute.value.fullPath, from).toBe(to)
    }
  })
})
