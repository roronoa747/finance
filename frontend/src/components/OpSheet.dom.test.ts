// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { ruleMatchOf } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import OpSheet from './OpSheet.vue'

/**
 * FB-04 (Р-10, Р-12): лист своей операции — заметка (по уходу из поля, видна при повторном открытии), чипы раздела
 * (правило задним числом), «Мне вернули» — приход или наличными, повторное нажатие снимает. Главной кнопки нет.
 * Синтетика: Ильяс (a), зарплата 700 000 10-го; перевод Дане 9 октября 30 000, она вернула 12-го.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-16T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const SPEND: Operation = { id: 's1', bank: 'kaspi', date: '2026-10-09', amount: -30_000, kind: 'transfer-out', merchant: 'Дана К.', counterparty: 'Дана К.', categoryId: 'sc_people', internal: false }
const BACK: Operation = { id: 'i1', bank: 'kaspi', date: '2026-10-12', amount: 30_000, kind: 'transfer-in', merchant: 'Дана К.', counterparty: 'Дана К.', categoryId: null, internal: false }
const SHOP: Operation = { id: 'p1', bank: 'kaspi', date: '2026-10-14', amount: -8_000, kind: 'purchase', merchant: 'MAGNUM ALMATY KZ', categoryId: 'sc_food', internal: false }

const opId = ref<string | null>(null)
async function mount() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member'))
  useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
  const store = useOperationsStore()
  for (const o of [SPEND, BACK, SHOP]) store.ops[o.id] = o
  opId.value = null
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(OpSheet, { opId: opId.value, onClose: () => (opId.value = null) }) })
  app.use(pinia)
  app.mount(root)
  await flush()
  return store
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const button = (label: string) => [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => txt(b) === label)
const open = async (id: string) => {
  opId.value = id
  await flush()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  el!.click()
  await flush()
}

describe('FB-04: лист операции (OpSheet)', () => {
  it('заголовок — продавец коротко, строка — день и сумма; главной кнопки нет; текущий раздел выбран', async () => {
    await mount()
    await open('p1')
    expect(txt(dialog())).toContain('MAGNUM')
    expect(txt(dialog()?.querySelector('[data-op-meta]') ?? null)).toBe('14 октября · 8 000 ₸')
    expect(button('Продукты')!.getAttribute('aria-pressed')).toBe('true')
    // Брендовой кнопки во всю ширину нет — ответ чипом.
    expect(dialog()!.querySelector('button.w-full')).toBeNull()
  })

  it('заметка пишется по уходу из поля и видна при повторном открытии; на операцию в копии не попадает', async () => {
    const store = await mount()
    await open('p1')
    const input = dialog()!.querySelector<HTMLInputElement>('[data-op-memo]')!
    input.value = 'на неделю'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur'))
    await flush()
    expect(store.all.find((o) => o.id === 'p1')?.memo).toBe('на неделю')
    expect(store.ops.p1.memo).toBeUndefined()
    opId.value = null
    await flush()
    await open('p1')
    expect(dialog()!.querySelector<HTMLInputElement>('[data-op-memo]')!.value).toBe('на неделю')
  })

  it('«Мне вернули» → приход Даны → «вернули 30 000», приход больше не вопрос «это зарплата?»; нажатие ещё раз — снято', async () => {
    const store = await mount()
    await open('s1')
    await press(dialog()!.querySelector('[data-op-refund]'))
    const income = dialog()!.querySelector<HTMLElement>('[data-op-income="i1"]')
    expect(txt(income)).toBe('От Дана К. · 12 октября · 30 000')
    await press(income)
    expect(txt(dialog()!.querySelector('[data-op-meta]'))).toBe('9 октября · 30 000 ₸ · вернули 30 000')
    expect(dialog()!.querySelector('[data-op-refund]')!.getAttribute('aria-pressed')).toBe('true')
    expect(store.all.find((o) => o.id === 'i1')?.internal).toBe(true)
    expect(store.pendingMatches.some((c) => c.opId === 'i1')).toBe(false)

    await press(dialog()!.querySelector('[data-op-refund]'))
    expect(txt(dialog()!.querySelector('[data-op-meta]'))).toBe('9 октября · 30 000 ₸')
    expect(store.all.find((o) => o.id === 'i1')?.internal).toBe(false)
  })

  it('«Наличными» — сумма по умолчанию вся трата; больше траты — срезается; 0 — снимает', async () => {
    const store = await mount()
    await open('p1')
    await press(dialog()!.querySelector('[data-op-refund]'))
    await press(dialog()!.querySelector('[data-op-cash]'))
    const field = dialog()!.querySelector<HTMLInputElement>('[data-op-cash-row] input')!
    expect(field.value.replace(/\s/g, '')).toBe('8000')
    field.value = '2000'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await press(dialog()!.querySelector('[data-op-cash-done]'))
    expect(store.all.find((o) => o.id === 'p1')?.refund).toEqual({ amount: 2_000 })
    expect(txt(dialog()!.querySelector('[data-op-meta]'))).toContain('вернули 2 000')

    // Снять и вписать больше траты — срезается до 8 000.
    await press(dialog()!.querySelector('[data-op-refund]'))
    await press(dialog()!.querySelector('[data-op-refund]'))
    await press(dialog()!.querySelector('[data-op-cash]'))
    const again = dialog()!.querySelector<HTMLInputElement>('[data-op-cash-row] input')!
    again.value = '99000'
    again.dispatchEvent(new Event('input', { bubbles: true }))
    await press(dialog()!.querySelector('[data-op-cash-done]'))
    expect(store.all.find((o) => o.id === 'p1')?.refund).toEqual({ amount: 8_000 })
    // В личном документе — тоже не больше траты.
    expect(useFinanceStore().opEdits.find((e) => e.id === 'p1')?.refund).toEqual({ amount: 8_000 })
  })

  it('чип раздела — правило по продавцу задним числом (recategorize) и лист закрыт', async () => {
    const store = await mount()
    const spy = vi.spyOn(store, 'recategorize').mockResolvedValue(undefined)
    await open('p1')
    await press(button('Кафе и рестораны'))
    expect(spy).toHaveBeenCalledWith(ruleMatchOf(SHOP), { categoryId: 'sc_cafe' })
    expect(dialog()).toBeNull()
  })
})
