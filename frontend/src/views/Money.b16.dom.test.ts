// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { capitalGoals, monthSalaries } from '@/lib/finance'
import type { Payment, SyncDoc } from '@/types/finance'
import Money from '@/views/Money.vue'
import Month from '@/views/Month.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Блок 16 (Р-108…Р-111, эталон money-b16.html): «Деньги» по макету — «Капитал» с зарплатами для справки и «Цели · N»
 * в «Счетах», «Долги» и «История». Числа — из `finance.ts`; экран их не складывает.
 */
let app: App | null = null
let router: Router

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
const paid = (kind: Payment['kind'], targetId: string, period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `${kind}-${targetId}-${period}`, kind, targetId, period, amount, accountId: 'card', by: 'a', at: `${period}-10T05:00:00.000Z`, updatedAt: T0, ...extra,
})

/**
 * Семья: Kaspi Gold 2 000 000; Подушка 400 000 лежит на Kaspi Gold, Отпуск 50 000 и Машина 200 000 — вне счетов;
 * кредиты 1 000 000 + 300 000 + 240 000 = 1 540 000. Счета: 2 000 000 + 250 000 = 2 250 000; капитал — 710 000.
 * Зарплата Ильяса за август пришла на Kaspi Gold — сентябрьская ждёт (10-го, сегодня 12-е): «Пришла» одним нажатием.
 */
function familyDoc(extra: Partial<SyncDoc> = {}): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.map((g) => (g.id === 'cushion' ? { ...g, accountId: 'card' } : g)),
    payments: [paid('salary', 'a', '2026-08', 700_000)],
    ...extra,
  })
}

async function open(role: 'member' | 'viewer' = 'member', doc = familyDoc(), path = '/money', view = Money) {
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
  await nextTick()
  return finance
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** Сумма с экрана в целых тенге: «−1 540 000 ₸» → −1540000. */
const num = (el: Element | null) => {
  const t = txt(el)
  return (/[−-]/.test(t) ? -1 : 1) * Number(t.replace(/\D/g, ''))
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const dialog = () => q('[role="dialog"]')
const dialogButton = (label: string) => all('[role="dialog"] button').find((b) => txt(b).startsWith(label))

describe('B2C-100: «Капитал» — зарплаты для справки и «Цели · N» в «Счетах»', () => {
  it('«Счета» − «Кредиты» = «Капитал» на экране; цели вне счетов — в итоге «Счетов»', async () => {
    const finance = await open()
    const goals = capitalGoals(finance.goals, finance.accounts)
    expect(num(q('[data-accounts-total]'))).toBe(2_250_000)
    expect(num(q('[data-goals-total]'))).toBe(goals.total)
    expect(num(q('[data-credits-total]'))).toBe(1_540_000)
    expect(num(q('[data-accounts-total]')) - num(q('[data-credits-total]'))).toBe(num(q('[data-worth]')))
    expect(num(q('[data-worth]'))).toBe(710_000)
    // Брендовой кнопки на экране нет (правило 12).
    expect(all('button').filter((b) => /(^|\s)bg-brand(\s|$)/.test(b.className))).toEqual([])
  })

  it('«Цели · N» свёрнута; раскрытие — цели, на счёте — «на Kaspi Gold», серой суммой; нажатие цели — её экран', async () => {
    await open()
    const head = q('[data-goals] button')!
    expect(txt(head)).toContain('Цели · 2')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-goal]')).toBeNull()
    await press(head)
    expect(all('[data-goal]').map((r) => r.dataset.goal)).toEqual(['car', 'trip', 'cushion'])
    const cushion = q('[data-goal="cushion"]')!
    expect(txt(cushion)).toContain('на Kaspi Gold — уже в счёте')
    expect(cushion.querySelector('.num')!.className).toContain('text-ink-3')
    expect(q('[data-goal="trip"] .num')!.className).not.toContain('text-ink-3')
    await press(q('[data-goal="trip"] button'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/goals/trip'))
  })

  it('зарплаты: ✓ у пришедшей, «ждём <дата>» — у ждущей; строки = monthSalaries', async () => {
    const doc = familyDoc()
    const finance = await open('member', { ...doc, payments: [...doc.payments!, paid('salary', 'b', KEY, 500_000, { by: 'b', at: '2026-09-11T05:00:00.000Z' })] })
    const lines = monthSalaries(finance.monthPlanOf(KEY), { people: finance.people, payments: finance.payments })
    expect(lines.map((s) => [s.person, s.came])).toEqual([['a', false], ['b', true]])
    expect(txt(q('[data-capital-salaries] [data-salary="a"] [data-salary-status]'))).toBe('ждём 10 сентября')
    expect(q('[data-capital-salaries] [data-salary="a"] [data-came]')).toBeNull()
    expect(txt(q('[data-capital-salaries] [data-salary="b"] [data-salary-status]'))).toBe('пришла 11 сентября')
    expect(num(q('[data-capital-salaries] [data-salary="b"] b'))).toBe(500_000)
  })

  it('строка зарплаты — тот же лист, что в «Месяце»; «Пришла» из «Капитала» пишет ту же отметку', async () => {
    const finance = await open()
    await press(q('[data-capital-salaries] [data-salary="a"]'))
    const fromCapital = txt(dialog())
    expect(fromCapital).toContain('Зарплата · Ильяс')
    expect(fromCapital).toContain('ждём 10 сентября')
    expect(dialogButton('Изменить оклад')).toBeTruthy()
    await press(dialogButton('Пришла зарплата'))
    // Лист закрылся сам — ✓ у суммы в строке (как в «Месяце»).
    expect(dialog()).toBeNull()
    expect(q('[data-capital-salaries] [data-salary="a"] [data-came]')).not.toBeNull()
    const marks = finance.payments.filter((p) => p.kind === 'salary' && p.period === KEY && !p.deletedAt)
    expect(marks).toMatchObject([{ targetId: 'a', amount: 700_000, accountId: 'card', by: 'a' }])

    // В «Месяце» — тот же лист (общий компонент): тот же текст до «Пришла».
    app?.unmount()
    document.body.innerHTML = ''
    await open('member', familyDoc(), '/month', Month)
    await press(q('[data-salary="a"]'))
    expect(txt(dialog())).toBe(fromCapital)
  })

  it('viewer — строки без нажатия, листа нет', async () => {
    await open('viewer')
    const row = q('[data-capital-salaries] [data-salary="a"]')!
    expect(row.tagName).toBe('DIV')
    await press(row)
    expect(dialog()).toBeNull()
  })
})
