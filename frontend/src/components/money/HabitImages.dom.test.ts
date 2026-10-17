// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { habitImages, imageLine, imageMath, interestImage } from '@/lib/finance'
import { PRICES } from '@/lib/prices'
import type { HabitId, HabitTotal } from '@/lib/statements/types'
import type { PersonId, SpendPlan, SyncDoc } from '@/types/finance'
import Month from '@/views/Month.vue'
import Money from '@/views/Money.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * AU-29: строка-образ в листе раздела «Месяца» и строка процентов на «Долгах» — показ `habitImages` / `interestImage`
 * (экран не считает); «?» «Как посчитали» — всем ролям; действие — небольшой кнопкой у строки, у viewer её нет.
 * Сентябрь 2026: закрытые месяцы — июнь, июль, август.
 */
let app: App | null = null
let router: Router

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-17T07:00:00Z'))
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
const MONTHS = ['2026-06', '2026-07', '2026-08']
const every = (by: PersonId, habit: HabitId, count: number, amount: number): HabitTotal[] =>
  MONTHS.map((m) => ({ id: `${by}:${m}:${habit}`, by, period: m, habit, count, amount, updatedAt: T0 }))
const plan = (by: PersonId, categoryId: string, amount: number): SpendPlan => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })

/**
 * Такси у Ильяса 92 000 в месяц, доставка у Аруны 40 000; мечты — Отпуск (3 000 000, есть 50 000, 40 000 в месяц) и
 * подушка, «Машины» нет. Планы: транспорт Ильяса 30 000, кафе — Ильяс 50 000, Аруна 20 000; продукты — без образа.
 */
function familyDoc(extra: Partial<SyncDoc> = {}): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.filter((g) => g.id !== 'car'),
    goalOrder: { ids: ['trip', 'cushion'], updatedAt: T0 },
    habitTotals: [...every('a', 'taxi', 46, 92_000), ...every('b', 'delivery', 8, 40_000)],
    spendPlans: [plan('a', 'sc_transport', 30_000), plan('a', 'sc_cafe', 50_000), plan('b', 'sc_cafe', 20_000), plan('b', 'sc_food', 150_000)],
    ...extra,
  })
}

async function open(role: 'member' | 'viewer' = 'member', doc = familyDoc(), path = '/month', view = Month) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return finance
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const imagesOf = (finance: ReturnType<typeof useFinanceStore>) => habitImages(finance.planInput(KEY).state, KEY)
async function openCategory(id: string) {
  await press(q('[data-section="spend"]'))
  await press(q(`[data-spend-row="${id}"]`))
}

describe('строка-образ в листе раздела', () => {
  it('«Транспорт»: такси → своя машина; «?» — цена, источник, дата и расчёт; «Сделать мечтой» → мечта с ценой и взносом', async () => {
    const finance = await open()
    const taxi = imagesOf(finance).find((i) => i.habit === 'taxi')!
    await openCategory('sc_transport')
    expect(all('[role="dialog"] [data-image]').length).toBe(1)
    expect(txt(q('[role="dialog"] [data-image-line]'))).toBe(norm(imageLine(taxi)))
    // «?» — сначала открыть.
    expect(q('[data-image-math]')).toBeNull()
    await press(q('[role="dialog"] [data-image] button[aria-label="Как посчитали"]'))
    const math = imageMath(taxi)
    expect(txt(q('[data-image-item]'))).toBe(norm(math.item))
    expect(q<HTMLAnchorElement>('[data-image-source] a')!.href).toBe(PRICES.car_used.url)
    expect(txt(q('[data-image-source]'))).toContain('17 октября 2026')
    expect(all('[data-image-calc]').map(txt)).toEqual(math.lines.map(norm))

    expect(txt(q('[data-image-act]'))).toBe('Сделать мечтой')
    await press(q('[data-image-act]'))
    const car = finance.goals.find((g) => g.template === 'car' && !g.deletedAt)!
    expect([car.name, car.need, car.monthly]).toEqual(['Машина', PRICES.car_used.price, 92_000])
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/goals/${car.id}`))
  })

  it('viewer — строка и «?» без кнопки', async () => {
    await open('viewer')
    await openCategory('sc_transport')
    expect(q('[role="dialog"] [data-image-line]')).not.toBeNull()
    expect(q('[data-image-act]')).toBeNull()
    await press(q('[role="dialog"] [data-image] button[aria-label="Как посчитали"]'))
    expect(all('[data-image-calc]').length).toBe(2)
  })

  it('нет образа — строки нет («Продукты»)', async () => {
    await open()
    await openCategory('sc_food')
    expect(q('[role="dialog"] [data-cat-amount]')).not.toBeNull()
    expect(q('[data-image]')).toBeNull()
  })

  it('«Кафе»: доставка → «Перенести в мечту»: план Ильяса 50 000 → 30 000, взнос «Отпуска» 40 000 → 60 000; «Отменить» — прежние', async () => {
    const finance = await open()
    const delivery = imagesOf(finance).find((i) => i.categoryId === 'sc_cafe')!
    expect(delivery.action).toMatchObject({ kind: 'move', amount: 20_000, goalId: 'trip' })
    await openCategory('sc_cafe')
    expect(txt(q('[data-image-act]'))).toBe('Перенести в мечту')
    await press(q('[data-image-act]'))
    expect(txt(q('[role="dialog"] h3'))).toBe('Перенести в мечту')
    expect(txt(q('[data-move-from]'))).toBe(norm('−20 000 из плана «Кафе и рестораны» · Ильяс'))
    expect(txt(q('[data-move-to]'))).toBe(norm('+20 000 в мечту «Отпуск»'))
    await press(q('[data-move-confirm]'))
    const cafeA = () => finance.householdDoc.spendPlans!.find((s) => s.id === 'a:sc_cafe')!.amount
    const trip = () => finance.goals.find((g) => g.id === 'trip')!.monthly
    expect([cafeA(), trip()]).toEqual([30_000, 60_000])
    expect(finance.householdDoc.spendPlans!.find((s) => s.id === 'b:sc_cafe')!.amount).toBe(20_000)
    expect(q('[data-move-toast]')).not.toBeNull()
    // Перенос запомнен (Х-9): в листе раздела вместо кнопки — «✓ 20 000 в мечту».
    expect(imagesOf(finance).find((i) => i.categoryId === 'sc_cafe')).toMatchObject({ action: null, moved: 20_000 })
    await press(q('[data-toast-action]'))
    expect([cafeA(), trip()]).toEqual([50_000, 40_000])
    expect(finance.householdDoc.imageMoves!.every((x) => x.deletedAt)).toBe(true)
    await press(q('[data-spend-row="sc_cafe"]'))
    expect(txt(q('[data-image-act]'))).toBe('Перенести в мечту')
    expect(q('[data-image-moved]')).toBeNull()
  })

  it('перенос уже сделан (Х-9): «✓ 20 000 в мечту» вместо кнопки — и у viewer', async () => {
    const move = { id: 'm1', categoryId: 'sc_cafe', goalId: 'trip', amount: 20_000, by: 'a' as const, at: T0, updatedAt: T0 }
    await open('viewer', { ...familyDoc(), imageMoves: [move] })
    await openCategory('sc_cafe')
    expect(txt(q('[data-image-moved]'))).toBe(norm('✓ 20 000 в мечту'))
    expect(q('[data-image-act]')).toBeNull()
  })

  it('кофе → «В желания»: желание «Кофемашина» с ценой справочника, тост', async () => {
    const finance = await open('member', familyDoc({ habitTotals: every('a', 'coffee', 20, 30_000) }))
    await openCategory('sc_cafe')
    expect(txt(q('[data-image-act]'))).toBe('В желания')
    await press(q('[data-image-act]'))
    expect(finance.wishlist.filter((w) => !w.deletedAt).map((w) => [w.name, w.price])).toEqual([['Кофемашина', PRICES.coffee_machine.price]])
    expect(txt(q('[data-toast]'))).toContain('В желаниях')
  })
})

describe('строка процентов на «Долгах»', () => {
  it('с кредитами под ставку — строка и «?» с расчётом, без второй кнопки; без них — строки нет', async () => {
    const finance = await open('member', familyDoc(), '/money/debts', Money)
    const img = interestImage(finance.planState())!
    expect(txt(q('[data-debts-interest] [data-image-line]'))).toBe(norm(imageLine(img)))
    expect(q('[data-debts-interest] [data-image-act]')).toBeNull()
    await press(q('[data-debts-interest] button[aria-label="Как посчитали"]'))
    expect(all('[data-image-calc]').map(txt)).toEqual(imageMath(img).lines.map(norm))
    app!.unmount()
    document.body.innerHTML = ''
    const doc = familyDoc()
    await open('member', { ...doc, credits: doc.credits.filter((c) => c.annualRate === 0) }, '/money/debts', Money)
    expect(q('[data-debts-interest]')).toBeNull()
  })
})
