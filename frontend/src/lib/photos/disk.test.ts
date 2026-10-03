import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheDisk, PHOTO_CACHE } from './disk'

/** Подменённый `caches`: кэши по имени, записи по адресу ключа. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)!
    return {
      match: async (key: string) => m.get(key)?.clone(),
      put: async (key: string, res: Response) => void m.set(key, res),
      delete: async (key: string) => m.delete(key),
    }
  }
  return { stores, caches: { open, delete: async (name: string) => stores.delete(name) } }
}

describe('lib/photos/disk (B2C-71)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('put / get / remove / clear — в кэше ff-photos', async () => {
    const fake = fakeCaches()
    vi.stubGlobal('caches', fake.caches)
    const disk = cacheDisk()
    expect(await disk.get('ph-1')).toBeNull()

    await disk.put('ph-1', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }))
    await disk.put('ph-2', new Blob([new Uint8Array([4])], { type: 'image/jpeg' }))
    const got = await disk.get('ph-1')
    expect(got?.size).toBe(3)
    expect(got?.type).toBe('image/webp')
    expect(fake.stores.get(PHOTO_CACHE)?.size).toBe(2)

    await disk.remove('ph-1')
    expect(await disk.get('ph-1')).toBeNull()
    expect((await disk.get('ph-2'))?.size).toBe(1)

    await disk.clear()
    expect(fake.stores.has(PHOTO_CACHE)).toBe(false)
    expect(await disk.get('ph-2')).toBeNull()
  })

  it('нет caches или хранилище бросает — тихо: null и ничего', async () => {
    vi.stubGlobal('caches', undefined)
    const disk = cacheDisk()
    expect(await disk.get('ph-1')).toBeNull()
    await disk.put('ph-1', new Blob([new Uint8Array([1])]))
    await disk.remove('ph-1')
    await disk.clear()

    const boom = async () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    vi.stubGlobal('caches', { open: boom, delete: boom })
    expect(await disk.get('ph-1')).toBeNull()
    await disk.put('ph-1', new Blob([new Uint8Array([1])]))
    await disk.remove('ph-1')
    await disk.clear()
  })
})
