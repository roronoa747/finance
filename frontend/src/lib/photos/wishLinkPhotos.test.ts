import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WishItem } from '@/types/finance'
import { LINK_PHOTO_TRIED_KEY, LINK_PHOTOS_PER_OPEN, TRIED_MAX, fillWishPhotos, triedLinks, wishesNeedingPhoto, type WishPhotoDeps, type WishPhotoStore } from './wishLinkPhotos'

/**
 * B2C-68: фото у старых желаний со ссылкой — обход при открытии «Желаний»: по одному, не больше 10,
 * отказ ручки запоминается на телефоне, желание проверяется перед записью.
 */
const T0 = '2026-09-01T00:00:00.000Z'
const wish = (id: string, extra: Partial<WishItem> = {}): WishItem => ({
  id, name: id, price: 1_000, by: 'a', addedOn: '2026-09-01', bought: false, updatedAt: T0, ...extra,
})

function fakeStore(wishlist: WishItem[], isDemo = false): WishPhotoStore & { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn((id: string, photoId: string | null) => {
    const w = wishlist.find((x) => x.id === id)
    if (w) w.photoId = photoId
  })
  return { wishlist, isDemo, setWishPhoto: set, set }
}

function fakeDeps(preview: WishPhotoDeps['preview']): WishPhotoDeps & { previewed: string[]; uploaded: Blob[]; removed: string[]; tried: Set<string> } {
  const previewed: string[] = []
  const uploaded: Blob[] = []
  const removed: string[] = []
  const tried = new Set<string>()
  let n = 0
  return {
    previewed,
    uploaded,
    removed,
    tried,
    preview: (url) => {
      previewed.push(url)
      return preview(url)
    },
    compress: async (blob) => ({ blob }),
    upload: async (blob) => {
      uploaded.push(blob)
      return `ph-${++n}`
    },
    remove: async (id) => {
      removed.push(id)
    },
  }
}

const picture = () => new Blob(['jpeg'], { type: 'image/jpeg' })

describe('lib/photos/wishLinkPhotos — фото у старых желаний со ссылкой (B2C-68)', () => {
  it('кандидаты: живые, без фото, со ссылкой https; http, с фото, купленные без ссылки и удалённые — нет', () => {
    const list = [
      wish('a', { url: 'https://kaspi.kz/p/1' }),
      wish('b', { url: 'https://kaspi.kz/p/2', photoId: 'ph' }),
      wish('c'),
      wish('d', { url: 'http://shop.kz/p/3' }),
      wish('e', { url: 'https://kaspi.kz/p/4', deletedAt: T0 }),
      wish('f', { url: 'https://kaspi.kz/p/5', bought: true }),
    ]
    expect(wishesNeedingPhoto(list).map((w) => w.id)).toEqual(['a', 'f'])
  })

  it('три желания со ссылкой без фото + одно с фото + одно без ссылки → ровно три превью, по очереди; у каждого — своё фото', async () => {
    const store = fakeStore([
      wish('w1', { url: 'https://kaspi.kz/p/1' }),
      wish('w2', { url: 'https://kaspi.kz/p/2', photoId: 'own' }),
      wish('w3', { url: 'https://kaspi.kz/p/3' }),
      wish('w4'),
      wish('w5', { url: 'https://kaspi.kz/p/5' }),
    ])
    let parallel = 0
    let maxParallel = 0
    const deps = fakeDeps(async () => {
      parallel += 1
      maxParallel = Math.max(maxParallel, parallel)
      await new Promise((r) => setTimeout(r, 1))
      parallel -= 1
      return picture()
    })
    expect(await fillWishPhotos(store, deps)).toBe(3)
    expect(deps.previewed).toEqual(['https://kaspi.kz/p/1', 'https://kaspi.kz/p/3', 'https://kaspi.kz/p/5'])
    expect(maxParallel).toBe(1)
    expect(deps.uploaded).toHaveLength(3)
    expect(store.wishlist.map((w) => w.photoId)).toEqual(['ph-1', 'own', 'ph-2', undefined, 'ph-3'])
    expect(deps.tried.size).toBe(0)
  })

  it('отказ ручки («no image») → адрес в tried, повторный вызов его не запрашивает; сети нет → обход прерван, адрес не запомнен', async () => {
    const store = fakeStore([wish('w1', { url: 'https://kaspi.kz/p/1' }), wish('w2', { url: 'https://kaspi.kz/p/2' })])
    const deps = fakeDeps(async (url) => (url.endsWith('/1') ? null : picture()))
    expect(await fillWishPhotos(store, deps)).toBe(1)
    expect(deps.tried.has('https://kaspi.kz/p/1')).toBe(true)
    expect(store.wishlist[0].photoId).toBeUndefined()
    expect(store.wishlist[1].photoId).toBe('ph-1')

    deps.previewed.length = 0
    expect(await fillWishPhotos(store, deps)).toBe(0)
    expect(deps.previewed).toEqual([])

    const offline = fakeStore([wish('o1', { url: 'https://kaspi.kz/p/8' }), wish('o2', { url: 'https://kaspi.kz/p/9' })])
    const down = fakeDeps(async () => {
      throw new Error('offline')
    })
    expect(await fillWishPhotos(offline, down)).toBe(0)
    expect(down.previewed).toEqual(['https://kaspi.kz/p/8'])
    expect(down.tried.size).toBe(0)
  })

  it('желание удалено или получило фото между превью и записью → setWishPhoto не вызван, зря загруженное фото удаляется', async () => {
    const store = fakeStore([wish('gone', { url: 'https://kaspi.kz/p/1' }), wish('own', { url: 'https://kaspi.kz/p/2' })])
    const deps = fakeDeps(async () => picture())
    // Партнёр успел: первое желание удалил, второму поставил своё фото — пока картинка грузилась.
    deps.upload = async () => {
      store.wishlist[0].deletedAt = T0
      store.wishlist[1].photoId = 'partner'
      return 'ph-late'
    }
    expect(await fillWishPhotos(store, deps)).toBe(0)
    expect(store.set).not.toHaveBeenCalled()
    expect(deps.removed).toEqual(['ph-late'])
    // Удалено до загрузки — не грузим вовсе.
    const early = fakeStore([wish('e', { url: 'https://kaspi.kz/p/3' })])
    const quick = fakeDeps(async () => {
      early.wishlist[0].deletedAt = T0
      return picture()
    })
    expect(await fillWishPhotos(early, quick)).toBe(0)
    expect(quick.uploaded).toHaveLength(0)
  })

  it('лимит 10 превью за открытие; уже известные адреса в лимит не входят; отмена — следующее желание не берётся; демо — ни одного', async () => {
    const list = Array.from({ length: 14 }, (_, i) => wish(`w${i}`, { url: `https://kaspi.kz/p/${i}` }))
    const store = fakeStore(list)
    const deps = fakeDeps(async () => picture())
    deps.tried.add('https://kaspi.kz/p/0')
    expect(await fillWishPhotos(store, deps)).toBe(LINK_PHOTOS_PER_OPEN)
    expect(deps.previewed).toHaveLength(10)
    expect(deps.previewed[0]).toBe('https://kaspi.kz/p/1')
    expect(store.wishlist.filter((w) => w.photoId)).toHaveLength(10)

    const ac = new AbortController()
    const rest = fakeStore(list.slice(11))
    const stop = fakeDeps(async () => {
      ac.abort()
      return picture()
    })
    expect(await fillWishPhotos(rest, stop, ac.signal)).toBe(1)
    expect(stop.previewed).toHaveLength(1)

    const demo = fakeStore([wish('d', { url: 'https://kaspi.kz/p/1' })], true)
    const none = fakeDeps(async () => picture())
    expect(await fillWishPhotos(demo, none)).toBe(0)
    expect(none.previewed).toEqual([])
  })

  describe('triedLinks — память на устройстве', () => {
    const storage = new Map<string, string>()
    beforeEach(() => {
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, String(v)),
        removeItem: (k: string) => storage.delete(k),
        clear: () => storage.clear(),
      })
      storage.clear()
    })
    afterEach(() => vi.unstubAllGlobals())

    it('пишет список адресов под ff_link_photo_tried, читает его в следующий раз, держит не больше 200 последних; мусор в ключе не ломает', () => {
      const t = triedLinks()
      t.add('https://a.kz/1')
      t.add('https://a.kz/2')
      expect(JSON.parse(storage.get(LINK_PHOTO_TRIED_KEY)!)).toEqual(['https://a.kz/1', 'https://a.kz/2'])
      const again = triedLinks()
      expect(again.has('https://a.kz/1')).toBe(true)
      expect(again.has('https://a.kz/3')).toBe(false)
      for (let i = 0; i < TRIED_MAX + 5; i++) again.add(`https://b.kz/${i}`)
      const kept = JSON.parse(storage.get(LINK_PHOTO_TRIED_KEY)!) as string[]
      expect(kept).toHaveLength(TRIED_MAX)
      expect(kept).not.toContain('https://a.kz/1')
      expect(kept.at(-1)).toBe(`https://b.kz/${TRIED_MAX + 4}`)

      storage.set(LINK_PHOTO_TRIED_KEY, JSON.stringify({ not: 'a list' }))
      expect(triedLinks().has('x')).toBe(false)
      storage.set(LINK_PHOTO_TRIED_KEY, JSON.stringify(['https://c.kz/1', 7, null]))
      expect(triedLinks().has('https://c.kz/1')).toBe(true)
    })
  })
})
