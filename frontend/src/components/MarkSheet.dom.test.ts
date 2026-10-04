// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { paidFor, type MonthlyKind } from '@/lib/finance'
import { plain } from '@/lib/money'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import type { Payment } from '@/types/finance'
import MarkSheet from './MarkSheet.vue'

/**
 * Лист отметки в DOM (ТЗ B2C-15 «Тесты»: `MarkSheet` для платежа и зарплаты): отметка пишет
 * `markPaid` / `markSalary` и шлёт `marked` (по нему зарплата ведёт в раскладку); правка
 * отмеченного — `editPaid` (одна живая запись пары, момент оплаты и «из выписки» прежние,
 * `marked` не шлётся); «Снять отметку» — `unmarkPaid`. Образец — `kit/DecisionCard.dom.test.ts`.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  // Только часы: промисы и таймеры Vue настоящие.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  // Запись планирует синк — сети в тесте нет, запрос просто не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function family() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member'))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  return { pinia, store }
}

type Seen = { close: number; marked: Payment[] }
type SheetProps = { open: 'mark' | 'paid'; kind: MonthlyKind; targetId: string; period: string; title: string; amount?: number }

async function mount(pinia: ReturnType<typeof createPinia>, props: SheetProps): Promise<Seen> {
  const seen: Seen = { close: 0, marked: [] }
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () =>
      h(MarkSheet, {
        ...props,
        onClose: () => {
          seen.close++
        },
        onMarked: (r: Payment) => {
          seen.marked.push(r)
        },
      }),
  })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  return seen
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const buttons = () => [...dialog().querySelectorAll<HTMLButtonElement>('button')]
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text)!
const amountField = () => dialog().querySelector<HTMLInputElement>('input')!

async function press(b: HTMLButtonElement) {
  b.click()
  await nextTick()
}

const live = (s: ReturnType<typeof useFinanceStore>, kind: Payment['kind'], targetId: string) =>
  s.payments.filter((p) => !p.deletedAt && p.kind === kind && p.targetId === targetId && p.period === '2026-09')

describe('components/MarkSheet в DOM', () => {
  it('платёж: сумма из графика, без счёта кнопка неактивна; счёт → «Отметить оплату» — запись markPaid, close и marked', async () => {
    const { pinia, store } = family()
    const seen = await mount(pinia, { open: 'mark', kind: 'credit', targetId: 'loan', period: '2026-09', title: 'Кредит', amount: 58_000 })
    expect(amountField().value).toBe(plain(58_000))
    expect(button('Отметить оплату').disabled).toBe(true)

    await press(buttons().find((b) => b.textContent?.includes('Kaspi Gold'))!)
    expect(button('Отметить оплату').disabled).toBe(false)
    await press(button('Отметить оплату'))

    const rec = live(store, 'credit', 'loan')
    expect(rec).toHaveLength(1)
    expect(rec[0]).toMatchObject({ kind: 'credit', targetId: 'loan', period: '2026-09', amount: 58_000, accountId: 'card', by: 'a' })
    expect(rec[0].source).toBeUndefined()
    expect(seen.close).toBe(1)
    expect(seen.marked).toEqual([rec[0]])
  })

  it('зарплата: «Не зачислять — только отметить» → «Отметить зарплату» — запись markSalary без счёта, marked для раскладки', async () => {
    const { pinia, store } = family()
    const seen = await mount(pinia, { open: 'mark', kind: 'salary', targetId: 'a', period: '2026-09', title: 'Зарплата Ильяса', amount: 700_000 })
    expect(dialog().textContent).toContain('Оклад месяца')
    expect(button('Отметить зарплату').disabled).toBe(true)

    await press(button('Не зачислять — только отметить'))
    await press(button('Отметить зарплату'))

    const rec = live(store, 'salary', 'a')
    expect(rec).toHaveLength(1)
    expect(rec[0]).toMatchObject({ kind: 'salary', targetId: 'a', period: '2026-09', amount: 700_000, accountId: null })
    expect(seen.close).toBe(1)
    expect(seen.marked).toEqual([rec[0]])
  })

  it('отмеченное из выписки: «Источник · из выписки»; «Другая сумма или счёт» → 60 000 → «Сохранить» — editPaid, одна живая запись, прежний момент, без marked', async () => {
    const { pinia, store } = family()
    const at = '2026-09-14T07:00:00.000Z'
    const first = store.markPaid('credit', 'loan', 'a', { period: '2026-09', amount: 58_000, accountId: 'card', source: 'statement', opId: 'op-1', at })!
    expect(first).toMatchObject({ source: 'statement', at })

    const seen = await mount(pinia, { open: 'paid', kind: 'credit', targetId: 'loan', period: '2026-09', title: 'Кредит' })
    const text = dialog().textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('Источник')
    expect(text).toContain('из выписки')
    expect(text).toContain('Из них')

    await press(button('Другая сумма или счёт'))
    expect(amountField().value).toBe(plain(58_000))
    const input = amountField()
    input.value = '60000'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await press(button('Сохранить'))

    const rec = live(store, 'credit', 'loan')
    expect(rec).toHaveLength(1)
    expect(rec[0].id).not.toBe(first.id)
    expect(rec[0]).toMatchObject({ amount: 60_000, accountId: 'card', at, source: 'statement', opId: 'op-1' })
    expect(store.payments.find((p) => p.id === first.id)!.deletedAt).toBeTruthy()
    expect(seen.close).toBe(1)
    expect(seen.marked).toEqual([])
  })

  it('критик возврата: кредит без ставки (из первого запуска) — в отмеченном нет «Из них … банку 0»', async () => {
    const { pinia, store } = family()
    const id = store.addCredit({ name: 'Оплата Kaspi Кредита', note: 'из выписки', principal: 1_200_000, annualRate: 0, rateUnknown: true, payment: 151_790, day: 24 })
    store.markPaid('credit', id, 'a', { period: '2026-09', amount: 151_790, accountId: null, source: 'statement', opId: 'op-k' })
    await mount(pinia, { open: 'paid', kind: 'credit', targetId: id, period: '2026-09', title: 'Оплата Kaspi Кредита' })
    const text = dialog().textContent!
    expect(text).toContain('из выписки')
    expect(text).not.toContain('Из них')
    expect(text).not.toContain('банку')
  })

  it('«Снять отметку» → что вернётся → «Снять» — unmarkPaid: месяц снова не оплачен', async () => {
    const { pinia, store } = family()
    store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card' })
    expect(paidFor(store.payments, 'obligation', 'rent', '2026-09')).toBeTruthy()

    const seen = await mount(pinia, { open: 'paid', kind: 'obligation', targetId: 'rent', period: '2026-09', title: 'Аренда' })
    expect(dialog().textContent).not.toContain('из выписки')
    await press(button('Снять отметку'))
    expect(dialog().textContent).toContain('Платёж снова станет неоплаченным, деньги вернутся на счёт.')
    expect(paidFor(store.payments, 'obligation', 'rent', '2026-09')).toBeTruthy()

    await press(button('Снять'))
    expect(paidFor(store.payments, 'obligation', 'rent', '2026-09')).toBeNull()
    expect(seen.close).toBe(1)
    expect(seen.marked).toEqual([])
  })
})

describe('возврат приёмки п. 2: «Разложить» в листе пришедшей по выписке зарплаты', () => {
  async function paidSheet(pinia: ReturnType<typeof createPinia>) {
    const seen = { allocate: 0, close: 0 }
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({
      render: () =>
        h(MarkSheet, {
          open: 'paid', kind: 'salary', targetId: 'a', period: '2026-09', title: 'Зарплата · Ильяс',
          onClose: () => void seen.close++,
          onAllocate: () => void seen.allocate++,
        }),
    })
    app.use(pinia)
    app.mount(root)
    await nextTick()
    return seen
  }
  const has = (text: string) => buttons().some((b) => b.textContent?.trim() === text)

  it('из выписки и не разложена — «Разложить» закрывает лист и зовёт раскладку; ручная отметка и записанная раскладка — без кнопки', async () => {
    const { pinia, store } = family()
    store.markSalary('a', { period: '2026-09', amount: 700_000, accountId: null, source: 'statement', opId: 'op-9', at: '2026-09-10T07:00:00.000Z' })
    const seen = await paidSheet(pinia)
    expect(has('К плану месяца')).toBe(true)
    await press(button('К плану месяца'))
    expect(seen).toEqual({ allocate: 1, close: 1 })

    store.recordAllocation({ source: 'salary', sourceId: 'a', period: '2026-09', by: 'a', total: 100_000, parts: [{ target: 'life', amount: 100_000 }] })
    await nextTick()
    expect(has('К плану месяца')).toBe(false)

    app?.unmount()
    document.body.innerHTML = ''
    const manual = family()
    manual.store.markSalary('a', { period: '2026-09', amount: 700_000, accountId: 'card' })
    await paidSheet(manual.pinia)
    expect(has('Другая сумма или счёт')).toBe(true)
    expect(has('К плану месяца')).toBe(false)
  })
})
