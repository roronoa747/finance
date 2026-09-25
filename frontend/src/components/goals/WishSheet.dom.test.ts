// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { defaultSyncDoc, useFinanceStore } from '@/stores/finance'
import { liveWishlist } from '@/lib/finance'
import WishSheet from './WishSheet.vue'

/**
 * PV-18 (критик Блока 4): окно правки покупки в DOM — поля пишутся по уходу из поля, «Кто
 * добавил» сразу, удаление спрашивает и закрывает окно. e2e правит покупку методами стора,
 * обработчики окна вызываются только здесь.
 */

const T0 = '2026-09-01T00:00:00.000Z'
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
})

async function openPan() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  store.setHouseholdDoc(
    {
      ...defaultSyncDoc(),
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
      wishlist: [
        { id: 'pan', name: 'Сковорода', price: 18_000, by: 'a', addedOn: T0, url: 'https://kaspi.kz/p', bought: false, updatedAt: T0 },
      ],
    },
    1,
  )
  const wishId = ref<string | null>('pan')
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(WishSheet, { wishId: wishId.value, onClose: () => (wishId.value = null) }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  await nextTick()
  const field = (label: string) =>
    [...document.querySelectorAll('[role="dialog"] label')]
      .find((l) => l.textContent?.includes(label))!
      .querySelector('input')!
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === text)!
  const pan = () => store.wishlist.find((w) => w.id === 'pan')!
  return { store, wishId, field, button, pan }
}

async function edit(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  input.blur()
  await nextTick()
}

describe('PV-18: WishSheet в DOM', () => {
  it('название, цена и «Кто добавил» пишутся сразу; стёртая ссылка — пустой строкой', async () => {
    const { field, button, pan } = await openPan()
    await edit(field('Что покупаем'), 'Сковорода Tefal')
    await edit(field('Цена, ₸'), '21 000')
    await edit(field('Ссылка на товар'), '')
    button('Аруна').click()
    await nextTick()
    expect(pan()).toMatchObject({ name: 'Сковорода Tefal', price: 21_000, url: '', by: 'b' })
  })

  it('пустое название не пишется', async () => {
    const { store, field, pan } = await openPan()
    const before = JSON.stringify(store.householdDoc)
    await edit(field('Что покупаем'), '   ')
    expect(pan().name).toBe('Сковорода')
    expect(JSON.stringify(store.householdDoc)).toBe(before)
  })

  it('«Удалить из списка» спрашивает; «Удалить» — надгробие и окно закрыто', async () => {
    const { store, wishId, button } = await openPan()
    button('Удалить из списка').click()
    await nextTick()
    expect(document.body.textContent).toContain('Покупка исчезнет из списка у обоих. Отменить нельзя.')
    expect(liveWishlist(store.wishlist)).toHaveLength(1)
    button('Удалить').click()
    await nextTick()
    expect(liveWishlist(store.wishlist)).toHaveLength(0)
    expect(wishId.value).toBeNull()
  })
})
