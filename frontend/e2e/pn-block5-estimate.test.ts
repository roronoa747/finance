import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { startDemo } from '../src/lib/demo'
import { canAfford, creditOutlook, monthPlan, monthsBetween, tryCredit } from '../src/lib/finance'
import { monthKey } from '../src/lib/dates'
import { money } from '../src/lib/money'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

/**
 * Блок 5 «понятность» (PN-16…PN-18), 12 октября 2026: (а) демо — «Прикинуть кредит» на условиях автокредита демо
 * (1 800 000 под 19 %, срок — сколько платежей ему осталось) даёт нагрузку = (платежи месяца + платёж) / доход и сдвиг
 * «Поездки в Японию» = разнице `doneMonth` плана с этим кредитом и без; (б) «Хватит?» на демо — «Да» с остатком до
 * зарплаты, большая сумма — «Нет» с днями; (в) после обоих листов документ прежний — rev, «не отправлено» и сервер те же;
 * (г) viewer — «Прикинуть кредит» с «Долгов». Экраны — SSR (`screen`), ввод — полями листов (`screenMixin`).
 */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('e2e / понятность Блок 5 — прикинуть', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function demo() {
    const pinia = createPinia()
    setActivePinia(pinia)
    startDemo()
    await nextTick()
    setActivePinia(pinia)
    return { pinia, finance: useFinanceStore() }
  }

  it('(а) демо: автокредит в «Прикинуть кредит» — нагрузка и сдвиг «Поездки в Японию» = план с кредитом и без', async () => {
    const { pinia, finance } = await demo()
    const key = monthKey()
    const car = finance.credits.find((c) => c.id === 'cr-car')!
    const months = creditOutlook(car).months
    expect(Number.isFinite(months)).toBe(true)
    const { state, ctx } = finance.planInput(key)
    const r = tryCredit(state, ctx, { principal: car.principal, months, annualRate: car.annualRate })

    // Нагрузка — руками от плана месяца.
    const plan = monthPlan(state, ctx)
    expect(r.loadNowPct).toBe(Math.round((plan.duesTotal / plan.income.total) * 100))
    expect(r.loadPct).toBe(Math.round(((plan.duesTotal + r.payment) / plan.income.total) * 100))

    // Сдвиг героя — тот же план с ещё одним таким кредитом в платежах.
    const twin = { ...car, id: 'twin', principal: car.principal, payment: r.payment }
    const after = monthPlan({ ...state, credits: [...state.credits!, twin] }, ctx)
    const trip = (p: typeof plan) => p.queue.find((q) => q.goalId === 'g-trip')!.doneMonth
    expect(r.hero?.name).toBe('Поездка в Японию')
    expect(r.hero!.doneBefore).toBe(trip(plan))
    expect(r.hero!.doneAfter).toBe(trip(after))
    expect(r.hero!.delayMonths).toBe(monthsBetween(trip(plan)!, trip(after)!))
    // Япония — первая в очереди: свободного остатка демо хватает на её взнос и с этим кредитом — срок прежний
    // («не сдвинется»), сдвигаются цели ниже. Число — то, что даёт план.
    expect(r.hero!.delayMonths).toBe(0)
    // Крупный кредит (5 000 000 на 12 месяцев под 19 %) съедает остаток выше её взноса — тогда она отодвигается, на столько
    // же, сколько даёт план с ним.
    const big = tryCredit(state, ctx, { principal: 5_000_000, months: 12, annualRate: 0.19 })
    const bigPlan = monthPlan({ ...state, credits: [...state.credits!, { ...car, id: "big", principal: 5_000_000, payment: big.payment }] }, ctx)
    expect(big.hero!.doneAfter).toBe(trip(bigPlan))
    expect(big.hero!.delayMonths).toBe(monthsBetween(trip(plan)!, trip(bigPlan)!))
    expect(big.hero!.delayMonths).toBeGreaterThan(0)

    // Лист на «Долгах» (вход из «+»): те же числа на экране.
    const html = text(
      await screen(pinia, Money, '/money/debts?try=1', undefined, [screenMixin({ sum: String(car.principal), term: 'own', ownTerm: String(months), rate: '19' })]),
    )
    expect(html).toContain(text(money(r.payment)))
    expect(html).toContain(`Нагрузка станет ${r.loadPct} % дохода · сейчас ${r.loadNowPct} %`)
    expect(html).toContain(r.hero!.delayMonths ? `Поездка в Японию отодвинется на ${r.hero!.delayMonths}` : "Поездка в Японию не сдвинется")
  })

  it('(б) демо: «Хватит?» — «Да» с остатком до зарплаты; большая сумма — «Нет» с днями', async () => {
    const { pinia, finance } = await demo()
    const { state, ctx } = finance.planInput(monthKey())
    const input = { ...state, accounts: finance.householdAccounts }
    const yes = canAfford(input, ctx, 20_000)
    expect(yes.ok).toBe(true)
    if (!yes.ok) return
    const okHtml = text(await screen(pinia, Month, '/month?afford=1', undefined, [screenMixin({ sum: '20000' })]))
    expect(okHtml).toContain('Да')
    expect(okHtml).toContain(`до зарплаты останется ${text(money(yes.left))}`)

    const no = canAfford(input, ctx, 50_000_000)
    expect(no.ok).toBe(false)
    if (no.ok) return
    expect(no.goal).toBe('Поездка в Японию')
    expect(no.days).toBeGreaterThan(0)
    const noHtml = text(await screen(pinia, Month, '/month?afford=1', undefined, [screenMixin({ sum: '50000000' })]))
    expect(noHtml).toContain(`не хватает ${text(money(no.short))}`)
    expect(noHtml).toContain(`Поездка в Японию отодвинется на ${no.days}`)
  })

  describe('семья на сервере', () => {
    let server: FakeServer
    beforeEach(() => {
      server = fakeServer(planFamilyDoc())
    })

    async function as(role: 'member' | 'viewer') {
      const p = await phone(server)
      setActivePinia(p.pinia)
      useAuthStore().setAuthData(authAs(role, role === 'viewer' ? 'b' : 'a'))
      return p
    }

    it('(в) после обоих листов документ прежний: rev, «не отправлено» и сервер — те же', async () => {
      const A = await as('member')
      const before = { doc: JSON.stringify(A.store.householdDoc), rev: A.store.householdRev, unsent: A.store.hasUnsent, server: server.rev }
      expect(before.unsent).toBe(false)
      await screen(A.pinia, Money, '/money/debts?try=1', undefined, [screenMixin({ sum: '1000000', term: 24, rate: '20' })])
      await screen(A.pinia, Month, '/month?afford=1', undefined, [screenMixin({ sum: '150000' })])
      setActivePinia(A.pinia)
      expect(JSON.stringify(A.store.householdDoc)).toBe(before.doc)
      expect(A.store.householdRev).toBe(before.rev)
      expect(A.store.hasUnsent).toBe(false)
      expect(server.rev).toBe(before.server)
    })

    it('(г) viewer: на «Долгах» тихое «Прикинуть кредит» без «+ Долг»; лист считает так же', async () => {
      const V = await as('viewer')
      const plain = await screen(V.pinia, Money, '/money/debts')
      expect(plain).toContain('data-try-credit')
      expect(plain).not.toContain('data-add-credit')
      const html = text(await screen(V.pinia, Money, '/money/debts?try=1', undefined, [screenMixin({ sum: '1000000', term: 24, rate: '20' })]))
      setActivePinia(V.pinia)
      const { state, ctx } = V.store.planInput(monthKey())
      const r = tryCredit(state, ctx, { principal: 1_000_000, months: 24, annualRate: 0.2 })
      expect(html).toContain(text(money(r.payment)))
      expect(html).toContain(`Нагрузка станет ${r.loadPct} % дохода`)
    })
  })
})
