import { describe, it, expect, vi } from 'vitest'
import { ApiClient, LinkPreviewError } from '@/api/client'
import { LINK_PHOTO_MISSED, linkIn, useLinkPreview } from './useLinkPreview'

describe('lib/photos/useLinkPreview — фото желания по ссылке (B2C-66)', () => {
  it('linkIn: первая https-ссылка из текста «Поделиться»; http и пустое — нет', () => {
    expect(linkIn('https://kaspi.kz/shop/p/dyson-1/')).toBe('https://kaspi.kz/shop/p/dyson-1/')
    expect(linkIn('Посмотрите товар «Dyson» на Kaspi.kz: https://kaspi.kz/shop/p/dyson-1/?ref=shared.')).toBe('https://kaspi.kz/shop/p/dyson-1/?ref=shared')
    expect(linkIn('http://shop.kz/p')).toBeNull()
    expect(linkIn('сковорода')).toBeNull()
  })

  it('успех — файл картинки и название; та же ссылка повторно не грузится; отказ — строка «загрузите своё»', async () => {
    const client = { linkPreview: vi.fn() } as unknown as ApiClient & { linkPreview: ReturnType<typeof vi.fn> }
    client.linkPreview.mockResolvedValueOnce({ title: 'Плед', blob: new Blob(['x'], { type: 'image/png' }) })
    const lp = useLinkPreview(client)
    const ok = await lp.load('вот https://kaspi.kz/p/1')
    expect(ok?.url).toBe('https://kaspi.kz/p/1')
    expect(ok?.title).toBe('Плед')
    expect(ok?.file?.type).toBe('image/png')
    expect(lp.busy.value).toBe(false)
    expect(lp.note.value).toBeNull()
    expect(await lp.load('https://kaspi.kz/p/1')).toBeNull()
    expect(client.linkPreview).toHaveBeenCalledTimes(1)

    client.linkPreview.mockRejectedValueOnce(new LinkPreviewError('no image'))
    const miss = await lp.load('https://kaspi.kz/p/2')
    expect(miss).toEqual({ url: 'https://kaspi.kz/p/2', title: '', file: null })
    expect(lp.note.value).toBe(LINK_PHOTO_MISSED)
  })

  it('устаревший ответ не применяется: побеждает последняя вставка', async () => {
    let first!: (v: { title: string; blob: Blob }) => void
    const client = {
      linkPreview: vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => (first = r)))
        .mockResolvedValueOnce({ title: 'Новое', blob: new Blob(['y'], { type: 'image/jpeg' }) }),
    } as unknown as ApiClient
    const lp = useLinkPreview(client)
    const slow = lp.load('https://a.kz/1')
    const fast = await lp.load('https://a.kz/2')
    first({ title: 'Старое', blob: new Blob(['x'], { type: 'image/jpeg' }) })
    expect(await slow).toBeNull()
    expect(fast?.title).toBe('Новое')
  })
})
