// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import type { Operation } from '@/lib/statements/types'
import type { Goal, Payment, TripSpend } from '@/types/finance'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-31 (Р-14): до поездки — экран как обычно, даты строкой в «Подробнее»; в пути — «Потрачено N из M» под героем,
 * свои строки свёрнуты («Операции · N»), «Убрать» снимает строку с поездки («Убрано · N», «Вернуть»); после — «За
 * поездку»; партнёр — общий итог и своя сумма, чужих строк нет; viewer — итог без строк и действий.
 */
let app: App | null = null
const T0 = '2026-10-01T05:00:00.000Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T08:00:00Z'))
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h-family', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const op = (id: string, date: string, amount: number): Operation => ({
  id, bank: 'kaspi', date, amount, kind: 'purchase', merchant: id, categoryId: null, internal: false,
})
// Ильяс в поездке 10–15 октября: отель и кафе — траты, Magnum до поездки — нет, аренда — платёж по отметке (`opId`).
const MINE = [op('Hotel', '2026-10-10', -70_000), op('Cafe', '2026-10-13', -12_000), op('Magnum', '2026-10-09', -5_000), op('Arenda', '2026-10-11', -220_000)]
const rentPaid: Payment = { id: 'pay-rent', kind: 'obligation', targetId: 'rent', period: '2026-10', amount: 220_000, by: 'a', at: T0, updatedAt: T0, source: 'statement', opId: 'Arenda' } as Payment
const tripGoal = (g: Goal): Goal => (g.id === 'trip' ? { ...g, from: '2026-10-10', to: '2026-10-15', budget: 150_000 } : g)

async function open(opts: { role?: 'member' | 'viewer'; slot?: 'a' | 'b'; ops?: Operation[]; spends?: TripSpend[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(opts.role ?? 'member', opts.slot ?? 'a'))
  const finance = useFinanceStore()
  const doc = planFamilyDoc()
  doc.goals = doc.goals.map(tripGoal)
  doc.payments = [rentPaid]
  doc.tripSpends = opts.spends ?? []
  finance.setHouseholdDoc(doc, 1)
  const operations = useOperationsStore()
  for (const o of opts.ops ?? []) operations.ops[o.id] = o
  operations.writeTripTotals()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/goals/trip')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GoalDetail)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const title = () => norm(q('[data-trip-title]')?.textContent)
const click = async (el: HTMLElement | null) => {
  el!.click()
  await nextTick()
  await nextTick()
}

describe('PN-31: экран цели-поездки', () => {
  it('до поездки — карточки нет, даты строкой в «Подробнее»', async () => {
    vi.setSystemTime(new Date('2026-10-05T08:00:00Z'))
    await open({ ops: MINE })
    expect(q('[data-trip]')).toBeNull()
    expect(norm(q('[data-trip-dates]')?.textContent)).toBe('Поездка 10–15 октября')
  })

  it('в пути — «Потрачено N из M» без платежа по отметке и трат вне дат; «Убрать» и «Вернуть» меняют сумму и списки', async () => {
    const finance = await open({ ops: MINE })
    expect(title()).toBe('82 000 из 150 000 ₸')
    expect(norm(q('[data-trip-label]')?.textContent)).toBe('Потрачено')
    expect(q('[data-trip-ops]'), 'строки свёрнуты').toBeNull()
    expect(norm(q('[data-trip-ops-toggle]')?.textContent)).toBe('Операции · 2')
    await click(q('[data-trip-ops-toggle]'))
    expect(all('[data-trip-op]').map((x) => x.dataset.tripOp)).toEqual(['Cafe', 'Hotel'])

    await click(q('[data-trip-op="Hotel"] [data-trip-exclude]'))
    expect(title()).toBe('12 000 из 150 000 ₸')
    expect(norm(q('[data-trip-toast]')?.textContent), 'тост: не удалено').toBe('Убрано из поездки — операция осталась')
    expect(finance.householdDoc.tripSpends).toMatchObject([{ id: 'trip:a', amount: 12_000, ops: 1 }])
    expect(all('[data-trip-op]').map((x) => x.dataset.tripOp)).toEqual(['Cafe'])
    expect(norm(q('[data-trip-excluded-toggle]')?.textContent)).toBe('Убрано · 1')
    expect(q('[data-trip-excluded]'), '«Убрано» свёрнуто').toBeNull()

    await click(q('[data-trip-excluded-toggle]'))
    await click(q('[data-trip-excluded-op="Hotel"] [data-trip-include]'))
    expect(title()).toBe('82 000 из 150 000 ₸')
    expect(q('[data-trip-excluded-toggle]')).toBeNull()
  })

  it('сверх бюджета — полоса цветом предупреждения; срок и «Пополнить» остаются', async () => {
    await open({ ops: [...MINE, op('Ski', '2026-10-14', -100_000)] })
    expect(title()).toBe('182 000 из 150 000 ₸')
    expect(q('[data-trip] [role="progressbar"] i')!.className).toContain('bg-warn')
    expect([...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Пополнить')).toBe(true)
  })

  it('после поездки — «За поездку» и «N из M»', async () => {
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
    await open({ ops: MINE })
    expect(norm(q('[data-trip-label]')?.textContent)).toBe('За поездку')
    expect(title()).toBe('82 000 из 150 000 ₸')
  })

  it('партнёр: общий итог и «кто сколько», чужих строк нет', async () => {
    const spendA: TripSpend = { id: 'trip:a', goalId: 'trip', by: 'a', amount: 82_000, ops: 2, updatedAt: T0 }
    await open({ slot: 'b', ops: [op('Taxi', '2026-10-12', -8_000)], spends: [spendA] })
    expect(title()).toBe('90 000 из 150 000 ₸')
    expect(norm(q('[data-trip-split]')?.textContent)).toBe('Ильяс 82 000 ₸ · Вы 8 000 ₸')
    await click(q('[data-trip-ops-toggle]'))
    expect(all('[data-trip-op]').map((x) => x.dataset.tripOp)).toEqual(['Taxi'])
  })

  it('viewer — итог без строк и действий', async () => {
    const spendA: TripSpend = { id: 'trip:a', goalId: 'trip', by: 'a', amount: 82_000, ops: 2, updatedAt: T0 }
    await open({ role: 'viewer', slot: 'b', spends: [spendA] })
    expect(title()).toBe('82 000 из 150 000 ₸')
    expect(q('[data-trip-ops-toggle]')).toBeNull()
    expect(q('[data-trip-exclude]')).toBeNull()
  })
})
