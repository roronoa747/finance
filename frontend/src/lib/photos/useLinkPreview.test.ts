import { describe, it, expect, vi } from 'vitest'
import { effectScope } from 'vue'
import { ApiClient, LinkPreviewError } from '@/api/client'
import { LINK_PHOTO_MISSED, cleanLink, linkIn, useLinkPreview } from './useLinkPreview'

describe('lib/photos/useLinkPreview — фото желания по ссылке (B2C-66)', () => {
  it('linkIn: первая https-ссылка из текста «Поделиться»; http и пустое — нет', () => {
    expect(linkIn('https://kaspi.kz/shop/p/dyson-1/')).toBe('https://kaspi.kz/shop/p/dyson-1/')
    expect(linkIn('Посмотрите товар «Dyson» на Kaspi.kz: https://kaspi.kz/shop/p/dyson-1/?ref=shared.')).toBe('https://kaspi.kz/shop/p/dyson-1/?ref=shared')
    expect(linkIn('http://shop.kz/p')).toBeNull()
    expect(linkIn('сковорода')).toBeNull()
    expect(cleanLink('Товар: https://kaspi.kz/p/1.')).toBe('https://kaspi.kz/p/1')
    expect(cleanLink('  shop.kz/p  ')).toBe('shop.kz/p')
  })

  it('клинап Б12 schedule: запрос после паузы 300 мс по последнему тексту; reset и конец области отменяют ждущий', async () => {
    vi.useFakeTimers()
    try {
      const client = { linkPreview: vi.fn(async () => ({ title: 'Плед', blob: new Blob(['x'], { type: 'image/png' }) })) } as unknown as ApiClient
      const scope = effectScope()
      const lp = scope.run(() => useLinkPreview(client))!
      const apply = vi.fn()
      lp.schedule('https://kaspi.kz/p/1', apply)
      await vi.advanceTimersByTimeAsync(200)
      lp.schedule('https://kaspi.kz/p/2', apply)
      await vi.advanceTimersByTimeAsync(299)
      expect(client.linkPreview).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(client.linkPreview).toHaveBeenCalledTimes(1)
      expect(client.linkPreview).toHaveBeenCalledWith('https://kaspi.kz/p/2')
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://kaspi.kz/p/2', title: 'Плед' }))

      lp.schedule('https://kaspi.kz/p/3', apply)
      lp.reset()
      lp.schedule('https://kaspi.kz/p/4', apply)
      scope.stop()
      await vi.advanceTimersByTimeAsync(1000)
      expect(client.linkPreview).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('клинап Б12 clearNote: своё фото гасит «загрузите своё»', async () => {
    const client = { linkPreview: vi.fn().mockRejectedValue(new LinkPreviewError('no image')) } as unknown as ApiClient
    const lp = useLinkPreview(client)
    await lp.load('https://shop.kz/p/9')
    expect(lp.note.value).toBe(LINK_PHOTO_MISSED)
    lp.clearNote()
    expect(lp.note.value).toBeNull()
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

  it('B2C-75: маленькая картинка (короткая сторона < 300) — файла нет, название остаётся, «загрузите своё»; большая — файл', async () => {
    const client = { linkPreview: vi.fn(async () => ({ title: 'Кофта', blob: new Blob(['x'], { type: 'image/png' }) })) } as unknown as ApiClient
    let size = { width: 120, height: 120 }
    const lp = useLinkPreview(client, async () => size)
    expect(await lp.load('https://mobile.yangkeduo.com/goods1.html?goods_id=1')).toEqual({
      url: 'https://mobile.yangkeduo.com/goods1.html?goods_id=1',
      title: 'Кофта',
      file: null,
    })
    expect(lp.note.value).toBe(LINK_PHOTO_MISSED)

    size = { width: 800, height: 600 }
    const found = await lp.load('https://kaspi.kz/shop/p/pled-2/')
    expect(found?.file).toBeInstanceOf(File)
    expect(lp.note.value).toBeNull()
  })
})
