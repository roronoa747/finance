// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { DEMO_HOUSEHOLD, useFinanceStore } from '@/stores/finance'
import { apiClient, LinkPreviewError } from '@/api/client'
import { LINK_PHOTO_MISSED, type LinkFound } from '@/lib/photos/useLinkPreview'
import LinkPhotoField, { LINK_PHOTO_NEEDS_NET } from './LinkPhotoField.vue'

// Размер картинки со страницы (B2C-75): null — не узнать (Node без createImageBitmap); маленькая — через `size`.
const size = vi.hoisted(() => ({ value: null as { width: number; height: number } | null }))
vi.mock('@/lib/photos/linkPhoto', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/linkPhoto')>()),
  imageSize: vi.fn(async () => size.value),
}))

/**
 * PN-08: поле «Ссылка на картинку или страницу» — ссылка → картинка со страницы файлом (`found`); маленькая
 * картинка или отказ ручки — строка «загрузите своё» без `found`; в демо — строка «при сети», ручка не зовётся.
 */
let app: App | null = null
let found: LinkFound[] = []

beforeEach(() => {
  size.value = null
  found = []
  vi.useFakeTimers()
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount(demo = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (demo) useFinanceStore().claimFor(DEMO_HOUSEHOLD)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(LinkPhotoField, { onFound: (f: LinkFound) => found.push(f) }) })
  app.use(pinia)
  app.mount(root)
}

const input = () => document.querySelector('input[placeholder="Вставьте ссылку"]') as HTMLInputElement
const note = () => document.querySelector('[data-link-note]')?.textContent?.trim() ?? null

/** Ввод текста и пауза ввода (300 мс) — фейковые таймеры; ответ ручки — микрозадачи. */
async function paste(text: string) {
  input().value = text
  input().dispatchEvent(new Event('input'))
  await nextTick()
  await vi.advanceTimersByTimeAsync(300)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await nextTick()
}

describe('PN-08: LinkPhotoField — фото цели по ссылке', () => {
  it('ссылка в тексте → ручка превью → `found` с файлом картинки и названием со страницы; строки нет', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Угловой диван', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) })
    mount()
    expect(document.querySelector('[data-link-photo]')).not.toBeNull()
    await paste('Смотрите: https://kaspi.kz/shop/p/sofa-1/ — классный')
    expect(preview).toHaveBeenCalledWith('https://kaspi.kz/shop/p/sofa-1/')
    expect(found).toHaveLength(1)
    expect(found[0].file).toBeInstanceOf(File)
    expect(found[0].file!.type).toBe('image/jpeg')
    expect(found[0].title).toBe('Угловой диван')
    expect(note()).toBeNull()
  })

  it('текст без ссылки и пустое поле — ручка не зовётся, строки нет', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview')
    mount()
    await paste('диван')
    await paste('')
    expect(preview).not.toHaveBeenCalled()
    expect(found).toHaveLength(0)
    expect(note()).toBeNull()
  })

  it('маленькая картинка (логотип) — «загрузите своё», `found` нет', async () => {
    size.value = { width: 120, height: 120 }
    vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Магазин', blob: new Blob(['png'], { type: 'image/png' }) })
    mount()
    await paste('https://shop.kz/p/1')
    expect(found).toHaveLength(0)
    expect(note()).toBe(LINK_PHOTO_MISSED)
  })

  it('отказ ручки (нет картинки, сервер недоступен) — «загрузите своё», без падений', async () => {
    vi.spyOn(apiClient, 'linkPreview').mockRejectedValue(new LinkPreviewError('no image', 422))
    mount()
    await paste('https://shop.kz/p/2')
    expect(found).toHaveLength(0)
    expect(note()).toBe(LINK_PHOTO_MISSED)
  })

  it('демо: сервера нет — строка «при сети», ручка не зовётся', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview')
    mount(true)
    await paste('https://shop.kz/p/3')
    expect(preview).not.toHaveBeenCalled()
    expect(found).toHaveLength(0)
    expect(note()).toBe(LINK_PHOTO_NEEDS_NET)
  })

  it('офлайн (navigator.onLine false) — та же строка «при сети» без запроса; сеть вернулась — следующая ссылка идёт в ручку (критик Б3)', async () => {
    const preview = vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Диван', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) })
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mount()
    await paste('https://shop.kz/p/4')
    expect(preview).not.toHaveBeenCalled()
    expect(note()).toBe(LINK_PHOTO_NEEDS_NET)

    online.mockReturnValue(true)
    await paste('https://shop.kz/p/5')
    expect(preview).toHaveBeenCalledWith('https://shop.kz/p/5')
    expect(found).toHaveLength(1)
    expect(note()).toBeNull()
  })
})
