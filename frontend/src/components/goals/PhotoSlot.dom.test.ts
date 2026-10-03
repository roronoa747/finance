// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import PhotoSlot from './PhotoSlot.vue'

/** B2C-73 (критик): `PhotoSlot` общий с целями — широкое вписывается только с `fit` (желания). */
let app: App | null = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

function mount(props: { src: string; fit?: boolean }) {
  const state = reactive({ ...props })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(PhotoSlot, state) })
  app.mount(root)
  return { state, img: () => root.querySelector('img')! }
}

function load(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true })
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true })
  img.dispatchEvent(new Event('load'))
}

describe('PhotoSlot — широкие фото (B2C-73)', () => {
  it('без fit (цель, сюрприз) — широкое на всю плитку, как раньше', async () => {
    const { img } = mount({ src: 'blob:goal' })
    await nextTick()
    load(img(), 1200, 400)
    await nextTick()
    expect(img().classList.contains('object-cover')).toBe(true)
    expect(img().classList.contains('object-contain')).toBe(false)
  })

  it('с fit (желание) — широкое целиком; смена картинки — снова cover до её load', async () => {
    const { state, img } = mount({ src: 'blob:wide', fit: true })
    await nextTick()
    load(img(), 1200, 400)
    await nextTick()
    expect(img().classList.contains('object-contain')).toBe(true)

    state.src = 'blob:square'
    await nextTick()
    expect(img().classList.contains('object-cover')).toBe(true)
    load(img(), 800, 800)
    await nextTick()
    expect(img().classList.contains('object-cover')).toBe(true)
  })
})
