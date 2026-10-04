// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { monthPlan, type MonthPlanCtx } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import type { SyncDoc } from '@/types/finance'
import Money from '@/views/Money.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * B2C-88 (Р-78…Р-84): «План месяца» вверху «Денег» — круг и суммы из `monthPlan` (экран не пересчитывает),
 * выключил цель — остаток и даты сменились, смена плательщика — «хватает» обоих, «Отложить по плану» пишет взносы
 * и второй раз не появляется; viewer — без переключателей и кнопки; «Подробнее» свёрнуто.
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

/**
 * Семья плана: Ильяс 700 000 пришла 10-го, Аруна 500 000 ждём 20-го; траты обоих; очередь Отпуск → Машина →
 * Подушка. Машина просит 600 000 — остатка на всех не хватает: «Подушка» получает часть.
 */
function familyDoc(): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.map((g) => (g.id === 'car' ? { ...g, monthly: 600_000 } : g)),
    payments: [{ id: 'sal-a', kind: 'salary', targetId: 'a', period: KEY, amount: 700_000, accountId: null, by: 'a', at: '2026-09-10T05:00:00.000Z', updatedAt: T0 }],
    spendPlans: [
      { id: 'a:sc_taxi', by: 'a', categoryId: 'sc_taxi', amount: 80_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 },
  })
}

async function open(role: 'member' | 'viewer' = 'member', doc = familyDoc()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money')
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

/** Тот же план, что у экрана, — из `finance.ts`. */
function planOf(finance: ReturnType<typeof useFinanceStore>) {
  const ctx: MonthPlanCtx = { key: KEY, totals: finance.householdDoc.spendTotals ?? [], spendCategories: finance.householdDoc.spendCategories ?? [], uploads: [] }
  return monthPlan({ ...finance.householdDoc, credits: finance.credits, book: useFxStore().book }, ctx)
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 3; i++) await nextTick()
}
/** Нажатие: часы стоят (`toFake: Date`), а Vue пропускает событие не позже подключения обработчика — шаг времени. */
const press = (el: HTMLElement) => {
  vi.setSystemTime(new Date(Date.now() + 1000))
  el.click()
}
const norm = (s: string) => s.replace(/\s+/g, ' ')

describe('B2C-88: «План месяца» вверху «Денег»', () => {
  it('круг и суммы — из monthPlan: остаток, «из дохода», итог, зарплаты и «хватает» каждому', async () => {
    const finance = await open()
    const plan = planOf(finance)
    expect(plan.income.total).toBe(1_200_000)
    expect(txt(q('[data-rest]'))).toBe(norm(money(plan.rest)))
    expect(txt(document.body)).toContain(norm(`из ${plain(plan.income.total)}`))
    const sum = txt(q('[data-plan-sum]'))
    expect(sum).toContain(`Отложим${norm(money(plan.queueTotal))}`)
    expect(sum).toContain(`Потратим${norm(money(plan.outTotal))}`)
    for (const p of plan.byPerson) expect(txt(q(`[data-salary="${p.person}"] [data-left]`))).toBe(norm(p.left > 0 ? `+${plain(p.left)}` : plain(p.left)))
    expect(txt(q('[data-salary="a"]'))).toContain('✓ пришла')
    expect(txt(q('[data-salary="b"]'))).toContain('ждём 20 сентября')
    // Платежи с датой и плательщиком, траты каждого — план и раздел.
    expect(all('[data-due]').length).toBe(plan.dues.length)
    expect(txt(q('[data-spend="a"]'))).toContain(norm(plain(80_000)))
    // Очередь — по порядку, у первой цели — «главная».
    expect(all('[data-queue]').map((el) => el.dataset.queue)).toEqual(plan.queue.map((x) => x.id))
    expect(txt(q('[data-queue="trip"]'))).toContain('главная')
  })

  it('выключил цель — остаток и даты сменились сразу, она «на паузе»', async () => {
    const finance = await open()
    const before = planOf(finance)
    const cushionBefore = txt(q('[data-queue="cushion"] [data-status]'))
    expect(cushionBefore).toContain('получит')
    press(q<HTMLButtonElement>('[data-queue="trip"] [role="switch"]')!)
    await flush()
    const after = planOf(finance)
    expect(finance.goals.find((g) => g.id === 'trip')?.pausedAt).toBeTruthy()
    expect(after.rest).not.toBe(before.rest)
    expect(txt(q('[data-rest]'))).toBe(norm(money(after.rest)))
    expect(txt(q('[data-queue="trip"] [data-status]'))).toBe('на паузе')
    // Деньги «Отпуска» ушли ниже: «Подушка» теперь получает весь взнос, её срок появился.
    expect(txt(q('[data-queue="cushion"] [data-status]'))).not.toBe(cushionBefore)
    expect(txt(q('[data-queue="cushion"] [data-status]'))).toMatch(/· к /)
  })

  it('смена плательщика — «хватает» обоих пересчитано', async () => {
    const finance = await open()
    const leftOf = (id: string) => txt(q(`[data-salary="${id}"] [data-left]`))
    const a0 = leftOf('a')
    const b0 = leftOf('b')
    press(all('[data-due] button').find((b) => b.getAttribute('aria-label')?.startsWith('Платит'))!)
    await flush()
    const sheet = all('[role="dialog"] button').filter((b) => /Ильяс|Аруна/.test(b.textContent ?? ''))
    const other = sheet.find((b) => !b.textContent?.includes('✓'))!
    press(other)
    await flush()
    expect(finance.obligations.find((o) => o.id === 'rent')?.payer).toBeTruthy()
    expect(leftOf('a')).not.toBe(a0)
    expect(leftOf('b')).not.toBe(b0)
  })

  it('«Отложить по плану» — взносы плательщика по плану, запись kind plan; второй раз не появляется и не пишется', async () => {
    const finance = await open()
    const plan = planOf(finance)
    const mine = plan.queue.filter((x) => x.payer === 'a' && x.given > 0 && x.goalId)
    expect(mine.length).toBeGreaterThan(0)
    const haves = new Map(finance.goals.map((g) => [g.id, g.have]))
    press(q<HTMLButtonElement>('[data-plan-save]')!)
    await flush()
    for (const x of mine) expect(finance.goals.find((g) => g.id === x.goalId)!.have).toBe(haves.get(x.goalId!)! + x.given)
    const recs = (finance.householdDoc.allocations ?? []).filter((a) => a.kind === 'plan')
    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({ source: 'salary', sourceId: 'a', period: KEY })
    expect(q('[data-plan-save]')).toBeNull()
    expect(txt(q('[data-plan-saved]'))).toContain('Отложено')
    // План не изменился: взносы — от начала месяца.
    expect(planOf(finance).queue.map((x) => x.given)).toEqual(plan.queue.map((x) => x.given))
    // Повторный вызов (второй телефон до синка) — та же запись, взносов не прибавилось.
    const again = finance.applyPlan({ ...recs[0]!, record: { source: 'salary', sourceId: 'a', period: KEY }, total: 1, contributions: [{ goalId: 'trip', amount: 1 }], prepay: null, parts: [] } as never, { by: 'a', note: '' })
    expect(again.id).toBe(recs[0]!.id)
    expect(finance.goals.find((g) => g.id === 'trip')!.have).toBe(haves.get('trip')! + (mine.find((x) => x.goalId === 'trip')?.given ?? 0))
  })

  it('критик: старый разбор Блока 11 этого месяца — «Отложено» суммой взносов месяца, не статьями записи', async () => {
    const doc = familyDoc()
    // Разбор 12-го: в «Отпуск» положили 50 000; статьи записи — почти вся зарплата.
    const trip = doc.goals.find((g) => g.id === 'trip')!
    const goals = doc.goals.map((g) => (g.id === 'trip' ? { ...g, have: g.have + 50_000, movements: [{ id: 'm1', date: '2026-09-11T05:00:00.000Z', amount: 50_000, by: 'a' as const }] } : g))
    const allocations = [
      { id: 'old', kind: 'breakdown' as const, source: 'salary' as const, sourceId: 'a', period: KEY, by: 'a' as const, total: 700_000, at: T0, updatedAt: T0,
        parts: [{ target: 'must', amount: 400_000 }, { target: 'life', amount: 250_000 }, { target: 'dreams', amount: 50_000 }] },
    ]
    expect(trip.have).toBeGreaterThan(0)
    await open('member', { ...doc, goals, allocations } as SyncDoc)
    expect(q('[data-plan-save]')).toBeNull()
    expect(txt(q('[data-plan-saved]'))).toBe(`✓ Отложено ${norm(money(50_000))}`)
  })

  it('критик: ссылка «Истории» `/money?month=` в том же экране — открывает сводку того месяца', async () => {
    await open()
    expect(q('[data-rest]')).not.toBeNull()
    const router = app!.config.globalProperties.$router
    await router.push('/money?month=2026-08')
    await flush()
    expect(q('[data-month-past]')).not.toBeNull()
    expect(txt(q('[data-month-nav]'))).toContain('Август')
  })

  it('зарплата не пришла — брендовой кнопки нет', async () => {
    await open('member', { ...familyDoc(), payments: [] })
    expect(q('[data-plan-save]')).toBeNull()
  })

  it('viewer — тот же план без переключателей, плательщиков, правок и кнопки; «Подробнее» свёрнуто', async () => {
    const finance = await open('viewer')
    expect(txt(q('[data-rest]'))).toBe(norm(money(planOf(finance).rest)))
    expect(q('[data-queue] [role="switch"]')).toBeNull()
    expect(q('[data-grip]')).toBeNull()
    expect(all('button').some((b) => b.getAttribute('aria-label')?.startsWith('Платит'))).toBe(false)
    expect(q('[data-plan-save]')).toBeNull()
    expect(txt(document.body)).toContain('просмотр')
    expect(q<HTMLDetailsElement>('[data-more]')!.open).toBe(false)
  })

  it('‹ — прошлый месяц сводкой (только чтение), › — обратно к плану', async () => {
    await open()
    press(all('button').find((b) => b.getAttribute('aria-label') === 'Прошлый месяц')!)
    await flush()
    expect(q('[data-month-past]')).not.toBeNull()
    expect(q('[data-rest]')).toBeNull()
    expect(txt(q('[data-month-nav]'))).toContain('Август')
    press(all('button').find((b) => b.getAttribute('aria-label') === 'Следующий месяц')!)
    await flush()
    expect(q('[data-rest]')).not.toBeNull()
  })
})
