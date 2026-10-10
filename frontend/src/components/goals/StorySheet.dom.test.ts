// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { shareStory } from '@/lib/storyCard'

/**
 * Кнопки карточки (B2C-20): есть `canShare` — системный лист с файлом; нет — скачивание
 * `<a download>`. Рисование в happy-dom невозможно (`getContext` нет) — `renderStory` заглушка.
 */
vi.mock('@/lib/storyCard', async (orig) => {
  const mod = await orig<typeof import('@/lib/storyCard')>()
  return { ...mod, renderStory: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }
})

let app: App | null = null
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('shareStory', () => {
  it('canShare с файлом → navigator.share с файлом и заголовком; отмена — «cancelled», сбой — скачивание', async () => {
    const share = vi.fn<(d: ShareData) => Promise<void>>(async () => {})
    const canShare = vi.fn(() => true)
    const blob = new Blob(['x'], { type: 'image/png' })
    expect(await shareStory(blob, { title: '62 % до мечты' }, { share, canShare })).toBe('shared')
    const data = share.mock.calls[0][0]
    expect(data.title).toBe('62 % до мечты')
    expect(data.files?.[0]).toBeInstanceOf(File)
    expect(data.files?.[0].name).toBe('family-finance-story.png')
    expect(canShare).toHaveBeenCalledWith({ files: [data.files![0]] })

    const abort = Object.assign(new Error('abort'), { name: 'AbortError' })
    expect(await shareStory(blob, { title: 't' }, { share: vi.fn(async () => { throw abort }), canShare })).toBe('cancelled')

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(await shareStory(blob, { title: 't' }, { share: vi.fn(async () => { throw new Error('boom') }), canShare })).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('без canShare — ссылка download с именем файла', async () => {
    const seen: { download: string; rel: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ download: this.download, rel: this.rel })
    })
    expect(await shareStory(new Blob(['x']), { title: 't' }, null)).toBe('downloaded')
    expect(await shareStory(new Blob(['x']), { title: 't' }, {})).toBe('downloaded')
    expect(seen).toEqual([
      { download: 'family-finance-story.png', rel: 'noopener' },
      { download: 'family-finance-story.png', rel: 'noopener' },
    ])
    expect(document.querySelector('a[download]')).toBeNull()
  })
})

describe('StorySheet', () => {
  beforeEach(() => {
    // happy-dom без object URL — скачивание строит ссылку на него.
    Object.assign(URL, { createObjectURL: () => 'blob:story', revokeObjectURL: () => {} })
  })

  async function mount(state: { open: boolean }, kind: 'goal' | 'leaks' = 'goal') {
    const { default: StorySheet } = await import('./StorySheet.vue')
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({
      render: () => h(StorySheet, { open: state.open, kind, data: kind === 'goal' ? { percent: 62, goalName: 'Япония', doneMonth: 'мае 2027' } : { count: 3 }, src: null, onClose: () => (state.open = false) }),
    })
    app.mount(root)
    await nextTick()
    await flush()
    await nextTick()
  }
  const text = () => document.body.textContent ?? ''
  const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined

  it('открытие рисует карточку; с navigator.share — «Поделиться» и «Сохранить», нажатие шлёт файл', async () => {
    const share = vi.fn<(d: ShareData) => Promise<void>>(async () => {})
    Object.assign(navigator, { share, canShare: () => true })
    const state = reactive({ open: true })
    await mount(state)
    const { renderStory } = await import('@/lib/storyCard')
    expect(renderStory).toHaveBeenCalled()
    expect(text()).toContain('Карточка для сторис')
    expect(text()).toContain('Без сумм — только процент, имя мечты и месяц.')
    expect(button('Поделиться')).toBeTruthy()
    expect(button('Сохранить')).toBeTruthy()
    expect(button('Поделиться')!.disabled).toBe(false)
    button('Поделиться')!.click()
    await flush()
    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0][0].title).toBe('62 % до мечты')
    expect(text()).toContain('Отправлено')
  })

  it('PN-10: «Сохранить как обои» — у мечты, не у утечек; нажатие рисует вариант wallpaper в своём canvas и шлёт файл обоев', async () => {
    const share = vi.fn<(d: ShareData) => Promise<void>>(async () => {})
    Object.assign(navigator, { share, canShare: () => true })
    const state = reactive({ open: true })
    await mount(state)
    const { renderStory } = await import('@/lib/storyCard')
    const render = renderStory as unknown as ReturnType<typeof vi.fn>
    const previewCanvas = document.querySelector('canvas')!
    const wallpaper = document.querySelector('[data-story-wallpaper]') as HTMLButtonElement
    expect(wallpaper).toBeTruthy()
    expect(wallpaper.textContent?.trim()).toBe('Сохранить как обои')
    expect(wallpaper.disabled).toBe(false)
    const before = render.mock.calls.length
    wallpaper.click()
    await flush()
    await nextTick()
    await flush()
    expect(render.mock.calls.length).toBe(before + 1)
    const [canvas, opts] = render.mock.calls.at(-1)! as [HTMLCanvasElement, { texts: { kind: string; app: string; big: string; line: string } }]
    expect(canvas).not.toBe(previewCanvas)
    expect(opts.texts).toMatchObject({ kind: 'wallpaper', app: '', big: '62 %', line: 'Япония · будет нашей в мае 2027' })
    expect(share).toHaveBeenCalledTimes(1)
    const data = share.mock.calls[0][0]
    expect(data.title).toBe('Обои · Япония')
    expect(data.files?.[0].name).toBe('family-finance-wallpaper.png')
    expect(document.querySelector('[data-story-wallpaper-note]')?.textContent).toContain('поставьте на экран блокировки')

    app?.unmount()
    document.body.innerHTML = ''
    await mount(reactive({ open: true }), 'leaks')
    expect(document.querySelector('[data-story-wallpaper]')).toBeNull()
  })

  it('без navigator.share — только «Сохранить»; утечки — «Карточка месяца»', async () => {
    const nav = navigator as unknown as Record<string, unknown>
    delete nav.share
    delete nav.canShare
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const state = reactive({ open: true })
    await mount(state, 'leaks')
    expect(text()).toContain('Карточка месяца')
    expect(text()).toContain('Без сумм — только число подписок.')
    expect(button('Поделиться')).toBeUndefined()
    button('Сохранить')!.click()
    await flush()
    expect(click).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Сохранено в загрузки')
  })
})
