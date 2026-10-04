// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import SortableList from './SortableList.vue'

/**
 * B2C-87: сортируемый список (Р-84) — ⋮⋮ поднимает сразу, строка — удержанием ~300 мс; короткое касание и сдвиг
 * до порога — прокрутка; отпустили вбок за краем — на место; стрелки на ⋮⋮ — выше/ниже; viewer — без ⋮⋮.
 */
let app: App | null = null
const ROW = 60

beforeEach(() => {
  vi.useFakeTimers()
  // Строки по 60 px, список — 0…360 по X: happy-dom не раскладывает.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(ROW)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 360, top: 0, bottom: 240, width: 360, height: 240, x: 0, y: 0, toJSON: () => ({}) })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(disabled = false) {
  const ids = ref(['a', 'b', 'c', 'd'])
  const moves: [string, number][] = []
  const opened: string[] = []
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () =>
      h(
        SortableList,
        {
          ids: ids.value,
          disabled,
          label: (id: string) => `Переставить: ${id}`,
          onMove: (id: string, i: number) => {
            moves.push([id, i])
            const next = ids.value.filter((x) => x !== id)
            next.splice(i, 0, id)
            ids.value = next
          },
        },
        { default: ({ id }: { id: string }) => h('button', { type: 'button', class: 'row', onClick: () => opened.push(id) }, `строка ${id}`) },
      ),
  })
  app.mount(root)
  const rows = () => [...document.querySelectorAll<HTMLElement>('[data-id]')].map((el) => el.dataset.id)
  const row = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!
  const grip = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-grip]')
  return { ids, moves, opened, rows, row, grip }
}

const pointer = (type: string, x: number, y: number, target: EventTarget = window) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0 }))

describe('SortableList', () => {
  it('⋮⋮: тянем вниз за половину соседей — строка едет; отпустили — move(id, место)', async () => {
    const s = mount()
    pointer('pointerdown', 20, 30, s.grip('a')!)
    await nextTick()
    expect(s.row('a').className).toContain('shadow-lift')
    pointer('pointermove', 20, 70)
    await nextTick()
    expect(s.rows()).toEqual(['b', 'a', 'c', 'd'])
    pointer('pointermove', 20, 135)
    await nextTick()
    expect(s.rows()).toEqual(['b', 'c', 'a', 'd'])
    pointer('pointerup', 20, 135)
    await nextTick()
    expect(s.moves).toEqual([['a', 2]])
    expect(s.rows()).toEqual(['b', 'c', 'a', 'd'])
    expect(s.row('a').className).not.toContain('shadow-lift')
  })

  it('строка: удержание < порога — не перетаскивание (прокрутка); сдвиг до подъёма — прокрутка', async () => {
    const s = mount()
    pointer('pointerdown', 20, 30, s.row('b').querySelector('.row')!)
    vi.advanceTimersByTime(200)
    pointer('pointerup', 20, 30)
    vi.advanceTimersByTime(400)
    await nextTick()
    expect(s.row('b').className).not.toContain('shadow-lift')

    pointer('pointerdown', 20, 90, s.row('b').querySelector('.row')!)
    pointer('pointermove', 20, 110) // палец поехал — это прокрутка
    vi.advanceTimersByTime(400)
    await nextTick()
    expect(s.row('b').className).not.toContain('shadow-lift')
    expect(s.moves).toEqual([])
  })

  it('строка: удержание ~300 мс поднимает; клик после подъёма не открывает строку', async () => {
    const s = mount()
    const btn = s.row('c').querySelector<HTMLButtonElement>('.row')!
    pointer('pointerdown', 20, 150, btn)
    vi.advanceTimersByTime(310)
    await nextTick()
    expect(s.row('c').className).toContain('shadow-lift')
    pointer('pointermove', 20, 80)
    pointer('pointerup', 20, 80)
    btn.click()
    await nextTick()
    expect(s.moves).toEqual([['c', 1]])
    expect(s.opened).toEqual([])
    // Обычное нажатие дальше открывает.
    vi.advanceTimersByTime(1)
    s.row('a').querySelector<HTMLButtonElement>('.row')!.click()
    expect(s.opened).toEqual(['a'])
  })

  it('отмена: отпустили вбок за краем списка, Escape, отмена касания — строка на месте, move нет', async () => {
    const s = mount()
    pointer('pointerdown', 20, 30, s.grip('a')!)
    pointer('pointermove', 20, 140)
    await nextTick()
    expect(s.rows()).toEqual(['b', 'c', 'a', 'd'])
    pointer('pointerup', 460, 140)
    await nextTick()
    expect(s.rows()).toEqual(['a', 'b', 'c', 'd'])

    pointer('pointerdown', 20, 30, s.grip('a')!)
    pointer('pointermove', 20, 80)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(s.rows()).toEqual(['a', 'b', 'c', 'd'])

    pointer('pointerdown', 20, 30, s.grip('a')!)
    pointer('pointermove', 20, 80)
    pointer('pointercancel', 20, 80)
    await nextTick()
    expect(s.rows()).toEqual(['a', 'b', 'c', 'd'])
    expect(s.moves).toEqual([])
  })

  it('клавиатура: стрелки на ⋮⋮ — выше/ниже, фокус остаётся на ⋮⋮; за краем — ничего', async () => {
    const s = mount()
    expect(s.grip('c')!.getAttribute('aria-label')).toContain('Переставить: c')
    s.grip('c')!.focus()
    s.grip('c')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await nextTick()
    await nextTick()
    expect(s.rows()).toEqual(['a', 'c', 'b', 'd'])
    expect(document.activeElement).toBe(s.grip('c'))
    s.grip('d')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(s.moves).toEqual([['c', 1]])
  })

  it('disabled (viewer): ⋮⋮ нет, удержание не поднимает', async () => {
    const s = mount(true)
    expect(s.grip('a')).toBeNull()
    pointer('pointerdown', 20, 30, s.row('a').querySelector('.row')!)
    vi.advanceTimersByTime(400)
    await nextTick()
    expect(s.row('a').className).not.toContain('shadow-lift')
  })
})
