// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import SegmentGroup from './SegmentGroup.vue'

/** К-11 (FG-09): ползунок под активной кнопкой и переезд после пересоздания экрана. */
let app: App | null = null
let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb)
    return frames.length
  })
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const ITEMS = [
  { key: 'week', label: 'Неделя', attrs: { 'data-plan-view': 'week' } },
  { key: 'month', label: 'Месяц', dot: true, attrs: { 'data-plan-view': 'month' } },
]
const runFrames = async () => {
  while (frames.length) frames.shift()!(0)
  await nextTick()
}
function mount(active: string, label = 'План') {
  const picks: string[] = []
  const now = ref(active)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(SegmentGroup, { items: ITEMS, active: now.value, label, onPick: (k: string) => picks.push(k) }) })
  app.mount(root)
  return { picks, now }
}
const slider = () => document.querySelector<HTMLElement>('[data-segment-slider]')!
const button = (key: string) => document.querySelector<HTMLButtonElement>(`[data-plan-view="${key}"]`)!

describe('kit/SegmentGroup', () => {
  it('ползунок стоит под активной; атрибуты кнопок и точка — из items; pick — только при смене', async () => {
    const { picks, now } = mount('month', 'Тест-1')
    expect(slider().style.transform).toBe('translateX(100%)')
    expect(slider().style.width).toContain('/ 2')
    expect(button('month').getAttribute('aria-current')).toBe('page')
    expect(button('week').getAttribute('aria-current')).toBeNull()
    expect(button('month').querySelector('[data-plan-dot]')).not.toBeNull()
    expect(document.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Тест-1')
    button('month').click()
    expect(picks).toEqual([])
    button('week').click()
    expect(picks).toEqual(['week'])
    // Компонент не пересоздан (квадраты «Денег» — один маршрут): активная сменилась — ползунок едет переходом.
    now.value = 'week'
    await nextTick()
    expect(slider().style.transform).toBe('translateX(0%)')
    expect(slider().className).toContain('transition-transform')
  })

  it('экран пересоздан после нажатия: первый кадр — прежняя позиция, через кадры — под новой; без нажатия — сразу на месте', async () => {
    mount('week', 'Тест-2')
    button('month').click() // запомнили «откуда» — week
    app!.unmount()
    document.body.innerHTML = ''
    mount('month', 'Тест-2')
    expect(slider().style.transform).toBe('translateX(0%)')
    await runFrames()
    await runFrames()
    expect(slider().style.transform).toBe('translateX(100%)')
    // Второй заход без нажатия (вкладкой) — ползунок сразу под активной, кадров не ждёт.
    app!.unmount()
    document.body.innerHTML = ''
    mount('month', 'Тест-2')
    expect(slider().style.transform).toBe('translateX(100%)')
  })
})
