// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { plain } from '@/lib/money'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import PayoffSheet from './PayoffSheet.vue'

/**
 * Калькулятор досрочки (пачка 2 «Figma», 51:873, FG-25): пояснение поля — «?» у подписи; итог — одна крупная «−N мес.» и
 * «переплата меньше на N ₸» зелёным, «осталось N платежей» и «половину переплаты…» — в «?» у итога; лесенка «Отдача падает» —
 * под «Подробнее ›», по умолчанию закрыта. Числа — те же функции `finance.ts`, лист их не считает.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function open(creditId = 'loan') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(PayoffSheet, { creditId }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const tick = async () => {
  for (let i = 0; i < 3; i++) await nextTick()
}

async function type(value: string) {
  const input = q<HTMLInputElement>('[role="dialog"] input[inputmode]')!
  input.value = value
  input.dispatchEvent(new Event('input'))
  await tick()
}

describe('FG-25: калькулятор досрочки', () => {
  it('без суммы — итога нет, абзаца нет; у подписи поля — «?» с пояснением', async () => {
    await open()
    expect(q('[data-payoff-result]')).toBeNull()
    expect(document.body.textContent).not.toContain('Впишите сумму')
    const hint = q<HTMLButtonElement>('[aria-label="Какую сумму вписать"]')!
    hint.click()
    await tick()
    expect(txt(q('[role="note"]'))).toBe('Сумма, которую действительно можете добавлять каждый месяц — больше приложение не предложит')
  })

  it('сумма — «−N мес.» крупно, «переплата меньше на N ₸» зелёным; «осталось N платежей» — в «?» у итога', async () => {
    await open()
    await type(plain(58_000))
    const months = q('[data-payoff-months]')!
    expect(txt(months)).toMatch(/^−\d+ мес\.$/)
    expect(months.className).toContain('text-[28px]')
    const saved = q('[data-payoff-saved]')!
    expect(txt(saved)).toMatch(new RegExp(`^переплата меньше на ${'\\d'}`))
    expect(saved.textContent).toContain('₸')
    expect(saved.className).toContain('text-ok')
    expect(document.body.textContent).not.toContain('экономия')
    q<HTMLButtonElement>('[aria-label="Что меняется"]')!.click()
    await tick()
    expect(txt(q('[role="note"]'))).toMatch(/^Останется \d+ платеж(а|ей)? вместо \d+\./)
  })

  it('лесенка «Отдача падает» — под «Подробнее», закрыта по умолчанию; после нажатия — видна', async () => {
    await open()
    const details = q<HTMLDetailsElement>('[data-payoff-ladder]')!
    expect(details.open).toBe(false)
    expect(txt(details.querySelector('summary'))).toBe('Подробнее')
    details.querySelector('summary')!.click()
    await tick()
    expect(details.open).toBe(true)
    expect(details.textContent).toContain('Отдача падает')
    expect(details.querySelectorAll('.num').length).toBeGreaterThan(0)
    expect(details.textContent).toMatch(/−\d+ мес\./)
    expect(details.textContent).toContain('₸')
  })

  it('«Разово» — пояснение поля про разовую сумму, в «?» итога нет «половины переплаты» (она про добавку в месяц)', async () => {
    await open()
    const once = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[aria-pressed]')].find((b) => b.textContent?.trim() === 'Разово')!
    once.click()
    await tick()
    q<HTMLButtonElement>('[aria-label="Какую сумму вписать"]')!.click()
    await tick()
    expect(txt(q('[role="note"]'))).toBe('Сумма, которую действительно можете внести разом — больше приложение не предложит')
    await type(plain(500_000))
    q<HTMLButtonElement>('[aria-label="Что меняется"]')!.click()
    await tick()
    const notes = [...document.querySelectorAll('[role="note"]')].map(txt).join(' ')
    expect(notes).toMatch(/Останется \d+ платеж/)
    expect(notes).not.toContain('Половину переплаты')
  })

  it('добавка, с которой срок почти не меняется, — «Срок почти не изменится» и та же строка переплаты', async () => {
    await open()
    await type('1')
    expect(txt(q('[data-payoff-months]'))).toBe('Срок почти не изменится')
    expect(q('[data-payoff-saved]')).not.toBeNull()
  })
})
