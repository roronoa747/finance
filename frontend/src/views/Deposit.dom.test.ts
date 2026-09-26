// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import Deposit from './Deposit.vue'

/**
 * PV-23 п. 3: «Сохранено» на вкладе горит, когда правка легла в документ, и гаснет
 * (`useSavedMark` по `updatedAt`); уход из поля без правки отметку не зажигает.
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

async function openDeposit() {
  const pinia = createPinia()
  setActivePinia(pinia)
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
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/capital/dep')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Deposit)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  const field = (label: string) =>
    [...document.querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!
  const mark = () => document.querySelector('[aria-live="polite"]')!.textContent ?? ''
  return { store, field, mark }
}

async function edit(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('blur'))
  await nextTick()
  await nextTick()
}

describe('PV-23 п. 3: «Сохранено» на вкладе', () => {
  it('правка названия — «Сохранено» горит и гаснет через 1,8 с', async () => {
    const { store, field, mark } = await openDeposit()
    expect(mark()).toBe('')
    vi.setSystemTime(new Date('2026-09-26T08:01:00Z'))
    await edit(field('Название'), 'Депозит Halyk')
    expect(store.accounts[0].name).toBe('Депозит Halyk')
    expect(mark()).toBe('Сохранено')
    vi.advanceTimersByTime(1_800)
    await nextTick()
    await vi.runAllTimersAsync()
    await nextTick()
    expect(mark()).toBe('')
  })

  it('уход из поля без правки — документ тот же, отметки нет', async () => {
    const { store, field, mark } = await openDeposit()
    const before = JSON.stringify(store.householdDoc)
    await edit(field('Название'), 'Депозит Kaspi')
    await edit(field('Сумма на счёте'), '1 000 000')
    expect(JSON.stringify(store.householdDoc)).toBe(before)
    expect(mark()).toBe('')
  })
})
