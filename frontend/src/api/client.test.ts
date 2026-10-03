import { describe, it, expect, vi } from 'vitest'
import { ApiClient, ApiError, LinkPreviewError, base64Blob } from './client'
import type { SyncDoc } from '@/types/finance'

describe('api/client.ts — типизированный клиент Go API', () => {
  it('отправляет заголовок Authorization при наличии токена', async () => {
    let capturedHeaders: HeadersInit | undefined
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers
      return new Response(JSON.stringify({ user: { id: 'u1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const client = new ApiClient({
      fetchFn: mockFetch as unknown as typeof fetch,
      getToken: () => 'test-jwt-token-123',
    })

    await client.me()

    expect(capturedHeaders).toBeDefined()
    const headers = new Headers(capturedHeaders)
    expect(headers.get('Authorization')).toBe('Bearer test-jwt-token-123')
  })

  it('register и login отправляют корректные JSON тела', async () => {
    let capturedBody = ''
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return new Response(
        JSON.stringify({
          token: 'tok-xyz',
          user: { id: 'u1', email: 'test@example.com' },
          household: { id: 'h1', name: 'Семья' },
          member: { household_id: 'h1', user_id: 'u1', role: 'member', slot: 'a' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const client = new ApiClient({ fetchFn: mockFetch as unknown as typeof fetch })

    const res = await client.login({ email: 'test@example.com', password: 'mock-pass' })
    expect(res.token).toBe('tok-xyz')
    expect(JSON.parse(capturedBody)).toEqual({
      email: 'test@example.com',
      password: 'mock-pass',
    })
  })

  it('выбрасывает ApiError при HTTP ошибках (400, 401, 500)', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ error: 'неверный пароль' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const client = new ApiClient({ fetchFn: mockFetch as unknown as typeof fetch })

    await expect(
      client.login({ email: 'test@example.com', password: 'mock-wrong' }),
    ).rejects.toThrowError(ApiError)

    try {
      await client.login({ email: 'test@example.com', password: 'mock-wrong' })
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError<{ error: string }>
      expect(apiErr.status).toBe(401)
      expect(apiErr.message).toBe('неверный пароль')
      expect(apiErr.isConflict).toBe(false)
    }
  })

  it('при 409 Conflict возвращает ApiError с флагом isConflict и server_doc', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          error: 'conflict',
          server_doc: {
            household_id: 'h1',
            rev: 5,
            data: { people: [] },
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const client = new ApiClient({ fetchFn: mockFetch as unknown as typeof fetch })

    try {
      await client.pushHouseholdDoc(4, { people: [] } as unknown as SyncDoc)
      expect.fail('должно было выбросить ошибку 409')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(409)
      expect(apiErr.isConflict).toBe(true)
      expect((apiErr.data as any).server_doc.rev).toBe(5)
    }
  })
})

describe('api/client.ts — фото по ссылке (B2C-66)', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('linkPreview: POST {url}, base64 → Blob нужного типа и название', async () => {
    let sent = ''
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      sent = `${init?.method} ${url} ${String(init?.body)}`
      return json(200, { title: 'Dyson Airwrap', imageType: 'image/jpeg', image: btoa('ÿØÿjpeg') })
    })
    const client = new ApiClient({ fetchFn: fetchFn as unknown as typeof fetch, getToken: () => 't' })
    const { title, blob } = await client.linkPreview('https://kaspi.kz/shop/p/1')
    expect(sent).toBe('POST /api/photos/preview {"url":"https://kaspi.kz/shop/p/1"}')
    expect(title).toBe('Dyson Airwrap')
    expect(blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 106, 112, 101, 103]))
    expect(base64Blob(btoa('ab'), 'image/png').size).toBe(2)
  })

  it('ошибки 400/422 → LinkPreviewError с причиной; без сети — offline; незнакомое — unavailable', async () => {
    const cases: [Response | Error, string][] = [
      [json(400, { error: 'bad url' }), 'bad url'],
      [json(400, { error: 'blocked' }), 'blocked'],
      [json(422, { error: 'no image' }), 'no image'],
      [json(422, { error: 'too large' }), 'too large'],
      [json(422, { error: 'timeout' }), 'timeout'],
      [json(403, { error: 'forbidden: only members can change data' }), 'unavailable'],
      [new TypeError('Failed to fetch'), 'offline'],
    ]
    for (const [answer, reason] of cases) {
      const fetchFn = vi.fn(async () => {
        if (answer instanceof Error) throw answer
        return answer
      })
      const client = new ApiClient({ fetchFn: fetchFn as unknown as typeof fetch })
      const err = await client.linkPreview('https://kaspi.kz/x').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LinkPreviewError)
      expect((err as LinkPreviewError).reason).toBe(reason)
    }
  })
})
