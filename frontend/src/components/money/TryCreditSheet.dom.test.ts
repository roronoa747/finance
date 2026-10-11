// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { planFamilyDoc } from '@/test/planFamily'
import { tryCredit } from '@/lib/finance'
import { money } from '@/lib/money'
import TryCreditSheet from './TryCreditSheet.vue'

/**
 * PN-17: лист «Прикинуть кредит» — строки из `tryCredit` на той же семье (`planFamilyDoc`, сентябрь 2026), рассрочка
 * «без переплаты», пустые поля — подсказка, документ после прикидки прежний.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(TryCreditSheet, { open: true }) })
  app.use(pinia)
  app.mount(root)
  await flush()
  return store
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')
async function type(sel: string, value: string) {
  const input = q(sel) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}
const chip = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-try-terms] button')].find((b) => txt(b) === label)!
const segment = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => txt(b) === label)!

describe('PN-17: «Прикинуть кредит»', () => {
  it('пустые поля — подсказка, результата нет', async () => {
    await open()
    expect(q('[data-try-result]')).toBeNull()
    expect(txt(q('[data-try-empty]'))).toBe('Введите сумму')
    // Сумма есть, ставки нет — ещё не считаем; подсказка называет, чего не хватает (`/ux` Б5).
    await type('[data-try-sum]', '1000000')
    expect(q('[data-try-result]')).toBeNull()
    expect(txt(q('[data-try-empty]'))).toBe('Введите ставку')
    await chip('свой').click()
    await flush()
    expect(txt(q('[data-try-empty]'))).toBe('Введите срок')
  })

  it('1 000 000 на 24 месяца под 20 %: платёж, нагрузка, мечта, переплата — из tryCredit; документ не меняется', async () => {
    const store = await open()
    const before = JSON.stringify(store.householdDoc)
    await type('[data-try-sum]', '1000000')
    chip('24').click()
    await flush()
    await type('[data-try-rate]', '20')
    const { state, ctx } = store.planInput('2026-09')
    const r = tryCredit(state, ctx, { principal: 1_000_000, months: 24, annualRate: 0.2 })
    expect(norm(txt(q('[data-try-payment]')))).toBe(norm(money(r.payment)))
    expect(txt(q('[data-try-load]'))).toBe(`Нагрузка станет ${r.loadPct} % дохода · сейчас ${r.loadNowPct} %`)
    expect(r.hero).not.toBeNull()
    expect(txt(q('[data-try-hero]'))).toContain(r.hero!.name)
    expect(norm(txt(q('[data-try-overpay]')))).toContain(norm(`Переплата ${money(r.overpay)}`))
    expect(txt(q('[data-try-overpay]'))).toContain('зарплаты')
    expect(JSON.stringify(store.householdDoc)).toBe(before)
  })

  it('рассрочка 0 % — «Без переплаты», поля ставки нет; «свой» срок — своё число', async () => {
    const store = await open()
    await type('[data-try-sum]', '600000')
    segment('Рассрочка 0 %').click()
    await flush()
    expect(q('[data-try-rate]')).toBeNull()
    chip('свой').click()
    await flush()
    await type('[data-try-own]', '10')
    const { state, ctx } = store.planInput('2026-09')
    const r = tryCredit(state, ctx, { principal: 600_000, months: 10, annualRate: 0 })
    expect(r.payment).toBe(60_000)
    expect(norm(txt(q('[data-try-payment]')))).toBe(norm(money(60_000)))
    expect(txt(q('[data-try-overpay]'))).toBe('Без переплаты')
  })

  it('нагрузка от 50 % — цветом предупреждения', async () => {
    await open()
    await type('[data-try-sum]', '3000000')
    chip('6').click()
    await flush()
    await type('[data-try-rate]', '20')
    expect(q('[data-try-load]')!.className).toContain('text-warn')
  })
})
