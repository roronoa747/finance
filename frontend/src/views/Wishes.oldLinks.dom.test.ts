// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { DEMO_TOKEN, useAuthStore } from '@/stores/auth'
import { DEMO_HOUSEHOLD, useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import { apiClient, LinkPreviewError } from '@/api/client'
import { LINK_PHOTO_TRIED_KEY } from '@/lib/storage'
import { fillWishPhotos } from '@/lib/photos/wishLinkPhotos'
import type { WishItem } from '@/types/finance'
import Wishes from './Wishes.vue'

// Сервер фото и сжатие — заглушки (как `Wishes.link.dom.test.ts`); превью ссылки — подменённый клиент.
const photos = vi.hoisted(() => ({ uploaded: [] as Blob[] }))
vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  uploadPhoto: vi.fn(async (b: Blob) => {
    photos.uploaded.push(b)
    return `ph-${photos.uploaded.length}`
  }),
  photoUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b, width: 800, height: 800 })),
}))

/**
 * B2C-68: открыли «Желания» — у старых желаний Kaspi без фото (ссылка сохранена до Блока 12) фото
 * подтягиваются сами: превью → сжатие → загрузка → `photoId`. Без кнопок. В демо — ни одного вызова.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  photos.uploaded = []
  // Запись `photoId` планирует синк — сети в тесте нет.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const old = (id: string, url: string, extra: Partial<WishItem> = {}): WishItem => ({
  id, name: id, price: 100_000, by: 'a', addedOn: '2026-09-20', bought: false, url, updatedAt: T0, ...extra,
})

async function open(
  wishlist: WishItem[],
  demo = false,
  role: 'member' | 'viewer' = 'member',
  before?: (finance: ReturnType<typeof useFinanceStore>) => void,
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = authAs(role, 'a')
  useAuthStore().setAuthData(demo ? { ...auth, token: DEMO_TOKEN, household: { ...auth.household, id: DEMO_HOUSEHOLD } } : auth)
  const finance = useFinanceStore()
  // Демо — документ семьи `DEMO_HOUSEHOLD` на телефоне (как `startDemoMode`).
  finance.claimFor(demo ? DEMO_HOUSEHOLD : auth.household.id)
  finance.setHouseholdDoc(planFamilyDoc({ wishlist }), 1)
  before?.(finance)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/wishes')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Wishes)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 5))
    await nextTick()
  }
}

describe('B2C-68: фото у старых желаний со ссылкой', () => {
  it('открыли «Желания» с двумя старыми желаниями Kaspi → у обоих появилось фото, uploadPhoto дважды; с фото и без ссылки — не трогаются', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview').mockImplementation(async (url) => ({ title: url, blob: new Blob(['jpeg'], { type: 'image/jpeg' }) }))
    const finance = await open([
      old('w1', 'https://kaspi.kz/shop/p/dyson-1/'),
      old('w2', 'https://kaspi.kz/shop/p/pled-2/'),
      old('w3', 'https://kaspi.kz/shop/p/own-3/', { photoId: 'own' }),
      old('w4', ''),
    ])
    await settle()

    expect(preview.mock.calls.map(([u]) => u)).toEqual(['https://kaspi.kz/shop/p/dyson-1/', 'https://kaspi.kz/shop/p/pled-2/'])
    expect(photos.uploaded).toHaveLength(2)
    expect(finance.wishlist.map((w) => w.photoId)).toEqual(['ph-1', 'ph-2', 'own', undefined])
    // Без кнопок и спиннеров: на экране только плитки.
    expect(document.body.textContent).not.toContain('Обновить фото')
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('нет картинки — адрес запоминается на телефоне и при следующем открытии не запрашивается', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview').mockRejectedValue(new LinkPreviewError('no image', 422))
    await open([old('w1', 'https://kaspi.kz/shop/p/no-pic/')])
    await settle()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(LINK_PHOTO_TRIED_KEY)!)).toEqual(['https://kaspi.kz/shop/p/no-pic/'])
    expect(photos.uploaded).toHaveLength(0)

    app!.unmount()
    app = null
    document.body.innerHTML = ''
    await open([old('w1', 'https://kaspi.kz/shop/p/no-pic/')])
    await settle()
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('сервер не ответил по существу (5xx, вход истёк) — адрес не запоминается, обход прерван после первого; следующее открытие спросит снова', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview').mockRejectedValue(new LinkPreviewError('unavailable', 503))
    const two = [old('w1', 'https://kaspi.kz/shop/p/one/'), old('w2', 'https://kaspi.kz/shop/p/two/')]
    await open(two)
    await settle()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(LINK_PHOTO_TRIED_KEY)).toBeNull()
    expect(photos.uploaded).toHaveLength(0)

    app!.unmount()
    app = null
    document.body.innerHTML = ''
    preview.mockRejectedValue(new LinkPreviewError('unavailable', 401))
    await open(two)
    await settle()
    expect(preview).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(LINK_PHOTO_TRIED_KEY)).toBeNull()
  })

  it('viewer — ни одного вызова: фото пишет только участник (ручка — 403)', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview')
    await open([old('w1', 'https://kaspi.kz/shop/p/dyson-1/')], false, 'viewer')
    await settle()
    expect(preview).not.toHaveBeenCalled()
    expect(photos.uploaded).toHaveLength(0)
    expect(localStorage.getItem(LINK_PHOTO_TRIED_KEY)).toBeNull()
  })

  it('демо — ни одного вызова превью и загрузки', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview')
    const finance = await open([old('w1', 'https://kaspi.kz/shop/p/dyson-1/')], true)
    await settle()
    expect(finance.isDemo).toBe(true)
    expect(preview).not.toHaveBeenCalled()
    expect(photos.uploaded).toHaveLength(0)
    expect(finance.wishlist[0].photoId).toBeUndefined()
  })

  it('B2C-72: «Желания» открылись, пока идёт фоновый обход при запуске, — тот же адрес не спрашивается дважды', async () => {
    let answer!: () => void
    const gate = new Promise<void>((r) => (answer = r))
    const preview = vi.spyOn(apiClient, 'linkPreview').mockImplementation(async (url) => {
      await gate
      return { title: url, blob: new Blob(['jpeg'], { type: 'image/jpeg' }) }
    })
    let background: Promise<number> | undefined
    const finance = await open(
      [old('w1', 'https://kaspi.kz/shop/p/dyson-1/'), old('w2', 'https://kaspi.kz/shop/p/pled-2/')],
      false,
      'member',
      (f) => void (background = fillWishPhotos(f)),
    )
    await settle()
    answer()
    await background
    await settle()

    const asked = preview.mock.calls.map(([u]) => u)
    expect(asked.filter((u) => u.includes('dyson-1'))).toHaveLength(1)
    expect(asked.filter((u) => u.includes('pled-2'))).toHaveLength(1)
    expect(photos.uploaded).toHaveLength(2)
    expect(finance.wishlist.map((w) => w.photoId)).toEqual(['ph-1', 'ph-2'])
  })
})
