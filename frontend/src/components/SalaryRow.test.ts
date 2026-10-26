import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import type { Payment } from '@/types/finance'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SalaryRow from './SalaryRow.vue'
import { authAs, planFamilyDoc } from '@/test/planFamily'

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
   * Два режима (FG-25, хвост FG-Х6: строка без экрана снята): `button small` — «Пришла» у своей строки «Месяца»; `button` —
   * «Пришла зарплата» и «Другая сумма или счёт» в листе зарплаты.
   */
  const small = (id: 'a' | 'b') => renderToString(createSSRApp(SalaryRow, { personId: id, period: '2026-09', button: true, small: true }))
  const big = (id: 'a' | 'b') => renderToString(createSSRApp(SalaryRow, { personId: id, period: '2026-09', button: true }))
  const bare = (chunk: string) => chunk.replace(/<!--[^>]*-->/g, '')
  const hasSmall = (chunk: string) => /data-salary-came-btn[^>]*>\s*Пришла\s*</.test(bare(chunk))
  const hasBig = (chunk: string) => />\s*Пришла зарплата\s*<\/button>/.test(bare(chunk))

  it('«Пришла» — только у своей зарплаты, в обоих режимах; viewer не видит ни одной', async () => {
    family('member', 'a')
    expect(hasSmall(await small('a'))).toBe(true)
    expect(hasBig(await big('a'))).toBe(true)
    expect(await big('a')).toContain('Другая сумма или счёт')
    expect(hasSmall(await small('b'))).toBe(false)
    expect(hasBig(await big('b'))).toBe(false)

    setActivePinia(createPinia())
    family('viewer', 'a')
    for (const id of ['a', 'b'] as const) {
      expect(hasSmall(await small(id))).toBe(false)
      expect(hasBig(await big(id))).toBe(false)
    }
  })

  it('до окна кнопки нет; в окне за 3 дня — есть', async () => {
    vi.setSystemTime(new Date('2026-09-06T07:00:00Z'))
    family('member', 'a')
    expect(hasSmall(await small('a'))).toBe(false)
    expect(hasBig(await big('a'))).toBe(false)
    vi.setSystemTime(new Date('2026-09-07T07:00:00Z'))
    expect(hasSmall(await small('a'))).toBe(true)
    expect(hasBig(await big('a'))).toBe(true)
  })

  it('отмеченная — без кнопки в обоих режимах; строки «пришла … · счёт» больше нет', async () => {
    family('member', 'a', [salary({ amount: 900_000 })])
    const mine = await small('a')
    expect(hasSmall(mine)).toBe(false)
    expect(hasBig(await big('a'))).toBe(false)
    expect(mine).not.toContain('пришла 10 сентября')
    expect(mine).not.toContain(`+${money(900_000)}`)
  })

  /** Разбор зарплаты Ильяса за сентябрь — те же числа, что у экрана (`finance.ts`). */
})
