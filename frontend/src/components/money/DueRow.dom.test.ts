// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type App } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { PlanDue } from '@/lib/finance'
import DueRow from './DueRow.vue'

/** F2-Х2 (FG-10, Р-8 «Figma»): «Оплатил» небольшой кнопкой в строке платежа «Месяца». */
let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const T0 = '2026-09-01T00:00:00.000Z'
const rent: PlanDue = {
  kind: 'obligation',
  targetId: 'rent',
  name: 'Аренда',
  day: 5,
  amount: 220_000,
  paid: false,
  payer: 'a',
  obligation: { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
}

function mount(props: Record<string, unknown>) {
  const events: string[] = []
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () =>
      h(DueRow, {
        id: 'obligation:rent', due: rent, mon: 'сен', payerName: 'Ильяс', canEdit: true, ...props,
        onOpen: () => events.push('open'), onPayer: () => events.push('payer'), onPay: () => events.push('pay'),
      }),
  })
  app.use(createPinia())
  app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }))
  app.mount(root)
  return events
}
const payBtn = () => document.querySelector<HTMLButtonElement>('[data-due-pay]')

describe('DueRow — «Оплатил» в строке', () => {
  it('при canPay — тихая маленькая кнопка между названием и кружком; нажатие — pay, лист строки не открывается', () => {
    const events = mount({ canPay: true })
    const btn = payBtn()!
    expect(btn.textContent?.trim()).toBe('Оплатил')
    expect(btn.className).toContain('h-[26px]') // `xs`
    expect(btn.className).toContain('bg-brand-soft') // тихая (`soft`), не главная брендовая
    // Место: после названия, до кружка плательщика и суммы; не внутри кнопки строки.
    const row = document.querySelector('[data-due]')!
    const kids = [...row.children]
    const at = (el: Element | null) => kids.findIndex((k) => k === el || k.contains(el))
    expect(at(btn)).toBeGreaterThan(at(row.querySelector('[data-row-open]')))
    expect(at(btn)).toBeLessThan(at(row.querySelector('button[aria-label^="Платит"]')))
    expect(btn.closest('[data-row-open]')).toBeNull()
    btn.click()
    expect(events).toEqual(['pay'])
    ;(row as HTMLElement).click()
    expect(events).toEqual(['pay', 'open'])
  })

  it('долг человеку — «Отдал»; оплачен или viewer — кнопки нет, у оплаченного ✓ у суммы', () => {
    mount({ canPay: true, given: true })
    expect(payBtn()!.textContent?.trim()).toBe('Отдал')
    app!.unmount()
    document.body.innerHTML = ''
    mount({ canPay: false, due: { ...rent, paid: true } })
    expect(payBtn()).toBeNull()
    expect(document.querySelector('[data-due]')!.textContent).toContain('✓')
    app!.unmount()
    document.body.innerHTML = ''
    mount({ canPay: false, canEdit: false })
    expect(payBtn()).toBeNull()
    expect(document.querySelector('[data-row-open]')).toBeNull()
  })
})
