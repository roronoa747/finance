import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import { cachedPhotos, deletePhoto, forgetPhoto, photoUrl, releasePhotos, uploadPhoto } from './store'

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
})
