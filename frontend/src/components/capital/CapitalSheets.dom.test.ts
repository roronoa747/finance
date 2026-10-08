// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import { planFamilyDoc } from '@/test/planFamily'
import type { Obligation } from '@/types/finance'
import AccountSheet from './AccountSheet.vue'
import CreditSheet from './CreditSheet.vue'
import ObligationSheet from './ObligationSheet.vue'
import NewDebtSheet from './NewDebtSheet.vue'
import NewObligationSheet from './NewObligationSheet.vue'
import Money from '@/views/Money.vue'

/**
 * Хвост Блока 5 (критик): «Готово» в окнах Капитала закрывает через `close()` кита, как
 * крестик, — фокус уходит из поля до `close`, правка по уходу из поля записана. Раньше
 * `emit('close')` мимо кита: нажатие, не уводящее фокус (WebKit уводит, `el.click()` —
 * нет), теряло правку последнего поля. Образец — `goals/GoalSheet.dom.test.ts`.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  // Правка планирует синк — сети в тесте нет, запрос просто не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const T0 = '2026-09-01T00:00:00.000Z'
const subs: Obligation = {
  id: 'subs', name: 'Подписки', note: '', day: 1, category: 'd4', group: true,
  versions: [{ from: '2000-01', amount: 0 }], updatedAt: T0,
}

function family() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  const doc = planFamilyDoc()
  store.setHouseholdDoc({ ...doc, obligations: [...doc.obligations, subs] }, 1)
  return { pinia, store }
}

function mount(pinia: ReturnType<typeof createPinia>, render: () => ReturnType<typeof h>, router?: ReturnType<typeof createRouter>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.use(pinia)
  if (router) app.use(router)
  app.mount(root)
}

const field = (label: string) =>
  [...document.querySelectorAll('[role="dialog"] label')]
    .find((l) => l.textContent?.includes(label))!
    .querySelector('input')!

/** Набрать в поле, оставив в нём фокус, и нажать «Готово» — нажатие фокус не уводит. */
async function typeThenDone(label: string, text: string) {
  const input = field(label)
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(document.activeElement).toBe(input)
  ;[...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Готово')!.click()
  await nextTick()
}

describe('Критик Блока 5: «Готово» в окнах Капитала — через close() кита', () => {
  it.each([
    ['счёт', AccountSheet, 'accountId', 'card', (s: ReturnType<typeof useFinanceStore>) => s.accounts.find((a) => a.id === 'card')?.name],
    ['кредит', CreditSheet, 'creditId', 'loan', (s: ReturnType<typeof useFinanceStore>) => s.credits.find((c) => c.id === 'loan')?.name],
    ['обязательство', ObligationSheet, 'obligationId', 'rent', (s: ReturnType<typeof useFinanceStore>) => s.obligations.find((o) => o.id === 'rent')?.name],
  ] as const)('%s: «Название» набрано, фокус в поле, «Готово» — записано, окно закрыто', async (_, sheet, prop, id, nameOf) => {
    const { pinia, store } = family()
    const open = ref<string | null>(id)
    await nextTick()
    mount(pinia, () => h(sheet as Component, { [prop]: open.value, onClose: () => (open.value = null) }))
    await nextTick()
    await typeThenDone('Название', 'Новое имя')
    expect(open.value).toBeNull()
    expect(nameOf(store)).toBe('Новое имя')
  })

  it('возврат приёмки п. 4: кредит из выписки — ставку назвали в листе, признак «неизвестна» снят, выводы появились', async () => {
    const { pinia, store } = family()
    const id = store.addCredit({ name: 'Оплата Kaspi Кредита', note: 'из выписки', principal: 1_200_000, annualRate: 0, rateUnknown: true, payment: 151_790, day: 24 })
    const open = ref<string | null>(id)
    mount(pinia, () => h(CreditSheet, { creditId: open.value, onClose: () => (open.value = null) }))
    await nextTick()
    const dialog = () => document.querySelector('[role="dialog"]')!.textContent!
    expect(dialog()).toContain('Ставку уточните')
    expect(dialog()).not.toContain('закроется в')
    expect(dialog()).not.toContain('График платежей')

    const rate = field('Ставка, % годовых')
    expect(rate.value).toBe('')
    rate.focus()
    rate.value = '36'
    rate.dispatchEvent(new Event('input', { bubbles: true }))
    rate.blur()
    await nextTick()
    const credit = store.credits.find((c) => c.id === id)!
    expect(credit.annualRate).toBe(0.36)
    expect(credit.rateUnknown).toBeNull()
    // Срок — строкой у полей (Б17); «Платежей осталось» — в раскрытом «Графике платежей».
    expect(document.querySelector('[data-credit-closes]')?.textContent).toMatch(/закроется в \S+ \d{4}/)
    expect(dialog()).not.toContain('Ставку уточните')
    ;[...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.includes('График платежей'))!.click()
    await nextTick()
    expect(dialog()).toContain('Платежей осталось')

    // ML-05 (хвост 958): отметки без ставки тело не писали — у остатка «Сверьте остаток с банком»; сверка (новый
    // остаток — якорь) подсказку убирает.
    expect(document.querySelector('[data-credit-reconcile]')?.textContent).toBe('Сверьте остаток с банком')
    const anchor = store.householdDoc.credits.find((c) => c.id === id)!.principalSetAt
    vi.setSystemTime(new Date(Date.now() + 60_000))
    const principal = field('Остаток долга')
    principal.focus()
    principal.value = '1 150 000'
    principal.dispatchEvent(new Event('input', { bubbles: true }))
    principal.blur()
    await nextTick()
    expect(store.credits.find((c) => c.id === id)!.principal).toBe(1_150_000)
    expect(store.householdDoc.credits.find((c) => c.id === id)!.principalSetAt).not.toBe(anchor)
    expect(document.querySelector('[data-credit-reconcile]')).toBeNull()
  })

  it('ML-05: у кредита со ставкой правка ставки подсказку сверки не показывает', async () => {
    const { pinia } = family()
    mount(pinia, () => h(CreditSheet, { creditId: 'loan', onClose: () => {} }))
    await nextTick()
    const rate = field('Ставка, % годовых')
    rate.focus()
    rate.value = '30'
    rate.dispatchEvent(new Event('input', { bubbles: true }))
    rate.blur()
    await nextTick()
    expect(document.querySelector('[data-credit-reconcile]')).toBeNull()
  })

  it('группа подписок (лист из «Платежей»): «Название» и «Готово» — записано, окно закрыто', async () => {
    const { pinia, store } = family()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money')
    await router.isReady()
    mount(pinia, () => h(Money), router)
    await nextTick()
    ;[...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find((b) => b.textContent?.includes('Подписки'))!.click()
    await nextTick()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Спрашивать «оставить?»')
    await typeThenDone('Название', 'Сервисы')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(store.obligations.find((o) => o.id === 'subs')?.name).toBe('Сервисы')
  })
})

describe('ML-16: формы «Человеку» и «Людям»', () => {
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === text)!
  async function type(label: string, text: string) {
    const input = field(label)
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }

  it('«Новый долг» → «Человеку»: без имени — поле подсвечено, долг не заведён; заполнено — person, ставка 0', async () => {
    const { pinia, store } = family()
    const add = vi.spyOn(store, 'addCredit')
    const open = ref(true)
    mount(pinia, () => h(NewDebtSheet, { open: open.value, onClose: () => (open.value = false) }))
    await nextTick()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Новый долг')
    button('Человеку').click()
    await nextTick()
    const dialog = document.querySelector('[role="dialog"]')!.textContent!
    expect(dialog).not.toContain('Проценты')
    expect(dialog).not.toContain('Ставка')
    await type('Сколько осталось', '500 000')
    await type('Сколько в месяц', '50 000')
    button('Добавить').click()
    await nextTick()
    expect(add).not.toHaveBeenCalled()
    expect(field('Кому').getAttribute('aria-invalid')).toBe('true')

    await type('Кому', 'Брату')
    button('Добавить').click()
    await nextTick()
    expect(add).toHaveBeenCalledOnce()
    expect(add.mock.calls[0]![0]).toMatchObject({ name: 'Брату', principal: 500_000, payment: 50_000, annualRate: 0, person: true })
    const bro = store.credits.find((c) => c.name === 'Брату')!
    expect(bro).toMatchObject({ person: true, annualRate: 0, principal: 500_000 })
    expect(bro.rateUnknown).toBeUndefined()
    expect(open.value).toBe(false)
  })

  it('«Банку» — прежняя форма: без названия можно, person не пишется', async () => {
    const { pinia, store } = family()
    mount(pinia, () => h(NewDebtSheet, { open: true, onClose: () => {} }))
    await nextTick()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Проценты')
    await type('Остаток долга', '224 000')
    await type('Платёж в месяц', '32 000')
    button('Добавить').click()
    await nextTick()
    const c = store.householdDoc.credits.at(-1)!
    expect(c).toMatchObject({ name: 'Долг', note: 'рассрочка', annualRate: 0 })
    expect('person' in c).toBe(false)
  })

  it('«Регулярный платёж» → «Людям»: поле «Кому», пишется people; открытая с people — уже включено', async () => {
    const { pinia, store } = family()
    const people = ref(false)
    const open = ref(true)
    mount(pinia, () => h(NewObligationSheet, { open: open.value, people: people.value, onClose: () => (open.value = false) }))
    await nextTick()
    const toggle = () => document.querySelector<HTMLElement>('[role="dialog"] [role="switch"][aria-label="Людям"]')!
    const sw = toggle()
    expect(sw.getAttribute('aria-checked')).toBe('false')
    sw.click()
    await nextTick()
    await type('Кому', 'Маме')
    await type('Сумма в месяц', '100 000')
    button('Добавить').click()
    await nextTick()
    expect(store.householdDoc.obligations.find((o) => o.name === 'Маме')).toMatchObject({ people: true, versions: [{ amount: 100_000 }] })

    people.value = true
    open.value = true
    await nextTick()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(field('Кому')).toBeTruthy()
  })

  it('обычный платёж — без people', async () => {
    const { pinia, store } = family()
    mount(pinia, () => h(NewObligationSheet, { open: true, onClose: () => {} }))
    await nextTick()
    await type('Что оплачиваем', 'Интернет')
    await type('Сумма в месяц', '9 000')
    button('Добавить').click()
    await nextTick()
    expect('people' in store.householdDoc.obligations.find((o) => o.name === 'Интернет')!).toBe(false)
  })
})
