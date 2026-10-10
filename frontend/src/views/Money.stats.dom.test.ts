// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, planOf, T0 } from '@/test/planFamily'
import { capitalStats } from '@/lib/finance'
import { monthBy } from '@/lib/dates'
import { money, plain } from '@/lib/money'
import { plural } from '@/lib/utils'
import type { SyncDoc } from '@/types/finance'
import Money from '@/views/Money.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-05 (понятность Р-2, Р-3; эталон `capital-stats.html`): плашка Капитала — формула «счета − долги» под числом и
 * аккордеон статистики по нажатию. Числа — `capitalStats` (`finance.ts`); экран их не складывает.
 * Семья `planFamilyDoc` (сентябрь 2026): счета 2 000 000 + цели вне счетов 250 000 = 2 250 000; кредиты 1 540 000;
 * капитал 710 000. Доход 1 200 000; кредиты 58 000 + 25 000 + 20 000 + досрочка карточки 40 000 = 143 000; аренда 220 000.
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

function familyDoc(extra: Partial<SyncDoc> = {}): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.map((g) => (g.id === 'cushion' ? { ...g, accountId: 'card' } : g)),
    debtCard: { monthly: 40_000, payer: 'a', updatedAt: T0 },
    ...extra,
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

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')
const num = (el: Element | null) => {
  const t = txt(el)
  return (/[−-]/.test(t) ? -1 : 1) * Number(t.replace(/\D/g, ''))
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  for (let i = 0; i < 4; i++) await nextTick()
}
const plaque = () => q('[data-capital]')!
const statsOf = (finance: ReturnType<typeof useFinanceStore>) => capitalStats(finance.monthPlanOf(KEY), { ...finance.planState(), plans: finance.plans }, KEY)
/** Слово к числу зарплат — как на экране: дробь — «зарплаты», целое — по числу. */
const salaries = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${Number.isInteger(n) ? plural(n, 'зарплата', 'зарплаты', 'зарплат') : 'зарплаты'}`
const brandButtons = () => all('button').filter((b) => /(^|\s)bg-brand(\s|$)/.test(b.className))

describe('PN-05: плашка Капитала — формула «счета − долги» и аккордеон статистики', () => {
  it('закрыто: формула под числом, подсказки «?» нет, строк статистики нет; плашка — кнопка с aria-expanded', async () => {
    await open()
    expect(num(q('[data-worth]'))).toBe(710_000)
    expect(txt(q('[data-worth-formula]'))).toBe(`счета ${norm(plain(2_250_000))} − долги ${norm(plain(1_540_000))}`)
    expect(q('[aria-label="Что такое капитал"]')).toBeNull()
    expect(q('[role="note"]')).toBeNull()
    expect(plaque().getAttribute('role')).toBe('button')
    expect(plaque().getAttribute('aria-expanded')).toBe('false')
    for (const sel of ['[data-stat-row]', '[data-growth]', '[data-debt-free]', '[data-capital-stats-body]']) expect(q(sel), sel).toBeNull()
    expect(brandButtons()).toEqual([])
  })

  it('нажатие — четыре строки = capitalStats (суммы и %), рост до тысяч, срок и переплата с зарплатами; второе нажатие — закрыто', async () => {
    const finance = await open()
    const s = statsOf(finance)
    await press(plaque())
    expect(plaque().getAttribute('aria-expanded')).toBe('true')
    expect(all('[data-stat-row]').map((r) => r.dataset.statRow)).toEqual(['credits', 'payments', 'goals', 'rest'])
    for (const p of s.parts) {
      const row = q(`[data-stat-row="${p.key}"]`)!
      expect(num(row.querySelector('[data-stat-amount]')), p.key).toBe(p.amount)
      expect(txt(row.querySelector('[data-stat-pct]')), p.key).toBe(`${p.pct} %`)
    }
    expect(num(q('[data-stat-row="credits"] [data-stat-amount]'))).toBe(143_000)
    expect(num(q('[data-stat-row="payments"] [data-stat-amount]'))).toBe(220_000)
    expect(q('[data-short]')).toBeNull()
    expect(q('[data-no-income]')).toBeNull()
    expect(s.growth).toBeGreaterThan(0)
    expect(txt(q('[data-growth]'))).toBe(`Капитал растёт на ~${norm(money(Math.round(s.growth / 1000) * 1000))} в месяц`)
    expect(s.debtFree.month).not.toBeNull()
    expect(txt(q('[data-debt-free]'))).toBe(`Без долгов ${monthBy(s.debtFree.month!)} · ещё ${salaries(s.debtFree.salaries!)}`)
    expect(s.overpay.amount).toBeGreaterThan(0)
    expect(txt(q('[data-overpay]'))).toBe(`Переплата ${norm(money(s.overpay.amount!))} · ${salaries(s.overpay.salaries!)}`)
    // Полоска — четыре доли цветами токенов макета: кредиты --s12, платежи --s1, в цели --s3, остаётся --ok.
    const dots = all('[data-stat-row] i').map((i) => i.style.background)
    expect(dots).toEqual(['var(--s12)', 'var(--s1)', 'var(--s3)', 'var(--ok)'])
    expect(brandButtons()).toEqual([])
    await press(plaque())
    expect(plaque().getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-stat-row]')).toBeNull()
  })

  it('viewer раскрывает так же (читает)', async () => {
    const finance = await open('viewer')
    await press(plaque())
    expect(all('[data-stat-row]')).toHaveLength(4)
    expect(num(q('[data-stat-row="rest"] [data-stat-amount]'))).toBe(statsOf(finance).parts.find((p) => p.key === 'rest')!.amount)
  })

  it('без кредитов: формула «счета N · долгов нет», три доли, строка «Долгов нет» без срока и переплаты', async () => {
    await open('member', familyDoc({ credits: [] }))
    expect(num(q('[data-worth]'))).toBe(2_250_000)
    expect(txt(q('[data-worth-formula]'))).toBe(`счета ${norm(plain(2_250_000))} · долгов нет`)
    await press(plaque())
    expect(all('[data-stat-row]').map((r) => r.dataset.statRow)).toEqual(['payments', 'goals', 'rest'])
    expect(txt(q('[data-debt-free]'))).toBe('Долгов нет')
    expect(q('[data-overpay]')).toBeNull()
  })

  it('дохода нет — одна строка «Нет дохода месяца — задайте оклад», ни полоски, ни строк', async () => {
    const base = familyDoc()
    await open('member', familyDoc({ people: base.people.map((p) => ({ ...p, salary: 0 })) }))
    await press(plaque())
    expect(txt(q('[data-no-income]'))).toBe('Нет дохода месяца — задайте оклад')
    for (const sel of ['[data-stat-row]', '[data-growth]', '[data-debt-free]']) expect(q(sel), sel).toBeNull()
  })

  it('не хватает на платежи: «остаётся» 0 и подпись «не хватает N»', async () => {
    const base = familyDoc()
    const finance = await open('member', familyDoc({ people: base.people.map((p) => ({ ...p, salary: p.id === 'a' ? 100_000 : 50_000 })) }))
    const s = statsOf(finance)
    expect(s.short).toBeGreaterThan(0)
    await press(plaque())
    expect(num(q('[data-stat-row="rest"] [data-stat-amount]'))).toBe(0)
    expect(txt(q('[data-short]'))).toBe(`не хватает ${norm(money(s.short))}`)
    expect(q('[data-short]')!.classList.contains('text-warn')).toBe(true)
    // Процентов от дохода нет — они были бы больше 100 (платежи 323 000 от 150 000 — 215 %), шумная цифра (ux Б2).
    expect(s.parts.some((p) => p.pct > 100)).toBe(true)
    expect(all('[data-stat-row]')).toHaveLength(4)
    expect(q('[data-stat-pct]')).toBeNull()
  })

  it('кредит не закрывается при нынешнем платеже — «Долги не закрываются при текущих платежах», переплаты нет', async () => {
    const base = familyDoc()
    await open('member', familyDoc({ credits: base.credits!.map((c) => (c.id === 'cc' ? { ...c, payment: 9_000 } : c)) }))
    await press(plaque())
    expect(txt(q('[data-debt-free]'))).toBe('Долги не закрываются при текущих платежах')
    expect(q('[data-overpay]')).toBeNull()
  })

  it('с планом «Сначала долги» — переплата за вычетом его экономии (та же capitalStats)', async () => {
    const finance = await open('member', familyDoc({ plans: [planOf()] }))
    const s = statsOf(finance)
    await press(plaque())
    expect(txt(q('[data-overpay]'))).toBe(`Переплата ${norm(money(s.overpay.amount!))} · ${salaries(s.overpay.salaries!)}`)
    expect(txt(q('[data-debt-free]'))).toContain(monthBy(s.debtFree.month!))
  })

  it('только беспроцентная рассрочка: «Без долгов к …» есть, строки переплаты нет — переплачивать нечего (критик)', async () => {
    const base = familyDoc()
    const finance = await open('member', familyDoc({ credits: base.credits!.filter((c) => c.id === 'inst') }))
    const s = statsOf(finance)
    expect(s.overpay).toEqual({ amount: 0, salaries: 0 })
    await press(plaque())
    expect(txt(q('[data-debt-free]'))).toBe(`Без долгов ${monthBy(s.debtFree.month!)} · ещё ${salaries(s.debtFree.salaries!)}`)
    expect(q('[data-overpay]')).toBeNull()
  })

  it('переплата меньше 0,05 зарплаты: сумма есть, «0 зарплат» не пишется (критик: шумной цифры нет)', async () => {
    const base = familyDoc()
    // Одна кредитка 300 000 под 40 % с платежом 100 000: закроется за 4 платежа, переплата ≈ 21 000 — 0,02 дохода 1 200 000.
    const finance = await open('member', familyDoc({ credits: base.credits!.filter((c) => c.id === 'cc').map((c) => ({ ...c, payment: 100_000 })) }))
    const s = statsOf(finance)
    expect(s.overpay.amount).toBeGreaterThan(0)
    expect(s.overpay.salaries).toBe(0)
    await press(plaque())
    expect(txt(q('[data-overpay]'))).toBe(`Переплата ${norm(money(s.overpay.amount!))}`)
    expect(txt(q('[data-debt-free]'))).toContain('· ещё')
  })

  it('при новом заходе на экран — снова закрыто', async () => {
    await open()
    await press(plaque())
    expect(q('[data-stat-row]')).not.toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    await open()
    expect(plaque().getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-stat-row]')).toBeNull()
  })
})
