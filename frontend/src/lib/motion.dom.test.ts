// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import StackBar from '@/components/kit/StackBar.vue'

/**
 * Полосы растут от нуля (B2C-47, Р-45): в браузере — пустые с первой вставки и полные на втором
 * кадре (иначе переход width не виден — оболочка пересчитывает стили в том же цикле); «уменьшить
 * движение» — сразу полные, кадров не просят.
 */
let app: App | null = null
let frames: FrameRequestCallback[] = []
let reduce = false

beforeEach(() => {
  frames = []
  reduce = false
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.mount(root)
  return root
}
const frame = () => {
  const run = frames
  frames = []
  run.forEach((cb) => cb(0))
}
const widths = (root: HTMLElement) => [...root.querySelectorAll('i')].map((i) => (i as HTMLElement).style.width)

describe('lib/motion — рост полос', () => {
  it('ProgressBar и StackBar: вставка пустой, второй кадр — конечная ширина', async () => {
    const root = mount(() => h('div', [h(ProgressBar, { value: 0.15 }), h(StackBar, { segments: [{ key: 'a', share: 0.4, color: 'var(--s1)' }] })]))
    expect(widths(root)).toEqual(['0%', '0%'])
    frame()
    await nextTick()
    expect(widths(root)).toEqual(['0%', '0%'])
    frame()
    await nextTick()
    expect(widths(root)).toEqual(['15%', '40%'])
    // Доля для озвучки — сразу конечная.
    expect(root.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('15')
  })

  it('«уменьшить движение» — сразу конечная ширина, кадров не просит', async () => {
    reduce = true
    const root = mount(() => h(ProgressBar, { value: 0.4 }))
    await nextTick()
    expect(widths(root)).toEqual(['40%'])
    expect(frames).toEqual([])
  })
})
