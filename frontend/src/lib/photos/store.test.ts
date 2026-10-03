import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import type { PhotoDisk } from './disk'
import { cachedPhotos, clearPhotoDisk, deletePhoto, forgetPhoto, photoUrl, releasePhotos, uploadPhoto } from './store'

/** Диск телефона в памяти — по интерфейсу `PhotoDisk`. */
function memDisk() {
  const files = new Map<string, Blob>()
  const disk: PhotoDisk = {
    get: async (id) => files.get(id) ?? null,
    put: async (id, blob) => void files.set(id, blob),
    remove: async (id) => void files.delete(id),
    clear: async () => files.clear(),
  }
  return { files, disk }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

/** Фото на телефоне (B2C-17): загрузка с типом и токеном, кэш object URL, 404 → null, освобождение. */
describe('lib/photos/store', () => {
  const calls: { url: string; init?: RequestInit }[] = []
  let created: string[] = []
  let revoked: string[] = []
  let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>

  const client = () =>
    new ApiClient({
      getToken: () => 'jwt-123',
      fetchFn: ((url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return fetchImpl(url, init)
      }) as unknown as typeof fetch,
    })

  beforeEach(() => {
    calls.length = 0
    created = []
    revoked = []
    releasePhotos()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => {
        const u = `blob:${created.length}:${b.size}`
        created.push(u)
        return u
      },
      revokeObjectURL: (u: string) => void revoked.push(u),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    releasePhotos()
  })

  it('uploadPhoto: байты телом, Content-Type — тип картинки, токен в Authorization, hidden — в адресе', async () => {
    fetchImpl = async () => new Response(JSON.stringify({ id: 'ph-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
    const pic = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
    expect(await uploadPhoto(pic, {}, client())).toBe('ph-1')
    expect(calls[0].url).toBe('/api/photos')
    const h = new Headers(calls[0].init?.headers)
    expect(h.get('Content-Type')).toBe('image/webp')
    expect(h.get('Authorization')).toBe('Bearer jwt-123')
    expect(calls[0].init?.body).toBe(pic)

    await uploadPhoto(pic, { hidden: true }, client())
    expect(calls[1].url).toBe('/api/photos?hidden=1')
  })

  it('photoUrl: один запрос на id, object URL из кэша; 404 → null и тоже кэшируется; сбой сети не кэшируется', async () => {
    fetchImpl = async (url) =>
      url.endsWith('/photos/gone')
        ? new Response('{"error":"photo not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
        : new Response(new Uint8Array([9, 9, 9, 9]), { status: 200, headers: { 'Content-Type': 'image/webp' } })
    const c = client()
    const [a, b] = await Promise.all([photoUrl('ph-1', c), photoUrl('ph-1', c)])
    expect(a).toBe('blob:0:4')
    expect(b).toBe(a)
    expect(await photoUrl('ph-1', c)).toBe(a)
    expect(calls.filter((x) => x.url.endsWith('/photos/ph-1'))).toHaveLength(1)
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer jwt-123')
    expect(cachedPhotos()).toBe(1)

    expect(await photoUrl('gone', c)).toBeNull()
    expect(await photoUrl('gone', c)).toBeNull()
    expect(calls.filter((x) => x.url.endsWith('/photos/gone'))).toHaveLength(1)

    fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await photoUrl('offline', c)).toBeNull()
    fetchImpl = async () => new Response(new Uint8Array([1]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    expect(await photoUrl('offline', c)).toBe('blob:1:1')
  })

  it('deletePhoto и releasePhotos освобождают object URL', async () => {
    fetchImpl = async (_url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(new Uint8Array([1, 2]), { status: 200, headers: { 'Content-Type': 'image/webp' } })
    const c = client()
    const url = await photoUrl('ph-1', c)
    await deletePhoto('ph-1', c)
    expect(revoked).toEqual([url])
    expect(await photoUrl('ph-1', c)).toBeNull()
    expect(calls.filter((x) => x.init?.method === 'DELETE').map((x) => x.url)).toEqual(['/api/photos/ph-1'])

    await photoUrl('ph-2', c)
    forgetPhoto('ph-2')
    expect(revoked).toHaveLength(2)
    await photoUrl('ph-3', c)
    releasePhotos()
    expect(revoked).toHaveLength(3)
    expect(cachedPhotos()).toBe(0)
  })

  describe('диск телефона (B2C-71)', () => {
    const ok = () => new Response(new Uint8Array([7, 7, 7]), { status: 200, headers: { 'Content-Type': 'image/webp' } })
    const photoCalls = () => calls.filter((x) => x.url.includes('/photos/') && !x.init?.method)

    it('из сети фото ложится на диск; после «перезапуска» (память сброшена) — с диска, без запроса', async () => {
      fetchImpl = async () => ok()
      const { files, disk } = memDisk()
      const c = client()
      expect(await photoUrl('ph-1', c, disk)).toBe('blob:0:3')
      await flush()
      expect(files.has('ph-1')).toBe(true)

      releasePhotos()
      calls.length = 0
      expect(await photoUrl('ph-1', c, disk)).toBe('blob:1:3')
      expect(photoCalls()).toHaveLength(0)
    })

    it('404 на диск не пишется; сбой сети — тоже', async () => {
      const { files, disk } = memDisk()
      fetchImpl = async () => new Response('{"error":"photo not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      expect(await photoUrl('gone', client(), disk)).toBeNull()
      fetchImpl = async () => {
        throw new TypeError('Failed to fetch')
      }
      expect(await photoUrl('offline', client(), disk)).toBeNull()
      await flush()
      expect(files.size).toBe(0)
    })

    it('forgetPhoto и deletePhoto убирают копию с диска', async () => {
      fetchImpl = async (_url, init) => (init?.method === 'DELETE' ? new Response(null, { status: 204 }) : ok())
      const { files, disk } = memDisk()
      const c = client()
      await photoUrl('ph-1', c, disk)
      await photoUrl('ph-2', c, disk)
      await flush()
      forgetPhoto('ph-1', disk)
      await deletePhoto('ph-2', c, disk)
      await flush()
      expect(files.size).toBe(0)
    })

    it('диск бросает на всём — фото всё равно из сети, экран не падает', async () => {
      fetchImpl = async () => ok()
      const boom = async () => {
        throw new Error('QuotaExceededError')
      }
      const disk: PhotoDisk = { get: boom, put: boom, remove: boom, clear: boom }
      expect(await photoUrl('ph-1', client(), disk)).toBe('blob:0:3')
      forgetPhoto('ph-1', disk)
      await clearPhotoDisk(disk)
      await flush()
    })

    it('uploadPhoto кладёт свою картинку на диск; стирание во время загрузки — не кладёт', async () => {
      const { files, disk } = memDisk()
      fetchImpl = async () => new Response(JSON.stringify({ id: 'ph-up' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      const pic = new Blob([new Uint8Array([1, 2])], { type: 'image/webp' })
      await uploadPhoto(pic, {}, client(), disk)
      await flush()
      expect(files.get('ph-up')).toBe(pic)

      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      fetchImpl = async () => {
        await gate
        return ok()
      }
      const showing = photoUrl('late', client(), disk)
      await clearPhotoDisk(disk)
      release()
      await showing
      await flush()
      expect(files.size).toBe(0)
    })

    it('object URL фото с диска освобождается при выходе, как прежде; сама копия на диске остаётся (критик)', async () => {
      fetchImpl = async () => ok()
      const { files, disk } = memDisk()
      files.set('ph-d', new Blob([new Uint8Array([1])], { type: 'image/webp' }))
      const url = await photoUrl('ph-d', client(), disk)
      expect(photoCalls()).toHaveLength(0)
      releasePhotos()
      expect(revoked).toContain(url)
      expect(files.has('ph-d')).toBe(true)
    })
  })
})
