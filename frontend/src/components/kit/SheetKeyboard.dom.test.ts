// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import Sheet from './Sheet.vue'

/**
 * F2-02: лист над экранной клавиатурой. Клавиатуры в headless нет — её делает мок `visualViewport`: видимая часть
 * меньше окна на высоту клавиатуры.
 */

let app: App | null = null
let vv: FakeViewport

class FakeViewport extends EventTarget {
  height = window.innerHeight
  offsetTop = 0
  scale = 1
  listeners = 0
  addEventListener(...a: Parameters<EventTarget['addEventListener']>) {
    this.listeners++
    super.addEventListener(...a)
  }
  removeEventListener(...a: Parameters<EventTarget['removeEventListener']>) {
    this.listeners--
    super.removeEventListener(...a)
  }
  set(height: number, extra: Partial<Pick<FakeViewport, 'offsetTop' | 'scale'>> = {}) {
    this.height = height
    Object.assign(this, extra)
    this.dispatchEvent(new Event('resize'))
  }
}

beforeEach(() => {
  vv = new FakeViewport()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
})

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.mount(root)
}

const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
const wrapOf = (d: HTMLElement) => d.parentElement as HTMLElement

describe('F2-02: лист над клавиатурой', () => {
  it('клавиатура открыта — обёртка над ней, карточка не выше видимого; закрыта — как раньше', async () => {
    mount(() => h(Sheet, { open: true, title: 'Кредит' }, () => h('input', { id: 'f' })))
    await nextTick()
    const card = dialogs()[0]
    expect(wrapOf(card).style.bottom).toBe('')
    expect(card.style.maxHeight).toBe('')

    const H = window.innerHeight
    vv.set(H - 300)
    await nextTick()
    expect(wrapOf(card).style.bottom).toBe('300px')
    expect(card.style.maxHeight).toBe(`${Math.round((H - 300) * 0.88)}px`)

    vv.set(H)
    await nextTick()
    expect(wrapOf(card).style.bottom).toBe('')
    expect(card.style.maxHeight).toBe('')
  })

  it('iOS: видимая часть сдвинута вниз (offsetTop) — закрыто только то, что под ней', async () => {
    mount(() => h(Sheet, { open: true, title: 'Кредит' }, () => h('p', 'тело')))
    await nextTick()
    const H = window.innerHeight
    vv.set(H - 300, { offsetTop: 100 })
    await nextTick()
    expect(wrapOf(dialogs()[0]).style.bottom).toBe('200px')
  })

  it('масштаб пальцами — не клавиатура', async () => {
    mount(() => h(Sheet, { open: true, title: 'Кредит' }, () => h('p', 'тело')))
    await nextTick()
    vv.set(window.innerHeight / 2, { scale: 2 })
    await nextTick()
    expect(wrapOf(dialogs()[0]).style.bottom).toBe('')
  })

  it('поле в фокусе докручивается в видимую часть, когда клавиатура выросла', async () => {
    mount(() => h(Sheet, { open: true, title: 'Кредит' }, () => h('input', { id: 'f' })))
    await nextTick()
    const input = document.getElementById('f') as HTMLInputElement
    let scrolled = 0
    input.scrollIntoView = () => void scrolled++
    input.focus()
    vv.set(window.innerHeight - 300)
    await nextTick()
    await nextTick()
    expect(scrolled).toBe(1)
  })

  it('закрытый лист слушатель снимает; два листа — у каждого свой, оба над клавиатурой', async () => {
    const s = reactive({ a: true, b: false })
    mount(() =>
      h('div', [
        h(Sheet, { open: s.a, title: 'Окно', onClose: () => (s.a = false) }, () => h('p', 'нижнее')),
        h(Sheet, { open: s.b, title: 'Лист', z: 60, onClose: () => (s.b = false) }, () => h('p', 'верхнее')),
      ]),
    )
    await nextTick()
    const one = vv.listeners
    expect(one).toBeGreaterThan(0)
    s.b = true
    await nextTick()
    expect(vv.listeners).toBe(one * 2)
    vv.set(window.innerHeight - 250)
    await nextTick()
    expect(dialogs().map((d) => wrapOf(d).style.bottom)).toEqual(['250px', '250px'])

    s.b = false
    await nextTick()
    expect(vv.listeners).toBe(one)
    s.a = false
    await nextTick()
    expect(vv.listeners).toBe(0)
  })

  it('без visualViewport (старый браузер) — лист как раньше', async () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    mount(() => h(Sheet, { open: true, title: 'Кредит' }, () => h('p', 'тело')))
    await nextTick()
    expect(wrapOf(dialogs()[0]).style.bottom).toBe('')
  })
})
