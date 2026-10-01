// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { deposit } from '@/lib/finance'
import { money } from '@/lib/money'
import { authAs } from '@/test/planFamily'
import AccountSheet from './AccountSheet.vue'

/**
 * Пивот 3 (B2C-42, Р-38): вклад — внутри листа счёта (бывший экран вклада, перенос его проверок):
 * поля условий пишутся, «Сохранено» горит и гаснет (PV-23 п. 3), ставка в поле — «14» (хвост
 * приёмки Блока 3), расчёт свёрнут и раскрывается, удаление зовёт `removeAccount`, viewer — цифры
 * без полей.
 */

const T0 = '2026-09-01T00:00:00.000Z'
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-26T08:00:00Z'))
  // Правка планирует синк — сети в тесте нет, запрос просто не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function openDeposit(role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role))
  const store = useFinanceStore()
  store.setHouseholdDoc(
    {
      ...defaultSyncDoc(),
      accounts: [
        {
          id: 'dep', name: 'Депозит Kaspi', note: '', kind: 'deposit', amount: 1_000_000, updatedAt: T0,
          deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true },
        },
      ],
    },
    1,
  )
  const open = ref<string | null>('dep')
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(AccountSheet, { accountId: open.value, onClose: () => (open.value = null) }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  const field = (label: string) =>
    [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!
  const mark = () => document.querySelector('[aria-live="polite"]')!.textContent ?? ''
  const dialog = () => document.querySelector('[role="dialog"]')?.textContent ?? ''
  return { store, open, field, mark, dialog }
}

async function edit(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('blur'))
  await nextTick()
  await nextTick()
}

describe('B2C-42: вклад в листе счёта', () => {
  it('поля условий пишутся в документ: ставка, пополнение, срок, капитализация', async () => {
    const { store, field } = await openDeposit()
    await edit(field('Ставка'), '16,5')
    await edit(field('Пополнение в месяц'), '50 000')
    await edit(field('Срок'), '24')
    ;[...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'В конце срока')!.click()
    await nextTick()
    expect(store.accounts[0].deposit).toEqual({ annualRate: 0.165, monthlyTopUp: 50_000, months: 24, capitalize: false })
  })

  it('ставка 14 % в поле — «14», а не «14,000000000000002»; уход из поля без правки ничего не пишет; сотые остаются', async () => {
    const { store, field } = await openDeposit()
    expect(field('Ставка').value).toBe('14')
    const before = JSON.stringify(store.householdDoc)
    await edit(field('Ставка'), '14')
    expect(JSON.stringify(store.householdDoc)).toBe(before)
    await edit(field('Ставка'), '14,25')
    expect(store.accounts[0].deposit?.annualRate).toBeCloseTo(0.1425, 10)
    expect(field('Ставка').value).toBe('14,25')
  })

  it('«Сохранено» горит после правки и гаснет через 1,8 с (PV-23 п. 3)', async () => {
    const { store, field, mark } = await openDeposit()
    expect(mark()).toBe('')
    vi.setSystemTime(new Date('2026-09-26T08:01:00Z'))
    await edit(field('Название'), 'Депозит Halyk')
    expect(store.accounts[0].name).toBe('Депозит Halyk')
    expect(mark()).toBe('Сохранено')
    vi.advanceTimersByTime(1_800)
    await nextTick()
    // Уход отметки — `Transition` листа: его кадры (rAF) не подделаны, ждём их настоящим временем.
    vi.useRealTimers()
    await new Promise((r) => setTimeout(r, 400))
    expect(mark()).toBe('')
  })

  it('«Расчёт вклада» свёрнут; раскрыт — будущая сумма и проценты из deposit()', async () => {
    const { dialog } = await openDeposit()
    const details = document.querySelector<HTMLDetailsElement>('[role="dialog"] details')!
    expect(details.open).toBe(false)
    const calc = deposit({ principal: 1_000_000, annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true })
    details.querySelector('summary')!.click()
    await nextTick()
    expect(details.open).toBe(true)
    expect(dialog()).toContain(`Будет на счёте через 12 мес.${money(Math.round(calc.future))}`)
    expect(dialog()).toContain(`Начислено процентов${money(Math.round(calc.interest))}`)
    expect(dialog()).toContain('Реально ≈')
  })

  it('«Удалить вклад» с подтверждением — removeAccount, лист закрыт', async () => {
    const { store, open, dialog } = await openDeposit()
    const button = (t: string) => [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === t)!
    button('Удалить вклад').click()
    await nextTick()
    expect(dialog()).toContain('Вклад исчезнет у обоих участников вместе с условиями.')
    button('Удалить').click()
    await nextTick()
    expect(store.accounts.find((a) => a.id === 'dep')?.deletedAt).toBe('2026-09-26T08:00:00.000Z')
    expect(open.value).toBeNull()
  })

  it('viewer: условия цифрами — без полей и без «Удалить вклад»; расчёт виден', async () => {
    const { dialog } = await openDeposit('viewer')
    expect(document.querySelectorAll('[role="dialog"] input')).toHaveLength(0)
    expect(dialog()).not.toContain('Удалить вклад')
    for (const t of ['Пополнение в месяц', '12 мес.', 'ежемесячно', 'Расчёт вклада']) expect(dialog()).toContain(t)
    expect(dialog()).toMatch(/14,0\s?% годовых/)
  })
})
