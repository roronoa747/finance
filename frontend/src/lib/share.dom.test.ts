// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareFile } from './share'

/** PN-28: один механизм «файл на устройство» — сторис, обои, календарь. */
describe('shareFile', () => {
  afterEach(() => vi.restoreAllMocks())
  const blob = new Blob(['BEGIN:VCALENDAR'], { type: 'text/calendar' })
  const opts = { title: 'Платежи', fileName: 'family-finance.ics' }
  const spyDownload = () => vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  it('системный лист есть — делится файлом с именем и типом, не скачивает', async () => {
    const click = spyDownload()
    const share = vi.fn(async (_: ShareData) => {})
    const r = await shareFile(blob, opts, { canShare: () => true, share })
    expect(r).toBe('shared')
    const file = share.mock.calls[0]![0].files![0]!
    expect([file.name, file.type]).toEqual(['family-finance.ics', 'text/calendar'])
    expect(click).not.toHaveBeenCalled()
  })

  it('файлами делиться нельзя или навигатора нет — скачивает', async () => {
    const click = spyDownload()
    expect(await shareFile(blob, opts, { canShare: () => false, share: vi.fn() })).toBe('downloaded')
    expect(await shareFile(blob, opts, null)).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('отмена пользователем — cancelled без скачивания; другая ошибка листа — скачивает', async () => {
    const click = spyDownload()
    const abort = Object.assign(new Error('x'), { name: 'AbortError' })
    expect(await shareFile(blob, opts, { canShare: () => true, share: () => Promise.reject(abort) })).toBe('cancelled')
    expect(click).not.toHaveBeenCalled()
    expect(await shareFile(blob, opts, { canShare: () => true, share: () => Promise.reject(new Error('NotAllowed')) })).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(1)
  })
})
