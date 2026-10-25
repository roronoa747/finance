// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { paidFor } from '@/lib/finance'
import type { Payment, SyncDoc } from '@/types/finance'
import Money from '@/views/Money.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * F2-03 (Р-2): «Оплатил» у строки кредита на «Долгах» — небольшой кнопкой, как «Отдал» у долга человеку; отмечено в этом
 * месяце — ✓ у суммы. Отметка — та же запись, что в «Месяце» (`paidFor`). Семья `planFamilyDoc`, 12 сентября 2026.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const KEY = '2026-09'
const paid = (targetId: string, period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `credit-${targetId}-${period}`, kind: 'credit', targetId, period, amount, accountId: 'card', by: 'a', at: `${period}-10T05:00:00.000Z`, updatedAt: T0, ...extra,
})
const BRO = { id: 'bro', name: 'Брату', note: '', principal: 500_000, principalSetAt: T0, annualRate: 0, payment: 50_000, day: 25, person: true, updatedAt: T0 }
// Август «Кредита» оплатили с Kaspi Gold — сентябрь пишется одним нажатием с того же счёта (Р-5).
const augLoan = paid('loan', '2026-08', 58_000, { principal: 30_000 })

function doc(payments: Payment[] = [augLoan]): SyncDoc {
  const base = planFamilyDoc()
  return planFamilyDoc({ credits: [...base.credits!, BRO], payments })
}

async function open(role: 'member' | 'viewer' = 'member', d = doc()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(d, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/debts')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Money)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const row = (id: string) => q(`[data-debt="${id}"]`)!.parentElement!
const payIn = (id: string) => row(id).querySelector<HTMLElement>('[data-debt-pay]')
const giveIn = (id: string) => row(id).querySelector<HTMLElement>('[data-debt-give]')
const marks = (finance: ReturnType<typeof useFinanceStore>, id: string) => finance.payments.filter((p) => p.targetId === id && p.period === KEY && !p.deletedAt)

describe('F2-03: «Оплатил» у строки кредита на «Долгах»', () => {
  it('у каждого кредита — «Оплатил» в строке; у долга человеку — по-прежнему «Отдал»', async () => {
    await open()
    for (const id of ['loan', 'cc', 'inst']) {
      expect(txt(payIn(id))).toBe('Оплатил')
      expect(giveIn(id)).toBeNull()
    }
    expect(txt(giveIn('bro'))).toBe('Отдал')
    expect(payIn('bro')).toBeNull()
    // Кнопка — тихая `soft`, как «Отдал»; брендовой на «Долгах» нет (правило 12).
    expect(payIn('loan')!.className).toContain('bg-brand-soft')
    expect(all('button').filter((b) => /(^|\s)bg-brand(\s|$)/.test(b.className))).toEqual([])
  })

  it('нажатие — отметка месяца с прошлого счёта: платёж +1, ✓ у суммы, кнопки нет; «Месяц» видит ту же запись', async () => {
    const finance = await open()
    const spy = vi.spyOn(finance, 'markPaid')
    const before = finance.payments.length
    await press(payIn('loan'))
    expect(spy).toHaveBeenCalledWith('credit', 'loan', 'a', { period: KEY, accountId: 'card' })
    expect(finance.payments).toHaveLength(before + 1)
    // Сумма — платёж месяца кредита (58 000).
    expect(marks(finance, 'loan')).toMatchObject([{ kind: 'credit', amount: 58_000, accountId: 'card' }])
    expect(paidFor(finance.payments, 'credit', 'loan', KEY)).not.toBeNull()
    expect(q('[data-debt="loan"] [data-debt-given]')!.getAttribute('aria-label')).toBe('оплачено в этом месяце')
    expect(payIn('loan')).toBeNull()
    // Остальные кредиты не тронуты.
    expect(payIn('cc')).not.toBeNull()
  })

  it('прошлой оплаты нет — счёт спрашивает лист отметки, сразу ничего не пишет', async () => {
    const finance = await open('member', doc([]))
    await press(payIn('cc'))
    expect(marks(finance, 'cc')).toHaveLength(0)
    expect(txt(q('[role="dialog"]'))).toContain('Кредитка')
  })

  it('отмечено в «Месяце» — на «Долгах» ✓ и нет кнопки; второй отметки нет', async () => {
    const finance = await open('member', doc([augLoan, paid('loan', KEY, 58_000, { principal: 30_000 })]))
    expect(q('[data-debt="loan"] [data-debt-given]')).not.toBeNull()
    expect(payIn('loan')).toBeNull()
    expect(marks(finance, 'loan')).toHaveLength(1)
  })

  it('платёж не заполнен (0) — кнопки нет: «Месяц» такой долг не ждёт, нулевой отметки не будет', async () => {
    const base = planFamilyDoc()
    const credits = [...base.credits!.map((c) => (c.id === 'loan' ? { ...c, payment: 0 } : c)), { ...BRO, payment: 0 }]
    await open('member', planFamilyDoc({ credits, payments: [augLoan] }))
    expect(payIn('loan')).toBeNull()
    expect(giveIn('bro')).toBeNull()
    expect(payIn('cc')).not.toBeNull()
  })

  it('viewer — кнопок нет, отмеченное — с ✓', async () => {
    await open('viewer', doc([augLoan, paid('loan', KEY, 58_000)]))
    expect(all('[data-debt-pay], [data-debt-give]')).toEqual([])
    expect(q('[data-debt="loan"] [data-debt-given]')).not.toBeNull()
    expect(q('[data-debt="cc"] [data-debt-given]')).toBeNull()
  })
})
