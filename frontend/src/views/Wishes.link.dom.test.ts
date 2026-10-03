// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { apiClient, LinkPreviewError } from '@/api/client'
import { LINK_PHOTO_MISSED } from '@/lib/photos/useLinkPreview'
import Wishes from './Wishes.vue'

// Сервер фото и сжатие — заглушки (как `Wishes.photo.test.ts`); превью ссылки — подменённый клиент.
const photos = vi.hoisted(() => ({ uploaded: [] as Blob[], compressed: [] as Blob[] }))
vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  uploadPhoto: vi.fn(async (b: Blob) => {
    photos.uploaded.push(b)
    return 'ph-link'
  }),
  photoUrl: vi.fn(async () => null),
}))
vi.mock('@/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => {
    photos.compressed.push(b)
    return { blob: b }
  }),
}))

/**
 * B2C-66: желание по ссылке — вставили ссылку, фото и название со страницы, цену вводит человек;
 * «Добавить» сжимает и загружает фото тем же путём, что своё. Не вышло — строка «загрузите своё».
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  photos.uploaded = []
  photos.compressed = []
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function open() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc({ wishlist: [] }), 1)
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

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const input = (placeholder: string) => document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement
const settle = async () => {
  await new Promise((r) => setTimeout(r, 350)) // пауза ввода ссылки — 300 мс
  for (let i = 0; i < 5; i++) await nextTick()
}

async function paste(text: string) {
  button('Добавить покупку').click()
  await nextTick()
  const link = input('Вставьте ссылку')
  link.value = text
  link.dispatchEvent(new Event('input'))
  await settle()
}

describe('B2C-66: желание по ссылке', () => {
  it('вставка ссылки → фото и название со страницы; «Добавить» пишет желание с фото, названием, ссылкой и ценой человека', async () => {
    const pic = new Blob(['jpeg'], { type: 'image/jpeg' })
    const preview = vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Dyson Airwrap', blob: pic })
    const finance = await open()
    await paste('Посмотрите товар на Kaspi.kz: https://kaspi.kz/shop/p/dyson-1/')

    expect(preview).toHaveBeenCalledWith('https://kaspi.kz/shop/p/dyson-1/')
    expect(input('Например, сковорода').value).toBe('Dyson Airwrap')
    expect(document.querySelector('img')).not.toBeNull()
    expect(document.body.textContent).not.toContain(LINK_PHOTO_MISSED)

    const price = input('18 000')
    price.value = '289 990'
    price.dispatchEvent(new Event('input'))
    button('Добавить в список').click()
    await settle()

    const wish = finance.wishlist.find((w) => w.name === 'Dyson Airwrap')!
    expect(wish).toMatchObject({ price: 289_990, url: 'https://kaspi.kz/shop/p/dyson-1/', photoId: 'ph-link' })
    expect(photos.compressed).toHaveLength(1)
    expect(photos.compressed[0].type).toBe('image/jpeg')
    expect(photos.uploaded).toHaveLength(1)
  })

  it('своё название не перетирается; нет картинки — строка «загрузите своё», желание добавляется без фото', async () => {
    vi.spyOn(apiClient, 'linkPreview').mockRejectedValue(new LinkPreviewError('no image'))
    const finance = await open()
    button('Добавить покупку').click()
    await nextTick()
    const name = input('Например, сковорода')
    name.value = 'Фен'
    name.dispatchEvent(new Event('input'))
    const link = input('Вставьте ссылку')
    link.value = 'https://shop.kz/p/9'
    link.dispatchEvent(new Event('input'))
    await settle()

    expect(document.body.textContent).toContain(LINK_PHOTO_MISSED)
    expect(name.value).toBe('Фен')

    // Клинап Б12 Н-4: выбрали своё фото — просьба «загрузите своё» уходит.
    const own = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(own, 'files', { value: [new File(['png'], 'own.png', { type: 'image/png' })] })
    own.dispatchEvent(new Event('change'))
    await nextTick()
    expect(document.body.textContent).not.toContain(LINK_PHOTO_MISSED)
    photos.uploaded = []
    photos.compressed = []
    // Фото убираем обратно: дальше проверяется желание без фото.
    ;(document.querySelector('button[aria-label="Убрать фото"]') as HTMLButtonElement).click()
    await nextTick()

    button('Добавить в список').click()
    await settle()
    const wish = finance.wishlist.find((w) => w.name === 'Фен')!
    expect(wish.url).toBe('https://shop.kz/p/9')
    expect(wish.photoId).toBeUndefined()
    expect(photos.uploaded).toHaveLength(0)
  })
})
