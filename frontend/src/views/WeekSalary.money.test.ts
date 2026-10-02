import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { accountBalance, budgetAmounts, emergencyCoverage, lumpPlan, planMandatory, salaryFree, stepDue } from '@/lib/finance'
import { monthFrom } from '@/lib/dates'
import { money } from '@/lib/money'
import WeekSalary from './WeekSalary.vue'
import type { Obligation, Payment, SyncDoc } from '@/types/finance'
import { T0, authAs, planFamilyDoc, planOf } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'

/**
 * Денежные ветки раскладки (критик Блока 3): разовая досрочка и шаг плана, счёт досрочки,
 * досрочка больше остатка долга, записанная раскладка остатка и освободившегося платежа,
 * годовое обязательство, подушка у разового решения, тексты по правилу 12.
 */
describe('WeekSalary — денежные ветки раскладки', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, val: string) => storage.set(key, String(val)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  function family(extra: Partial<SyncDoc> = {}) {
    useAuthStore().setAuthData(authAs('member', 'a'))
    const store = useFinanceStore()
    store.setHouseholdDoc(planFamilyDoc(extra), 1)
    return store
  }
  const salaryPath = '/week/salary?from=salary&person=a&period=2026-09'
  const markSalary = (store: ReturnType<typeof useFinanceStore>) =>
    store.markSalary('a', { period: '2026-09', amount: 700_000, accountId: 'card' })
  /** Раскладка `alloc` (остаток — «на себя»), счёт `picked`, «Подтвердить» — html итога. */
  const decide = (path: string, alloc: Record<string, number>, picked?: string | null) =>
    renderScreen(WeekSalary, path, undefined, [
      screenMixin({}, (s) => {
        const rest = (s.total as number) - Object.values(alloc).reduce((a, v) => a + v, 0)
        s.alloc = rest > 0 ? { ...alloc, life: rest } : alloc
        if (picked !== undefined) s.picked = picked
        ;(s.confirm as () => void)()
      }),
    ])

  // Аренда подешевеет с июня 2027 на 50 000 — освободившийся платёж обязательства.
  const rentDown: Obligation = {
    id: 'ob-rent', name: 'Аренда квартиры', note: '', day: 5, category: 'd1', updatedAt: T0,
    versions: [{ from: '2026-01', amount: 250_000 }, { from: '2027-06', amount: 200_000 }],
  }

  it('критик возврата: зарплата прошлого месяца раскладывается по плану её месяца — сентябрьская прибавка к августовской не приписывается', async () => {
    const doc = planFamilyDoc()
    doc.people = doc.people.map((p) => (p.id === 'a' ? { ...p, salaryVersions: [{ from: '2026-09', amount: 800_000 }] } : p))
    useAuthStore().setAuthData(authAs('member', 'a'))
    const store = useFinanceStore()
    store.setHouseholdDoc(doc, 1)
    store.markSalary('a', { period: '2026-08', amount: 700_000, accountId: 'card' })
    const record = store.payments.find((p) => p.kind === 'salary' && p.period === '2026-08')!
    let total = -1
    await renderScreen(WeekSalary, '/week/salary?from=salary&person=a&period=2026-08', undefined, [
      screenMixin({}, (s) => {
        total = s.total as number
      }),
    ])
    const state = { ...store.householdDoc, credits: store.credits }
    expect(total).toBe(salaryFree(budgetAmounts(state, '2026-08').d5, store.people, record))
    expect(total).toBeLessThan(salaryFree(budgetAmounts(state, '2026-09').d5, store.people, record))
  })

  describe('money-1: разовая досрочка и шаг плана «Сначала долги»', () => {
    it('шаг месяца не внесён — досрочка из зарплаты без id плана: шаг остаётся к оплате, цели на паузе не тронуты; эффект — от добавки', async () => {
      const store = family({ plans: [planOf({ lump: 50_000 })] })
      markSalary(store)
      const due = stepDue(store.planStepNow())!
      expect(due).toMatchObject({ creditId: 'cc' })

      const cc = store.credits.find((c) => c.id === 'cc')!
      const lp = lumpPlan(cc.principal, cc.annualRate, cc.payment, 10_000, 'term')!
      const html = await renderScreen(WeekSalary, salaryPath, undefined, [screenMixin({ alloc: { plan: 10_000 } })])
      expect(html).toContain(`${money(10_000)} в «Кредитка»: платежей останется ${lp.months} вместо ${lp.monthsBefore}`)
      expect(html).not.toContain(`Шаг плана — ${money(due.amount + 10_000)}`)

      await decide(salaryPath, { plan: 10_000 }, 'card')
      const prepay = store.payments.find((p) => p.kind === 'prepay')!
      expect(prepay).toMatchObject({ targetId: 'cc', amount: 10_000, accountId: 'card' })
      expect(prepay.planId).toBeUndefined()
      expect(stepDue(store.planStepNow())).toMatchObject({ creditId: 'cc', amount: due.amount })
      // «Вложить накопленное» плана не сработало: с целей на паузе ничего не снято.
      expect(store.goals.flatMap((g) => g.movements ?? []).filter((m) => m.planId)).toEqual([])
    })

    it('шаг месяца уже внесён — разовая досрочка идёт с id плана и прибавляется к шагу', async () => {
      const store = family({ plans: [planOf()] })
      markSalary(store)
      const step = store.applyPlanStep('a', { accountId: 'card' })!
      expect(step).toMatchObject({ planId: 'plan' })

      await decide(salaryPath, { plan: 10_000 }, 'card')
      const added = store.payments.filter((p) => p.kind === 'prepay' && p.id !== step.id)
      expect(added).toHaveLength(1)
      expect(added[0]).toMatchObject({ targetId: 'cc', amount: 10_000, planId: 'plan' })
      expect(store.planStepNow()).toMatchObject({ kind: 'prepay', amount: step.amount + 10_000 })
    })
  })

  it('money-5: остаток без отметок зарплаты, всё в досрочку — без счёта не вносится; после выбора — prepay с этим счётом', async () => {
    const store = family()
    const path = '/week/salary?from=rest&amount=100000&period=2026-09'
    const blocked = await decide(path, { credit: 100_000 })
    expect(blocked).toContain('Откуда внести досрочку')
    expect(blocked).toContain('Выберите, откуда отложить')
    expect(store.payments).toEqual([])
    expect(store.allocations).toEqual([])

    const done = await decide(path, { credit: 100_000 }, 'card')
    expect(done).toContain(`Досрочка ${money(100_000)} внесена в «Кредитка»`)
    expect(store.payments.find((p) => p.kind === 'prepay')).toMatchObject({ targetId: 'cc', amount: 100_000, accountId: 'card' })
    expect(accountBalance(store.householdDoc.accounts[0], store.payments)).toBe(2_000_000 - 100_000)
  })

  it('money-7: разовая досрочка не больше остатка долга — «+» упирается в остаток; внесено меньше корзины — в итог и запись внесённое, в закрытый долг', async () => {
    const store = family()
    const path = '/week/salary?from=rest&amount=400000&period=2026-09'
    let got: Record<string, unknown> = {}
    await renderScreen(WeekSalary, path, undefined, [
      screenMixin({}, (s) => {
        for (let i = 0; i < 40; i++) (s.set as (id: string, d: number) => void)('credit', 10_000)
        got = { credit: (s.alloc as Record<string, number>).credit, left: s.left }
      }),
    ])
    expect(got).toEqual({ credit: 300_000, left: 100_000 })
    const full = await renderScreen(WeekSalary, path, undefined, [screenMixin({ alloc: { credit: 300_000 } })])
    const pot = (name: string, next: string) => full.slice(full.indexOf(`>${name}<`), full.indexOf(`>${next}<`))
    expect(pot('Досрочно по кредиту', 'Качество жизни')).toMatch(/aria-label="Прибавить" disabled /)
    expect(full.slice(full.indexOf('>Качество жизни<'))).not.toMatch(/aria-label="Прибавить" disabled /)

    // Корзина больше остатка (долг изменился после раскладки) — внесено 300 000, долг закрыт.
    const done = await decide(path, { credit: 400_000 }, 'card')
    expect(store.credits.find((c) => c.id === 'cc')!.principal).toBe(0)
    expect(done).toContain(`Досрочка ${money(300_000)} внесена в «Кредитка»`)
    expect(store.allocations[0].parts).toEqual([{ target: 'prepay:cc', amount: 300_000 }])
  })

  it('money-7: две корзины досрочки («по кредиту» и «по плану») платят один долг — потолок на их сумму', async () => {
    family({ plans: [planOf()] })
    const path = '/week/salary?from=rest&amount=400000&period=2026-09'
    let got: Record<string, number> = {}
    await renderScreen(WeekSalary, path, undefined, [
      screenMixin({}, (s) => {
        const set = s.set as (id: string, d: number) => void
        for (let i = 0; i < 20; i++) set('credit', 10_000)
        for (let i = 0; i < 20; i++) set('plan', 10_000)
        const a = s.alloc as Record<string, number>
        got = { credit: a.credit ?? 0, plan: a.plan ?? 0 }
      }),
    ])
    // Остаток «Кредитки» 300 000: 200 000 уже в «по кредиту» — в «по плану» влезает 100 000.
    expect(got).toEqual({ credit: 200_000, plan: 100_000 })
  })

  describe('money-2 / tests-9: записанная раскладка по источнику и периоду', () => {
    // «Рассрочка» закрыта последним платежом 25 сентября — освободилось 20 000 в месяц.
    const closedInst = (): Partial<SyncDoc> => {
      const close: Payment = {
        id: 'close', kind: 'credit', targetId: 'inst', period: '2026-09', amount: 20_000, principal: 20_000, accountId: 'card',
        by: 'b', at: '2026-09-25T05:00:00.000Z', updatedAt: '2026-09-25T05:00:00.000Z',
      }
      return { credits: planFamilyDoc().credits.map((c) => (c.id === 'inst' ? { ...c, principal: 20_000 } : c)), payments: [close] }
    }

    it('закрытый долг: запись — за месяц закрытия; в следующем месяце — «Уже разложено», взнос не растёт второй раз', async () => {
      vi.setSystemTime(new Date('2026-09-26T07:00:00Z'))
      const store = family(closedInst())
      const path = '/week/salary?from=credit&credit=inst'
      await decide(path, { car: 20_000 })
      expect(store.allocations[0]).toMatchObject({ source: 'freed', sourceId: 'inst', period: '2026-09', total: 20_000 })
      expect(store.goals.find((g) => g.id === 'car')!.monthly).toBe(80_000)

      vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
      const october = await renderScreen(WeekSalary, path)
      expect(october).toContain('Уже разложено')
      expect(october).not.toContain('Осталось распределить')
      expect(store.goals.find((g) => g.id === 'car')!.monthly).toBe(80_000)
    })

    it('остаток: запись {rest, период}; второй заход — «Уже разложено»; другой месяц — раскладка', async () => {
      const store = family()
      const path = '/week/salary?from=rest&amount=40000&period=2026-09'
      await decide(path, { trip: 40_000 }, 'card')
      expect(store.allocations).toHaveLength(1)
      expect(store.allocations[0]).toMatchObject({
        source: 'rest', sourceId: '2026-09', period: '2026-09', total: 40_000, parts: [{ target: 'trip', amount: 40_000 }],
      })
      const again = await renderScreen(WeekSalary, path)
      expect(again).toContain('Уже разложено')
      expect(again).not.toContain('Подтвердить распределение')
      expect(await renderScreen(WeekSalary, '/week/salary?from=rest&amount=40000&period=2026-08')).toContain('Осталось распределить')
    })

    it('освободившийся платёж: запись {freed, обязательство, месяц снижения}; зарплата без отметки не видит её, с отметкой — без абзаца обязательства', async () => {
      const store = family({ obligations: [rentDown] })
      const done = await decide('/week/salary?from=freed', { trip: 50_000 })
      expect(store.allocations[0]).toMatchObject({ source: 'freed', sourceId: 'ob-rent', period: '2027-06', total: 50_000 })
      expect(store.goals.find((g) => g.id === 'trip')!.monthly).toBe(40_000 + 50_000)
      // design-10: итог — одна строка, без обещания «окна 72 часа».
      expect(done).toContain(`Взносы по целям увеличены с ${monthFrom('2027-06')}.`)
      expect(done).not.toMatch(/72 часа|два аккаунта/)

      const again = await renderScreen(WeekSalary, '/week/salary')
      expect(again).toContain('Уже разложено')

      const salary = await renderScreen(WeekSalary, salaryPath)
      expect(salary).toContain('Эта зарплата пока не отмечена')
      expect(salary).not.toContain('Уже разложено')
      markSalary(store)
      const marked = await renderScreen(WeekSalary, salaryPath)
      expect(marked).toContain('Осталось распределить')
      expect(marked).not.toContain('снизится с')
    })
  })

  it('reuse-2: годовое обязательство дешевеет 60 000 → 48 000 — раскладывается 1 000 в месяц, а не 12 000', async () => {
    const insurance: Obligation = {
      id: 'ins', name: 'Страховка', note: '', day: 5, every: 'year', month: 3, category: 'd1', updatedAt: T0,
      versions: [{ from: '2000-01', amount: 60_000 }, { from: '2027-01', amount: 48_000 }],
    }
    const store = family({ obligations: [insurance] })
    expect(await renderScreen(WeekSalary, '/week/salary?from=freed')).toContain(`Куда направить ${money(1_000)}`)
    await decide('/week/salary?from=freed', { trip: 1_000 })
    expect(store.goals.find((g) => g.id === 'trip')!.monthly).toBe(41_000)
    expect(store.allocations[0]).toMatchObject({ source: 'freed', sourceId: 'ins', period: '2027-01', total: 1_000 })
  })

  it('reuse-16: подушка у разового решения — добавка ложится разом, а не ×12', async () => {
    const store = family({ plans: [planOf()] })
    markSalary(store)
    const html = await renderScreen(WeekSalary, salaryPath, undefined, [screenMixin({ alloc: { cushion: 100_000 } })])
    const g = store.goals.find((x) => x.id === 'cushion')!
    const cover = (saved: number) => emergencyCoverage(saved, planMandatory(store.planState(), '2026-09')).toFixed(1).replace('.', ',')
    expect(html).toContain(`Через год покроет ${cover(g.have + g.monthly * 12 + 100_000)} мес. расходов`)
    expect(html).not.toContain(`Через год покроет ${cover(g.have + g.monthly * 12 + 100_000 * 12)} мес. расходов`)
  })

  it('design-10: строка зарплаты — одна; пустое состояние — без жаргона про версии', async () => {
    const store = family()
    markSalary(store)
    let total = 0
    const html = await renderScreen(WeekSalary, salaryPath, undefined, [
      screenMixin({}, (s) => {
        total = s.total as number
      }),
    ])
    expect(html).toContain(`Зарплата пришла — ${money(700_000)} · к раскладке ${money(total)}`)
    expect(html).not.toContain('Свободно из неё')

    const empty = await renderScreen(WeekSalary, '/week/salary')
    expect(empty).toContain('Сейчас нет запланированных изменений, которые высвобождают деньги.')
    expect(empty).not.toContain('Событие появится само')
  })
})
