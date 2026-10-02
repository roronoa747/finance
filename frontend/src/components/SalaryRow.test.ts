import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain } from '@/lib/money'
import { accountBalance, budgetAmounts, paidFor, salaryFree } from '@/lib/finance'
import type { Payment } from '@/types/finance'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SalaryRow from './SalaryRow.vue'
import Money from '@/views/Money.vue'
import WeekSalary from '@/views/WeekSalary.vue'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'

/**
 * RP-10 «Пришла зарплата» в SSR: кнопка — только своему участнику и не viewer; отметку
 * видят оба; раскладка открывается с суммой из finance.ts. Семья — `planFamilyDoc`:
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

  it('Ритуал с источником «зарплата»: сумма — доля свободного из finance.ts, подпись зарплаты', async () => {
    family('member', 'a', [salary()])
    const store = useFinanceStore()
    const free = budgetAmounts({ ...store.householdDoc, credits: store.credits }).d5
    const total = salaryFree(free, store.people, salary())
    expect(total).toBeGreaterThan(0)
    const html = await renderScreen(WeekSalary, '/ritual?from=salary&person=a&period=2026-09')
    expect(html).toContain(`Куда направить ${money(total)}`)
    expect(html).toContain(`Зарплата пришла — ${money(700_000)}`)
    // Абзац «Решение разовое…» снят по правилу 12 (критик Блока 3).
    expect(html).not.toContain('Решение разовое')
    expect(html).not.toContain('Сейчас нет запланированных изменений')

    // Без отметки раскладывать нечего; без параметров — прежний источник.
    setActivePinia(createPinia())
    family('member', 'a')
    expect(await renderScreen(WeekSalary, '/ritual?from=salary&person=a&period=2026-09')).toContain(
      'Эта зарплата пока не отмечена',
    )
    expect(await renderScreen(WeekSalary, '/ritual')).toContain('Сейчас нет запланированных изменений')
  })

  it('Ритуал: разовое решение — взнос в цель и сдвиг счёта зарплаты, ежемесячный взнос прежний', async () => {
    family('member', 'a', [salary()])
    const store = useFinanceStore()
    const monthly = store.goals.find((g) => g.id === 'trip')!.monthly
    const html = await renderScreen(WeekSalary, '/ritual?from=salary&person=a&period=2026-09', undefined, [
      screenMixin({}, (s) => {
        s.alloc = { trip: 100_000 }
        ;(s.confirm as () => void)()
      }),
    ])
    expect(html).toContain('Решение записано')
    expect(html).toContain(`В цели отложено ${money(100_000)} со счёта «Kaspi Gold»`)
    const trip = store.goals.find((g) => g.id === 'trip')!
    expect(trip.monthly).toBe(monthly)
    expect(trip.movements.map((m) => [m.amount, m.by, m.note])).toEqual([[100_000, 'a', 'из зарплаты']])
    expect(trip.have).toBe(50_000 + 100_000)
    const card = store.householdDoc.accounts[0]
    expect(accountBalance(card, store.payments)).toBe(2_000_000 + 700_000 - 100_000)
    // Запись зарплаты не тронута.
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')?.amount).toBe(700_000)
  })

  it('Раскладка: доля на досрочку вносится записью prepay и решение записано (B2C-21)', async () => {
    family('member', 'a', [salary()])
    const store = useFinanceStore()
    const html = await renderScreen(WeekSalary, '/ritual?from=salary&person=a&period=2026-09', undefined, [
      screenMixin({}, (s) => {
        s.alloc = { credit: 50_000 }
        ;(s.confirm as () => void)()
      }),
    ])
    expect(html).toContain(`Досрочка ${money(50_000)} внесена в «`)
    expect(store.payments.filter((p) => p.kind === 'prepay')).toHaveLength(1)
    expect(store.allocations).toHaveLength(1)
    expect(store.allocations[0]).toMatchObject({ source: 'salary', sourceId: 'a', period: '2026-09', parts: [{ target: expect.stringMatching(/^prepay:/), amount: 50_000 }] })
  })
})
