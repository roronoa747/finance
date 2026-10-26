// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { monthPlan, termSnapOf, type StepCandidate } from '@/lib/finance'
import { money } from '@/lib/money'
import type { SpendTotal } from '@/lib/statements/types'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { PersonId, SyncDoc } from '@/types/finance'
import DoSheet from '@/components/plan/DoSheet.vue'
import Dreams from './Dreams.vue'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * AU-06 (Р-6, Р-3): метка «мечта сдвинулась» на «Мечтах» и экране цели, «Вернуть срок» → `DoSheet` → сдвиг месяца.
 *
 * Семья AU-04 (Ильяс — продукты 400 000 и кафе 47 000, Аруна — продукты 300 000; свободно ровно 130 000), очередь —
 * машина, подушка, отпуск (герой — машина). Снимок 1 октября — по плану: машине 60 000. Кафе Ильяса в октябре 177 000 —
 * выше плана на 130 000 → по факту свободно 0: машине 0, недобор 60 000 при темпе 60 000 → 30 дней → «+4 недели».
 * Отпуск: 40 000 → 0 → 40 000 / 40 000 × 30,4 = 30 дней. История продуктов Ильяса (август, сентябрь по 400 000) — запас
 * плана продуктов семьи 700 000 − 400 000 = 300 000; «Вернуть срок» берёт 60 000 из плана Аруны (у Ильяса перерасход).
 */
let app: App | null = null
const KEY = '2026-10'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-12T07:00:00Z'))
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

const total = (by: PersonId, period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops: 1, updatedAt: T0,
})
const plan = (by: PersonId, categoryId: string, amount: number) => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
const UPLOADS = [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-08-01', period_to: '2026-10-12', ops_count: 9, created_at: T0 }]

function familyDoc(opts: { snap?: boolean; history?: boolean } = {}): SyncDoc {
  const doc = planFamilyDoc({
    spendPlans: [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 300_000)],
    goalOrder: { ids: ['car', 'cushion', 'trip'], updatedAt: T0 },
    spendTotals: [
      ...(opts.history === false ? [] : [total('a', '2026-08', 'sc_food', 400_000), total('a', '2026-09', 'sc_food', 400_000)]),
      total('a', KEY, 'sc_food', 400_000), total('a', KEY, 'sc_cafe', 177_000),
    ],
  })
  if (opts.snap !== false) {
    const p = monthPlan(doc, { key: KEY, totals: [], spendCategories: [], uploads: [] })
    doc.termSnaps = [{ ...termSnapOf(p, '2026-10-01T03:00:00.000Z'), updatedAt: T0 }]
  }
  return doc
}

async function open(screen: Component, path: string, role: 'member' | 'viewer' = 'member', doc: SyncDoc = familyDoc()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: UPLOADS } as never)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  await useOperationsStore().loadUploads()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(screen)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await settle()
  return finance
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
async function settle() {
  for (let i = 0; i < 6; i++) await nextTick()
  await Promise.resolve()
}

describe('AU-06: метка на «Мечтах»', () => {
  it('у строки цели при сдвиге от недели; на обложке главной — нет (FG-21: срок и причина — в карточке цели)', async () => {
    await open(Dreams, '/dreams')
    // F2-Х4 (FG-12): на «Мечтах» — только срок, причина — в карточке цели; FG-21 — у обложки метки нет вовсе.
    expect(q('[data-hero-note]')).toBeNull()
    expect(q('[data-dreams-cover]')).not.toBeNull()
    expect(txt(document.body)).not.toContain('выше плана')
    expect(txt(document.body)).not.toContain(' · платёж')
    const rows = [...document.querySelectorAll('[data-id]')].map((el) => txt(el))
    expect(rows.find((t) => t.includes('Отпуск'))).toContain('+4 недели')
    // `/ux`: в строке цели — та же точка тона, что у героя (дальше — `warn`).
    const note = [...document.querySelectorAll('[data-row-note]')].find((el) => txt(el).startsWith('+4'))
    expect(note?.querySelector('i')?.className).toContain('bg-warn')
  })
  it('нет снимка — метки нет', async () => {
    await open(Dreams, '/dreams', 'member', familyDoc({ snap: false }))
    expect(document.querySelector('[data-row-note]')).toBeNull()
  })
  it('viewer — метка есть', async () => {
    await open(Dreams, '/dreams', 'viewer')
    expect([...document.querySelectorAll('[data-row-note]')].some((el) => txt(el).startsWith('+4'))).toBe(true)
  })
})

describe('AU-06: экран цели — метка и «Вернуть срок»', () => {
  it('«Вернуть срок» → лист с суммой и эффектом → «Вернуть» → сдвиг, метка ушла; «Отменить» — метка вернулась', async () => {
    const finance = await open(GoalDetail, '/goals/car')
    expect(txt(q('[data-goal-shift]'))).toBe('+4 недели · кафе и рестораны выше плана')
    q('[data-return-term]')!.click()
    await settle()
    expect(txt(q('[role="dialog"] h3'))).toBe('Вернуть срок')
    expect(txt(q('[data-do-amount]'))).toBe(txt({ textContent: money(60_000) } as Element))
    expect(txt(q('[data-do-from]'))).toBe('из плана «Продукты» · Аруна → в «Машина»')
    expect(txt(q('[data-do-effect]'))).toBe('на 4 недели раньше')
    expect(txt(q('[data-do-confirm]'))).toBe('Вернуть')
    q('[data-do-confirm]')!.click()
    await settle()
    expect(finance.householdDoc.planShifts).toHaveLength(1)
    expect(finance.householdDoc.planShifts![0]).toMatchObject({ period: KEY, from: { spend: 'b', categoryId: 'sc_food' }, to: { goalId: 'car' }, amount: 60_000, by: 'a' })
    expect(q('[data-goal-shift]')).toBeNull()
    expect(q('[role="dialog"]')).toBeNull()
    expect(txt(q('[data-do-toast]'))).toBe('«Машина» ближе на 4 недели')
    q('[data-toast-action]')!.click()
    await settle()
    expect(finance.householdDoc.planShifts![0].deletedAt).toBeTruthy()
    expect(txt(q('[data-goal-shift]'))).toBe('+4 недели · кафе и рестораны выше плана')
  })
  it('viewer — метка без кнопки', async () => {
    await open(GoalDetail, '/goals/car', 'viewer')
    expect(q('[data-goal-shift]')).not.toBeNull()
    expect(q('[data-return-term]')).toBeNull()
  })
  it('денег нет (запаса плана нет) — кнопки нет', async () => {
    await open(GoalDetail, '/goals/car', 'member', familyDoc({ history: false }))
    expect(q('[data-goal-shift]')).not.toBeNull()
    expect(q('[data-return-term]')).toBeNull()
  })
})

describe('AU-06: DoSheet — три вида', () => {
  const C: Record<string, StepCandidate> = {
    move: { id: 'move:sc_cafe', kind: 'move', shift: { period: KEY, from: { spend: 'a', categoryId: 'sc_cafe' }, to: { goalId: 'trip' }, amount: 20_000 }, effect: { days: 15 } },
    prepay: { id: 'prepay', kind: 'prepay', shift: { period: KEY, from: 'rest', to: 'debt', amount: 50_000 }, effect: { months: 3, saved: 41_000 } },
    cushion: { id: 'cushion', kind: 'cushion', shift: { period: KEY, from: 'rest', to: { goalId: 'cushion' }, amount: 50_000 }, effect: { months: 2.1 } },
  }
  async function mountSheet(c: StepCandidate, role: 'member' | 'viewer' = 'member') {
    const pinia = createPinia()
    setActivePinia(pinia)
    useAuthStore().setAuthData(authAs(role, 'a'))
    const finance = useFinanceStore()
    finance.setHouseholdDoc(familyDoc(), 1)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(DoSheet, { candidate: c }) })
    app.use(pinia)
    app.mount(root)
    await settle()
    return finance
  }

  it('перенос: заголовок, откуда → куда, эффект, «Только этот месяц», «Перенести»', async () => {
    await mountSheet(C.move!)
    expect(txt(q('[role="dialog"] h3'))).toBe('Перенести в мечту')
    expect(txt(q('[data-do-from]'))).toBe('из плана «Кафе и рестораны» · Ильяс → в «Отпуск»')
    expect(txt(q('[data-do-effect]'))).toBe('на 2 недели раньше') // earlierLabel: 15 дней — недели
    expect(txt(q('[data-do-month]'))).toBe('Только этот месяц')
    expect(txt(q('[data-do-confirm]'))).toBe('Перенести')
  })
  it('досрочка: из остатка в карточку долга, месяцы и проценты, «Внести»', async () => {
    await mountSheet(C.prepay!)
    expect(txt(q('[role="dialog"] h3'))).toBe('Внести досрочно')
    expect(txt(q('[data-do-from]'))).toMatch(/^из остатка месяца → в «.+»$/)
    expect(txt(q('[data-do-effect]'))).toBe('на 3 мес. раньше · −41 000 процентов')
    expect(txt(q('[data-do-confirm]'))).toBe('Внести')
  })
  it('подушка: «хватит на», «Отложить»; «Не сейчас» ничего не пишет', async () => {
    const finance = await mountSheet(C.cushion!)
    expect(txt(q('[role="dialog"] h3'))).toBe('Отложить в подушку')
    expect(txt(q('[data-do-effect]'))).toBe('подушки хватит на 2,1 месяца')
    expect(txt(q('[data-do-confirm]'))).toBe('Отложить')
    q('[data-do-cancel]')!.click()
    await settle()
    expect(finance.householdDoc.planShifts ?? []).toEqual([])
  })
  it('viewer — лист не открывается', async () => {
    await mountSheet(C.move!, 'viewer')
    expect(q('[role="dialog"]')).toBeNull()
  })
})
