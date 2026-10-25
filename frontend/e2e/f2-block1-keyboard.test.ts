// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import CreditSheet from '../src/components/capital/CreditSheet.vue'
import { at, backend, fakeServer, type FakeServer } from './support/family'

/**
 * Блок 1 «Фидбек-2» (F2-02): «Готово» на цифровой клавиатуре. Лист кредита семьи `planFamilyDoc`, телефон A на фейковом
 * сервере: фокус в «Остаток долга», набрал, Enter («Готово») — фокуса нет, остаток записан и после синка виден B.
 * Экранной клавиатуры в headless нет — сжатие визуального viewport проверяет `kit/SheetKeyboard.dom.test.ts`.
 */

let app: App | null = null
let server: FakeServer

async function phone(slot: 'a' | 'b') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', slot))
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  return { pinia, client, store }
}

const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) await nextTick()
}

function mount(pinia: Pinia, creditId: string) {
  setActivePinia(pinia)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(CreditSheet, { creditId }) })
  app.use(pinia)
  app.mount(root)
}

const field = (label: string) =>
  [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes(label))!.querySelector('input') as HTMLInputElement

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-10-25T07:00:00Z')
  server = fakeServer(planFamilyDoc())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('e2e / F2-02 — «Готово» в листе кредита', () => {
  it('«Остаток долга»: набрал, Enter — фокус ушёл, остаток записан и виден второму телефону', async () => {
    const A = await phone('a')
    mount(A.pinia, 'loan')
    await tick()
    const rest = field('Остаток долга')
    expect(rest.getAttribute('enterkeyhint')).toBe('done')
    rest.focus()
    rest.value = '950000'
    rest.dispatchEvent(new Event('input'))
    await tick()
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    rest.dispatchEvent(ev)
    await tick()
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(rest)
    expect(A.store.credits.find((c) => c.id === 'loan')!.principal).toBe(950_000)
    // Лист открыт — «Готово» клавиатуры не закрывает окно.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await A.store.syncHousehold(A.client)
    const B = await phone('b')
    expect(B.store.credits.find((c) => c.id === 'loan')!.principal).toBe(950_000)
  })

  it('Enter без правки — записи нет (одно действие — ни одной лишней записи)', async () => {
    const A = await phone('a')
    mount(A.pinia, 'loan')
    await tick()
    const before = A.store.householdDoc.credits.find((c) => c.id === 'loan')!.updatedAt
    const pay = field('Платёж в месяц')
    pay.focus()
    pay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await tick()
    expect(document.activeElement).not.toBe(pay)
    expect(A.store.householdDoc.credits.find((c) => c.id === 'loan')!.updatedAt).toBe(before)
  })
})
