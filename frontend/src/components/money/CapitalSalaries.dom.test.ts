// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { Payment } from '@/types/finance'
import CapitalSalaries from './CapitalSalaries.vue'

/**
 * PN-02 (хвост 1022): «Пришла» — у своей открытой строки зарплаты и в «Капитале» (правило 12 «действие у предмета»):
 * та же одна отметка, что в листе (`useSalaryTap`), лист строки не открывает; партнёр и viewer — без кнопки. Строка —
 * `div` с кнопкой имени (`data-row-open`), не кнопка в кнопке (ревью Н-7). Семья — `planFamilyDoc`, 12 сентября:
 * зарплата Ильяса (10-го) открыта, Аруны (20-го) — нет.
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
})

const KEY = '2026-09'
/** В августе зарплата Ильяса пришла на карту — счёт для одного нажатия (Р-5). */
const augustSalary: Payment = { id: 'sal-a-08', kind: 'salary', targetId: 'a', period: '2026-08', amount: 700_000, accountId: 'card', by: 'a', at: '2026-08-10T05:00:00.000Z', updatedAt: T0 }

async function open(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', payments: Payment[] = [augustSalary]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc({ payments }), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(CapitalSalaries)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return { finance, router }
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** Нажатие: часы стоят (`toFake: Date`), а Vue пропускает событие не позже подключения обработчика — шаг времени. */
const press = async (el: HTMLElement | null) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  for (let i = 0; i < 4; i++) await nextTick()
}
const salaries = (finance: ReturnType<typeof useFinanceStore>) => finance.payments.filter((p) => !p.deletedAt && p.kind === 'salary' && p.period === KEY)

describe('PN-02: «Пришла» у своей строки зарплаты в «Капитале»', () => {
  it('кнопка только у своей открытой: Ильяс видит у себя, не у Аруны; партнёр (слот b) и viewer — нет; строка — div с кнопкой имени, без кнопки в кнопке', async () => {
    await open()
    const btn = q('[data-capital-salaries] [data-salary="a"][data-can-mark] [data-salary-came-btn]')
    expect(btn).not.toBeNull()
    expect(txt(btn)).toBe('Пришла')
    expect(btn!.className).not.toContain('bg-brand ')
    expect(q('[data-salary="b"] [data-salary-came-btn]')).toBeNull()
    for (const slot of ['a', 'b']) {
      const row = q(`[data-salary="${slot}"]`)!
      expect(row.tagName).toBe('DIV')
      const main = row.querySelector<HTMLElement>('[data-row-open]')!
      expect(main.tagName).toBe('BUTTON')
      expect(main.querySelector('button')).toBeNull()
      expect(txt(main)).toBe(slot === 'a' ? 'Ильяс' : 'Аруна')
    }

    app?.unmount()
    document.body.innerHTML = ''
    await open('member', 'b')
    expect(q('[data-salary-came-btn]')).toBeNull()

    app?.unmount()
    document.body.innerHTML = ''
    await open('viewer')
    expect(q('[data-salary-came-btn]')).toBeNull()
    expect(q('[data-capital-salaries]')).not.toBeNull()
  })

  it('нажатие — одна отметка на счёт прошлого раза, лист не открывается, дальше — план месяца (Р-78, как в листе); после — ✓, кнопки нет; строка открывает лист зарплаты', async () => {
    const { finance, router } = await open()
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(q('[role="dialog"]')).toBeNull()
    expect(salaries(finance)).toHaveLength(1)
    expect(salaries(finance)[0]).toMatchObject({ targetId: 'a', period: KEY, amount: 700_000, accountId: 'card', by: 'a' })
    // Экран «Месяца» грузится лениво — переход дожидаемся.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/month'))
    expect(q('[data-salary="a"] [data-came]')).not.toBeNull()
    expect(q('[data-salary="a"] [data-salary-came-btn]')).toBeNull()
    // Строка по-прежнему открывает тот же лист зарплаты, что в «Месяце»: «пришла», «Другая сумма или снять».
    await press(q('[data-salary="a"] [data-row-open]'))
    expect(txt(q('[role="dialog"] [data-salary-status]'))).toContain('пришла')
    expect([...document.querySelectorAll('[role="dialog"] button')].map((b) => txt(b))).toContain('Другая сумма или снять')
  })

  it('прошлого счёта нет — лист отметки «спрашиваем один раз», не лист зарплаты; записи нет', async () => {
    const { finance } = await open('member', 'a', [])
    await press(q('[data-salary="a"] [data-salary-came-btn]'))
    expect(txt(q('[role="dialog"]'))).toContain('Спрашиваем один раз')
    expect(q('[role="dialog"] [data-salary-status]')).toBeNull()
    expect(salaries(finance)).toHaveLength(0)
  })
})
