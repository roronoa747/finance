import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import Wishes from './Wishes.vue'

// Сервер фото и сжатие — заглушки (как `GoalDetail.photo.test.ts`): проверяется, к какому желанию
// пришёл загруженный `photoId` и что видно без сети. Отдельный файл: `Wishes.test.ts` фото не мокает.
const photos = vi.hoisted(() => ({ uploaded: 0, next: 'ph-new', fail: false }))
vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  uploadPhoto: vi.fn(async () => {
    photos.uploaded++
    if (photos.fail) throw new Error('offline')
    return photos.next
  }),
  deletePhoto: vi.fn(async () => {}),
  photoUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b, width: 800, height: 800 })),
}))

type Box = { create: () => Promise<void>; note: () => unknown }

/**
 * Ревью Блока 3 Н-3: `createWish` — запись сразу, фото следом к id из `addWish`. Сбой загрузки
 * не теряет желание, а говорит, где добавить фото.
 */
describe('views/Wishes.vue — фото нового желания (Н-3, SSR)', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    photos.uploaded = 0
    photos.next = 'ph-new'
    photos.fail = false
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs('member', 'a'))
    useFinanceStore().setHouseholdDoc(planFamilyDoc({ wishlist: [] }), 1)
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Заполнить окно «Новое желание» с файлом и нажать «Добавить в список» (дождавшись загрузки). */
  async function create(name: string) {
    let box: Box | null = null
    const file = new File(['x'], 'plaid.jpg', { type: 'image/jpeg' })
    await renderScreen(Wishes, '/wishes', undefined, [
      screenMixin({ wishName: name, wishPrice: '9 000', wishFile: file }, (s) => {
        // Строгий прокси наружу не отдаём — await тронул бы у него `then`.
        const raw = s
        box = { create: s.createWish as () => Promise<void>, note: () => Reflect.get(raw, 'wishPhotoNote') }
      }),
    ])
    await box!.create()
    return box!
  }

  it('новое желание с файлом получает загруженный photoId — своё, а не соседа', async () => {
    const store = useFinanceStore()
    store.addWish({ name: 'Лампа', price: 9_000, by: 'a', list: 'all' })
    const box = await create('Плед')
    expect(photos.uploaded).toBe(1)
    expect(store.wishlist.find((w) => w.name === 'Плед')!.photoId).toBe('ph-new')
    expect(store.wishlist.find((w) => w.name === 'Лампа')!.photoId).toBeUndefined()
    expect(box.note()).toBeNull()
  })

  it('сбой загрузки: желание есть без фото, подсказка показана', async () => {
    const store = useFinanceStore()
    photos.fail = true
    const box = await create('Плед')
    const plaid = store.wishlist.find((w) => w.name === 'Плед')!
    expect(plaid).toBeTruthy()
    expect(plaid.photoId).toBeUndefined()
    const note = 'Фото не загрузилось — добавьте его в окне покупки при сети.'
    expect(box.note()).toBe(note)
    const html = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ wishPhotoNote: box.note() })])
    expect(html).toContain('Плед')
    expect(html).toContain(note)
  })
})
