// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { defaultSyncDoc, useFinanceStore } from '@/stores/finance'
import { liveWishlist } from '@/lib/finance'
import type { WishItem } from '@/types/finance'
import WishSheet from './WishSheet.vue'

// Сервер фото и сжатие — заглушки (как `GoalDetail.photo.test.ts`): проверяется, какое фото
// остаётся у желания и какое удаляется; `photoIdAtDelete` — что было в документе в момент удаления.
const photos = vi.hoisted(() => ({ deleted: [] as string[], photoIdAtDelete: [] as (string | null | undefined)[], next: 'ph-new', fail: false, peek: () => undefined as string | null | undefined }))
vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  uploadPhoto: vi.fn(async () => {
    if (photos.fail) throw new Error('offline')
    return photos.next
  }),
  deletePhoto: vi.fn(async (id: string) => {
    photos.deleted.push(id)
    photos.photoIdAtDelete.push(photos.peek())
  }),
  photoUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b })),
}))

/**
 * PV-18 (критик Блока 4): окно правки покупки в DOM — поля пишутся по уходу из поля, «Кто
 * добавил» сразу, удаление спрашивает и закрывает окно. e2e правит покупку методами стора,
 * обработчики окна вызываются только здесь.
 */

const T0 = '2026-09-01T00:00:00.000Z'
let app: App | null = null

beforeEach(() => {
  photos.deleted = []
  photos.photoIdAtDelete = []
  photos.next = 'ph-new'
  photos.fail = false
  photos.peek = () => undefined
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
})

async function openPan(extra: Partial<WishItem> = {}) {
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
        { id: 'pan', name: 'Сковорода', price: 18_000, by: 'a', addedOn: T0, url: 'https://kaspi.kz/p', bought: false, updatedAt: T0, ...extra },
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
  photos.peek = () => pan().photoId
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

describe('PV-23 (хвост приёмки Б4): «Готово» закрывает через close() кита', () => {
  it('цена набрана, фокус в поле, «Готово» нажата без смены фокуса — цена записана, окно закрыто', async () => {
    const { wishId, field, button, pan } = await openPan()
    const price = field('Цена, ₸')
    price.focus()
    price.value = '25 000'
    price.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.activeElement).toBe(price)
    button('Готово').click()
    await nextTick()
    expect(pan().price).toBe(25_000)
    expect(wishId.value).toBeNull()
  })
})

/** Выбрать файл в `PhotoSlot` окна и дождаться сжатия, загрузки и удаления прежнего. */
async function pickFile() {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'pan.jpg', { type: 'image/jpeg' })] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await flush()
}
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}
const iconButton = (label: string) => document.querySelector<HTMLElement>(`[role="dialog"] button[aria-label="${label}"]`)

// Ревью Блока 3 Н-3: ошибка порядка или id удалит фото, которое видят оба, или оставит байты на сервере.
describe('Н-3: фото желания в окне правки', () => {
  it('замена: новое у желания, прежнее удалено уже после смены в документе', async () => {
    const { pan } = await openPan({ photoId: 'ph-old' })
    await pickFile()
    expect(pan().photoId).toBe('ph-new')
    expect(photos.deleted).toEqual(['ph-old'])
    expect(photos.photoIdAtDelete).toEqual(['ph-new'])
    expect(document.body.textContent).not.toContain('Фото не загрузилось')
  })

  it('первое фото: у желания новое, удалять нечего', async () => {
    const { pan } = await openPan()
    await pickFile()
    expect(pan().photoId).toBe('ph-new')
    expect(photos.deleted).toEqual([])
  })

  it('сбой загрузки: прежнее фото на месте, ничего не удалено, подсказка показана', async () => {
    const { pan } = await openPan({ photoId: 'ph-old' })
    photos.fail = true
    await pickFile()
    expect(pan().photoId).toBe('ph-old')
    expect(photos.deleted).toEqual([])
    expect(document.body.textContent).toContain('Фото не загрузилось — попробуйте при сети.')
  })

  it('«Убрать фото»: в документе photoId — null, затем фото удалено на сервере', async () => {
    const { pan } = await openPan({ photoId: 'ph-old' })
    iconButton('Убрать фото')!.click()
    await flush()
    expect(pan().photoId).toBeNull()
    expect(photos.deleted).toEqual(['ph-old'])
    expect(photos.photoIdAtDelete).toEqual([null])
    expect(iconButton('Убрать фото')).toBeNull()
  })

  it('удаление желания удаляет его фото; желание без фото — ничего не удаляет', async () => {
    const { store, button } = await openPan({ photoId: 'ph-old' })
    button('Удалить из списка').click()
    await nextTick()
    button('Удалить').click()
    await flush()
    expect(liveWishlist(store.wishlist)).toHaveLength(0)
    expect(photos.deleted).toEqual(['ph-old'])

    app?.unmount()
    app = null
    document.body.innerHTML = ''
    photos.deleted = []
    const bare = await openPan()
    bare.button('Удалить из списка').click()
    await nextTick()
    bare.button('Удалить').click()
    await flush()
    expect(liveWishlist(bare.store.wishlist)).toHaveLength(0)
    expect(photos.deleted).toEqual([])
  })
})
