// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { defaultSyncDoc, useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs } from '@/test/planFamily'
import type { Gift } from '@/types/finance'
import GiftSheet from './GiftSheet.vue'

/**
 * Сюрприз (B2C-18; критик Блока 3): фото сюрприза грузится через лист со скрытым признаком — сервер
 * отдаёт его только автору; сама запись — в личном документе автора, в общем её имени нет. Сервер
 * фото и сжатие — заглушки: проверяется, с каким признаком лист зовёт загрузку.
 */
const photos = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false, deleted: [] as string[] }))
vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  uploadPhoto: vi.fn(async (...args: unknown[]) => {
    photos.calls.push(args)
    if (photos.fail) throw new Error('offline')
    return 'p1'
  }),
  deletePhoto: vi.fn(async (id: string) => {
    photos.deleted.push(id)
  }),
  photoUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b, width: 800, height: 800 })),
}))

const T0 = '2026-09-01T00:00:00.000Z'
let app: App | null = null
const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }

beforeEach(() => {
  photos.calls = []
  photos.fail = false
  photos.deleted = []
  // Сервера нет: запись сюрприза сразу шлёт личный документ — сеть «выключена», повтор по таймеру не наступает.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('offline')
  }))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  // Превью выбранного файла (PhotoSlot) — object URL; в happy-dom — заглушка.
  Object.assign(URL, { createObjectURL: () => 'data:,', revokeObjectURL: () => {} })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.assign(URL, { createObjectURL: urls.create, revokeObjectURL: urls.revoke })
})

async function openSheet(o: { edit?: Partial<Gift>; role?: 'member' | 'viewer' } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (o.role) useAuthStore().setAuthData(authAs(o.role))
  const store = useFinanceStore()
  store.setHouseholdDoc(
    {
      ...defaultSyncDoc(),
      setupDoneAt: T0,
      people: [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
      ],
    },
    1,
  )
  const giftId = o.edit ? store.addGift({ forSlot: 'b', name: 'Наушники', price: 90_000, photoId: 'old', ...o.edit }).id : null
  const open = ref(true)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(GiftSheet, { open: open.value, giftId, forSlot: 'b', forName: 'Аруна', onClose: () => (open.value = false) }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  await nextTick()
  const field = (label: string) =>
    [...document.querySelectorAll('[role="dialog"] label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === text)!
  return { store, open, field, button }
}

async function type(input: HTMLInputElement, text: string) {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

async function pickFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]')!
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await nextTick()
}

/** Загрузка фото и запись идут через await — дать им закончиться. */
async function settle() {
  for (let i = 0; i < 10; i++) await nextTick()
}

describe('GiftSheet в DOM — скрытое фото сюрприза', () => {
  it('«Добавить» с фото: загрузка со скрытым признаком, сюрприз с фото — в личном документе, в общем имени нет; окно закрыто', async () => {
    const { store, open, field, button } = await openSheet()
    await type(field('Что'), 'Наушники')
    await type(field('Сколько'), '90 000')
    await pickFile(new File(['img'], 'gift.jpg', { type: 'image/jpeg' }))
    button('Добавить').click()
    await settle()

    expect(photos.calls).toHaveLength(1)
    expect(photos.calls[0][0]).toBeInstanceOf(Blob)
    expect(photos.calls[0][1]).toEqual({ hidden: true })
    expect(store.gifts).toHaveLength(1)
    expect(store.gifts[0]).toMatchObject({ forSlot: 'b', name: 'Наушники', price: 90_000, photoId: 'p1' })
    expect(JSON.stringify(store.householdDoc)).not.toContain('Наушники')
    expect(JSON.stringify(store.householdDoc)).not.toContain('p1')
    expect(JSON.stringify(store.privateDoc)).toContain('Наушники')
    expect(open.value).toBe(false)
  })

  it('фото не загрузилось — сюрприз записан без него, окно открыто с заметкой, поля пустые: второе нажатие не дублирует', async () => {
    photos.fail = true
    const { store, open, field, button } = await openSheet()
    await type(field('Что'), 'Билеты')
    await pickFile(new File(['img'], 'gift.jpg', { type: 'image/jpeg' }))
    button('Добавить').click()
    await settle()

    expect(photos.calls[0][1]).toEqual({ hidden: true })
    expect(store.gifts).toHaveLength(1)
    expect(store.gifts[0]).toMatchObject({ name: 'Билеты', photoId: null })
    expect(open.value).toBe(true)
    expect(document.body.textContent).toContain('Фото не загрузилось — подарок записан без него.')
    expect(field('Что').value).toBe('')
    expect(button('Добавить').disabled).toBe(false)
    button('Добавить').click()
    await settle()
    expect(document.body.textContent).toContain('Введите, что это')
    expect(store.gifts).toHaveLength(1)
  })
})

describe('GiftSheet в DOM — правка и удаление сюрприза (ML-07, хвост 955)', () => {
  it('правка имени и цены: «Сохранить» пишет в личный документ, фото прежнее, окно закрыто', async () => {
    const { store, open, field, button } = await openSheet({ edit: {} })
    expect(field('Что').value).toBe('Наушники')
    await type(field('Что'), 'Наушники Sony')
    await type(field('Сколько'), '75 000')
    button('Сохранить').click()
    await settle()

    expect(store.gifts).toHaveLength(1)
    expect(store.gifts[0]).toMatchObject({ name: 'Наушники Sony', price: 75_000, photoId: 'old' })
    expect(photos.deleted).toEqual([])
    expect(open.value).toBe(false)
  })

  it('новое фото при правке: скрытая загрузка, прежнее удалено с сервера', async () => {
    const { store, button } = await openSheet({ edit: {} })
    await pickFile(new File(['img'], 'gift.jpg', { type: 'image/jpeg' }))
    button('Сохранить').click()
    await settle()

    expect(photos.calls[0][1]).toEqual({ hidden: true })
    expect(store.gifts[0].photoId).toBe('p1')
    expect(photos.deleted).toEqual(['old'])
  })

  it('«Удалить сюрприз» спрашивает, удаляет запись и её фото', async () => {
    const { store, open, button } = await openSheet({ edit: {} })
    button('Удалить сюрприз').click()
    await nextTick()
    expect(store.gifts).toHaveLength(1)
    button('Удалить').click()
    await settle()

    expect(store.gifts).toHaveLength(0)
    expect(photos.deleted).toEqual(['old'])
    expect(open.value).toBe(false)
  })

  it('viewer: только смотрит — поля выключены, нет «Сохранить» и «Удалить»', async () => {
    const { field, button } = await openSheet({ edit: {}, role: 'viewer' })
    expect(field('Что').disabled).toBe(true)
    expect(field('Сколько').disabled).toBe(true)
    expect(button('Сохранить')).toBeUndefined()
    expect(button('Удалить сюрприз')).toBeUndefined()
  })
})
