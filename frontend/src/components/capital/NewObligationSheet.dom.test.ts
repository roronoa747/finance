// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { isSubscription } from '@/lib/finance'
import { planFamilyDoc } from '@/test/planFamily'
import NewObligationSheet from './NewObligationSheet.vue'

/**
 * PN-26: форма подписки без разделов бюджета — подписка всегда «быт» d4, «Чья» пишет `who`; «Аренда и коммуналка»
 * (`housing`) — жильё d1, сумма плавает по умолчанию; «Людям» — как было.
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

function mountSheet(props: { housing?: boolean; people?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  const open = ref(true)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(NewObligationSheet, { open: open.value, ...props, onClose: () => (open.value = false) }) })
  app.use(pinia)
  app.mount(root)
  return { store, open }
}

const dialog = () => document.querySelector('[role="dialog"]')!
const button = (text: string) =>
  [...dialog().querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === text)!
const field = (label: string) =>
  [...dialog().querySelectorAll('label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!
async function type(label: string, text: string) {
  const input = field(label)
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('PN-26: форма подписки — без разделов, «Чья»', () => {
  it('подписка: разделов нет, «Чья» — Общая по умолчанию; выбор участника пишет who, раздел — d4', async () => {
    const { store } = mountSheet()
    await nextTick()
    const text = dialog().textContent!
    expect(text).toContain('Регулярный платёж')
    expect(text).not.toContain('В какой раздел бюджета')
    for (const name of ['Жильё', 'Кредиты', 'Еда и быт']) expect(button(name)).toBeUndefined()
    expect(text).toContain('Чья')
    expect(text).not.toContain('Чьё это')
    expect(button('Общая').getAttribute('aria-pressed')).toBe('true')
    expect(field('Сумма плавает').checked).toBe(false)

    button('Аруна').click()
    await nextTick()
    await type('Что оплачиваем', 'Spotify')
    await type('Сумма в месяц', '2 990')
    button('Добавить').click()
    await nextTick()
    const ob = store.householdDoc.obligations.find((o) => o.name === 'Spotify')!
    expect(ob).toMatchObject({ category: 'd4', who: 'b', estimate: false })
    expect(isSubscription(ob)).toBe(true)
  })

  it('«Общая» — who пусто (null)', async () => {
    const { store } = mountSheet()
    await nextTick()
    await type('Что оплачиваем', 'Интернет')
    await type('Сумма в месяц', '9 000')
    button('Добавить').click()
    await nextTick()
    expect(store.householdDoc.obligations.find((o) => o.name === 'Интернет')).toMatchObject({ category: 'd4', who: null })
  })

  it('«Аренда и коммуналка»: заголовок, без «Людям», сумма плавает по умолчанию → d1, estimate', async () => {
    const { store } = mountSheet({ housing: true })
    await nextTick()
    const text = dialog().textContent!
    expect(text).toContain('Аренда и коммуналка')
    expect(text).not.toContain('Регулярный платёж')
    expect(dialog().querySelector('[role="switch"][aria-label="Людям"]')).toBeNull()
    expect(field('Что оплачиваем').placeholder).toBe('Например, аренда или свет')
    expect(field('Сумма плавает').checked).toBe(true)

    await type('Что оплачиваем', 'Свет')
    await type('Сумма в месяц', '12 000')
    button('Добавить').click()
    await nextTick()
    const ob = store.householdDoc.obligations.find((o) => o.name === 'Свет')!
    expect(ob).toMatchObject({ category: 'd1', estimate: true })
    expect(isSubscription(ob)).toBe(false)
  })

  it('«Аренда» с выключенной оценкой — d1 без estimate', async () => {
    const { store } = mountSheet({ housing: true })
    await nextTick()
    field('Сумма плавает').click()
    await nextTick()
    await type('Что оплачиваем', 'Аренда квартиры')
    await type('Сумма в месяц', '250 000')
    button('Добавить').click()
    await nextTick()
    expect(store.householdDoc.obligations.find((o) => o.name === 'Аренда квартиры')).toMatchObject({ category: 'd1', estimate: false })
  })

  it('«Людям» — прежнее: d4 с people', async () => {
    const { store } = mountSheet({ people: true })
    await nextTick()
    await type('Кому', 'Маме')
    await type('Сумма в месяц', '100 000')
    button('Добавить').click()
    await nextTick()
    expect(store.householdDoc.obligations.find((o) => o.name === 'Маме')).toMatchObject({ category: 'd4', people: true })
  })
})
