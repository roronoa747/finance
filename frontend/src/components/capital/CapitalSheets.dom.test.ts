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
import Capital from '@/views/Capital.vue'

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

  it('группа подписок (окно в Капитале): «Название» и «Готово» — записано, окно закрыто', async () => {
    const { pinia, store } = family()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/capital')
    await router.isReady()
    mount(pinia, () => h(Capital), router)
    await nextTick()
    ;[...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find((b) => b.textContent?.includes('Подписки'))!.click()
    await nextTick()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Спрашивать «оставить?»')
    await typeThenDone('Название', 'Сервисы')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(store.obligations.find((o) => o.id === 'subs')?.name).toBe('Сервисы')
  })
})
