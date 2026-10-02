import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain } from '@/lib/money'
import { accountBalance, breakdownWith, monthBreakdown, paidFor } from '@/lib/finance'
import type { Payment } from '@/types/finance'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SalaryRow from './SalaryRow.vue'
import Money from '@/views/Money.vue'
import Breakdown from '@/views/Breakdown.vue'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'

/**
 * RP-10 «Пришла зарплата» в SSR: кнопка — только своему участнику и не viewer; отметку
 * видят оба; разбор открывается с суммой из finance.ts (B2C-58). Семья — `planFamilyDoc`:
 * Ильяс (a) — 10-го, 700 000; Аруна (b) — 20-го, 500 000; карта Kaspi Gold 2 000 000.
 */
describe('RP-10: «Пришла зарплата» (SSR)', () => {
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
    vi.setSystemTime(new Date('2026-09-21T07:00:00Z')) // 21 сентября, Алматы: оба дня прошли
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const salary = (p: Partial<Payment> = {}): Payment => ({
    id: 's-a',
    kind: 'salary',
    targetId: 'a',
    period: '2026-09',
    amount: 700_000,
    accountId: 'card',
    by: 'a',
    at: '2026-09-10T04:00:00.000Z',
    updatedAt: '2026-09-10T04:00:00.000Z',
    ...p,
  })

  function family(role: 'member' | 'viewer', slot: 'a' | 'b', payments: Payment[] = []) {
    useAuthStore().setAuthData(authAs(role, slot))
    useFinanceStore().setHouseholdDoc(planFamilyDoc({ payments }), 1)
  }

  /**
   * Строка зарплаты участника за сентябрь — та же, что в листе «До зарплаты» и на «Неделе» (список
   * Бюджета ушёл с пивотом 3, B2C-45).
   */
  const row = (id: 'a' | 'b') => renderToString(createSSRApp(SalaryRow, { personId: id, period: '2026-09', note: '10 сентября' }))
  const hasMark = (chunk: string) => />\s*Пришла\s*<\/button>/.test(chunk)

  it('строка зарплаты: «Пришла» — только в строке своей зарплаты; viewer не видит ни одной', async () => {
    family('member', 'a')
    expect(hasMark(await row('a'))).toBe(true)
    expect(hasMark(await row('b'))).toBe(false)

    setActivePinia(createPinia())
    family('member', 'b')
    expect(hasMark(await row('a'))).toBe(false)
    expect(hasMark(await row('b'))).toBe(true)

    setActivePinia(createPinia())
    family('viewer', 'a')
    expect(hasMark(await row('a'))).toBe(false)
    expect(hasMark(await row('b'))).toBe(false)
  })

  it('строка зарплаты: до окна кнопки нет; в окне за 3 дня — есть', async () => {
    vi.setSystemTime(new Date('2026-09-06T07:00:00Z'))
    family('member', 'a')
    expect(hasMark(await row('a'))).toBe(false)
    vi.setSystemTime(new Date('2026-09-07T07:00:00Z'))
    expect(hasMark(await row('a'))).toBe(true)
  })

  it('строка зарплаты: отмеченная — сумма пришедшего, день и счёт; партнёру — отметка без кнопок', async () => {
    const bonus = salary({ amount: 900_000 })
    family('member', 'a', [bonus])
    const mine = await row('a')
    expect(mine).toContain('пришла 10 сентября · Kaspi Gold')
    expect(mine).toContain(`+${plain(900_000)}`)
    expect(hasMark(mine)).toBe(false)
    expect(mine).toContain('aria-label="Пришла — подробнее"')

    setActivePinia(createPinia())
    family('member', 'b', [bonus])
    const theirs = await row('a')
    expect(theirs).toContain('пришла 10 сентября · Kaspi Gold')
    expect(theirs).toContain('aria-label="Пришла"')
    expect(theirs).not.toContain('подробнее')
  })

  // Пивот 3 (Р-32, Р-39): «Пришла зарплата» — в сводке «До зарплаты N дней»; ближайшая зарплата — строкой её листа.
  it('«Деньги»: «Пришла зарплата» в сводке «До зарплаты» — у того, чья зарплата ближайшая; после отметки — следующая', async () => {
    vi.setSystemTime(new Date('2026-09-09T07:00:00Z')) // завтра зарплата Ильяса, списаний до неё нет
    family('member', 'a')
    const mine = await renderScreen(Money, '/money')
    expect(mine).toContain('До зарплаты 1 день')
    expect(mine).toMatch(/>\s*Пришла зарплата\s*</)

    setActivePinia(createPinia())
    family('member', 'b')
    expect(await renderScreen(Money, '/money')).not.toMatch(/Пришла зарплата/)

    setActivePinia(createPinia())
    family('viewer', 'a')
    expect(await renderScreen(Money, '/money')).not.toMatch(/Пришла зарплата/)

    // Отметили раньше дня — «До зарплаты» смотрит на зарплату Аруны 20-го.
    setActivePinia(createPinia())
    family('member', 'a', [salary({ at: '2026-09-09T04:00:00.000Z' })])
    const after = await renderScreen(Money, '/money', undefined, [screenMixin({ open: true })])
    expect(after).toContain('До зарплаты 11 дней')
    expect(after.slice(after.indexOf('role="dialog"'))).toContain('Зарплата · Аруна')
    expect(after).not.toMatch(/Пришла зарплата/)
  })

  it('Обзор: за 4 дня до дня кнопки нет', async () => {
    vi.setSystemTime(new Date('2026-09-06T07:00:00Z'))
    family('member', 'a')
    expect(await renderScreen(Money, '/money')).not.toMatch(/Пришла зарплата/)
  })

  /** Разбор зарплаты Ильяса за сентябрь — те же числа, что у экрана (`finance.ts`). */
  const breakdownOf = () => {
    const store = useFinanceStore()
    const doc = store.householdDoc
    return monthBreakdown(
      { ...doc, credits: store.credits },
      { key: '2026-09', totals: [], spendCategories: [], uploads: [], rawCredits: doc.credits },
      { from: 'salary', person: 'a', period: '2026-09' },
    )!
  }
  const path = '/week/breakdown?from=salary&person=a&period=2026-09'

  it('Разбор с источником «зарплата» (B2C-58): «Остаётся N из 700 000» — из finance.ts; без отметки — не отмечена', async () => {
    family('member', 'a', [salary()])
    const mb = breakdownOf()
    const rest = breakdownWith(mb, mb.articles.filter((a) => !a.on).map((a) => a.key)).fill.rest
    const html = await renderScreen(Breakdown, path)
    expect(html).toContain(`Остаётся ${money(rest)} из ${money(700_000)}`)
    expect(html).toContain('>Разложить<')

    setActivePinia(createPinia())
    family('member', 'a')
    expect(await renderScreen(Breakdown, path)).toContain('Эта зарплата ещё не отмечена.')
    // Старый адрес раскладки — тот же разбор (редирект с параметрами).
    expect(await renderScreen(Breakdown, '/week/salary?from=salary&person=a&period=2026-09')).toContain('Эта зарплата ещё не отмечена.')
  })

  it('«Разложить»: взносы в цели со счёта зарплаты, досрочка записью prepay, запись разбора с частями', async () => {
    family('member', 'a', [salary()])
    const store = useFinanceStore()
    const mb = breakdownOf()
    const w = breakdownWith(mb, mb.articles.filter((a) => !a.on).map((a) => a.key))
    const toGoals = w.effects.contributions.reduce((a, c) => a + c.amount, 0)
    expect(toGoals).toBeGreaterThan(0)
    await renderScreen(Breakdown, path, undefined, [screenMixin({}, (s) => (s.lay as () => void)())])
    expect(store.allocations).toHaveLength(1)
    expect(store.allocations[0]).toMatchObject({ kind: 'breakdown', source: 'salary', sourceId: 'a', period: '2026-09', total: 700_000 })
    expect(store.allocations[0].parts).toEqual(w.effects.parts)
    // Деньги уходят со счёта, на который пришла зарплата; запись зарплаты не тронута.
    const card = store.householdDoc.accounts[0]
    const prepaid = store.payments.filter((p) => p.kind === 'prepay').reduce((a, p) => a + p.amount, 0)
    expect(prepaid).toBe(w.effects.prepay?.amount ?? 0)
    expect(accountBalance(card, store.payments)).toBe(2_000_000 + 700_000 - toGoals - prepaid)
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')?.amount).toBe(700_000)
  })
})
