// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, createSSRApp, h, nextTick, ref, type App } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CountUp from './CountUp.vue'
import { money } from '@/lib/money'

/**
 * Бег цифр (B2C-47, Р-45): SSR — конечное; «уменьшить движение» — без промежуточных; бег —
 * целые промежуточные, финал равен цели. Кадры — заглушка `requestAnimationFrame` с ручным временем.
 */
let app: App | null = null
let frames: FrameRequestCallback[] = []
let now = 0
let reduce = false

beforeEach(() => {
  frames = []
  now = 0
  reduce = false
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Прогнать кадры до `t` мс. */
function tick(t: number) {
  now = t
  const run = frames
  frames = []
  run.forEach((cb) => cb(t))
}

function mount(value: number) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(CountUp, { value, format: money }) })
  app.mount(root)
  return root
}

/** Видимый текст: невидимая «распорка» ширины в счёт не идёт. */
const shown = (root: HTMLElement) =>
  [...root.querySelectorAll('span')].filter((s) => !s.children.length && !s.classList.contains('invisible')).map((s) => s.textContent)[0]

describe('kit/CountUp', () => {
  it('SSR — сразу конечное значение, одной строкой', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CountUp, { value: 313000, format: money }) }))
    expect(html).toBe(`<span>${money(313000)}</span>`)
  })

  it('при появлении бежит от нуля: промежуточные целые, растут, финал равен цели', async () => {
    const root = mount(313000)
    await nextTick()
    expect(shown(root)).toBe(money(0))
    const seen: number[] = []
    for (let t = 100; t <= 1000; t += 100) {
      tick(t)
      await nextTick()
      seen.push(Number(shown(root)!.replace(/\D/g, '')))
    }
    expect(seen.every((n) => Number.isInteger(n))).toBe(true)
    expect(seen.slice(0, -1).some((n) => n > 0 && n < 313000)).toBe(true)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(seen.at(-1)).toBe(313000)
    // Бег не дольше секунды: после 1000 мс кадров больше не просят.
    expect(frames).toEqual([])
  })

  it('«уменьшить движение» — без промежуточных, кадров не просит', async () => {
    reduce = true
    const root = mount(84300)
    await nextTick()
    expect(shown(root)).toBe(money(84300))
    expect(frames).toEqual([])
  })

  it('смена значения — бег от показанного к новому', async () => {
    reduce = true
    const v = ref(1000)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(CountUp, { value: v.value, format: (n: number) => `${n}%` }) })
    app.mount(root)
    reduce = false
    v.value = 40
    await nextTick()
    tick(450)
    await nextTick()
    const mid = Number(shown(root)!.replace('%', ''))
    expect(mid).toBeGreaterThan(40)
    expect(mid).toBeLessThan(1000)
    tick(900)
    await nextTick()
    expect(shown(root)).toBe('40%')
  })
})
