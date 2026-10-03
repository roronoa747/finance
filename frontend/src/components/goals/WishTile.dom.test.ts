// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import type { WishItem } from '@/types/finance'
import WishTile from './WishTile.vue'

/** B2C-73: широкое фото желания — целиком (`object-contain`), квадратное — на всю плитку. */
let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const wish: WishItem = { id: 'w1', name: 'Контроллер', price: 30_000, by: 'a', addedOn: '2026-09-20', bought: false, updatedAt: '2026-09-20T00:00:00Z' }

async function loaded(width: number, height: number) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(WishTile, { wish, src: 'blob:pic', canEdit: true })
  app.mount(root)
  await nextTick()
  const img = root.querySelector('img')!
  expect(img.classList.contains('object-cover')).toBe(true) // до load — как раньше
  Object.defineProperty(img, 'naturalWidth', { value: width })
  Object.defineProperty(img, 'naturalHeight', { value: height })
  img.dispatchEvent(new Event('load'))
  await nextTick()
  return img
}

describe('WishTile — широкие фото (B2C-73)', () => {
  it('1200×400 → object-contain на фоне плитки', async () => {
    const img = await loaded(1200, 400)
    expect(img.classList.contains('object-contain')).toBe(true)
    expect(img.classList.contains('object-cover')).toBe(false)
    expect(img.parentElement!.classList.contains('bg-surface-3')).toBe(true)
  })

  it('800×800 → object-cover', async () => {
    const img = await loaded(800, 800)
    expect(img.classList.contains('object-cover')).toBe(true)
    expect(img.classList.contains('object-contain')).toBe(false)
  })
})
