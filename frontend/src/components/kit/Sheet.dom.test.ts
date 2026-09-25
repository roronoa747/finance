// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import Sheet from './Sheet.vue'
import Row from './Row.vue'

/**
 * Поведение кита окон в DOM (ревью frontend Блока 2, Н-2): SSR-тесты видят только разметку,
 * обработчики клавиш, фона и фокуса запускаются лишь здесь.
 */

let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.mount(root)
}

function key(k: string, shift = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }))
}

function dialogs() {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
}

function scrimOf(dialog: HTMLElement) {
  return dialog.parentElement as HTMLElement
}

describe('Н-2: kit/Sheet в DOM', () => {
  it('два листа: Escape закрывает только верхний, второй Escape — нижний', async () => {
    const s = reactive({ a: true, b: false })
    mount(() =>
      h('div', [
        h(Sheet, { open: s.a, title: 'Окно', onClose: () => (s.a = false) }, () => h('p', 'нижнее')),
        h(Sheet, { open: s.b, title: 'Лист', z: 60, onClose: () => (s.b = false) }, () => h('p', 'верхнее')),
      ]),
    )
    await nextTick()
    s.b = true
    await nextTick()
    expect(dialogs()).toHaveLength(2)

    key('Escape')
    await nextTick()
    expect(s).toEqual({ a: true, b: false })
    expect(document.body.textContent).toContain('нижнее')
    expect(document.body.textContent).not.toContain('верхнее')

    key('Escape')
    await nextTick()
    expect(s).toEqual({ a: false, b: false })
    expect(dialogs()).toHaveLength(0)
  })

  it('Tab с последнего поля — на первое, Shift+Tab с первого — на последнее', async () => {
    mount(() =>
      h(Sheet, { open: true, title: 'Окно' }, () => [
        h('input', { id: 'one' }),
        h('input', { id: 'two' }),
        h('button', { id: 'three', type: 'button' }, 'Готово'),
      ]),
    )
    await nextTick()
    await nextTick()
    // Первый фокусируемый в окне — крестик «Закрыть».
    const close = document.querySelector<HTMLElement>('[aria-label="Закрыть"]')!
    const last = document.getElementById('three')!

    last.focus()
    key('Tab')
    expect(document.activeElement).toBe(close)

    key('Tab', true)
    expect(document.activeElement).toBe(last)

    // Внутри — Tab не перехватывается (браузер сам ведёт фокус дальше).
    document.getElementById('one')!.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('фон закрывает только нажатие, начатое на нём', async () => {
    const s = reactive({ open: true })
    mount(() => h(Sheet, { open: s.open, title: 'Окно', onClose: () => (s.open = false) }, () => h('input')))
    await nextTick()
    const dialog = dialogs()[0]
    const scrim = scrimOf(dialog)

    // Выделение начато в поле окна, отпущено за краем — click приходит на фон.
    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(s.open).toBe(true)

    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(s.open).toBe(false)
  })

  it('фокус — в окно при открытии и назад на кнопку, открывшую его, при закрытии', async () => {
    const s = reactive({ open: false })
    mount(() =>
      h('div', [
        h('button', { id: 'opener', type: 'button', onClick: () => (s.open = true) }, 'Открыть'),
        h(Sheet, { open: s.open, title: 'Окно', onClose: () => (s.open = false) }, () => h('p', 'тело')),
      ]),
    )
    const opener = document.getElementById('opener')!
    opener.focus()
    opener.click()
    await nextTick()
    await nextTick()
    expect(dialogs()[0].contains(document.activeElement)).toBe(true)

    key('Escape')
    await nextTick()
    expect(dialogs()).toHaveLength(0)
    expect(document.activeElement).toBe(opener)
  })

  // Критик Блока 4 паритета: поле пишет по уходу из него, а родитель на `close` убирает запись
  // окна — blur должен прийти, пока окно ещё открыто.
  it('Escape, крестик и фон: поле с фокусом получает blur до close', async () => {
    for (const how of ['escape', 'cross', 'scrim'] as const) {
      const s = reactive({ open: true })
      const seen: boolean[] = []
      mount(() =>
        h(Sheet, { open: s.open, title: 'Окно', onClose: () => (s.open = false) }, () =>
          h('input', { id: 'field', onBlur: () => seen.push(s.open) }),
        ),
      )
      await nextTick()
      document.getElementById('field')!.focus()
      if (how === 'escape') key('Escape')
      else if (how === 'cross') document.querySelector<HTMLElement>('[aria-label="Закрыть"]')!.click()
      else {
        const scrim = scrimOf(dialogs()[0])
        scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
      await nextTick()
      expect({ how, open: s.open, seen }).toEqual({ how, open: false, seen: [true] })
      app?.unmount()
      app = null
      document.body.innerHTML = ''
    }
  })
})

describe('Н-2: kit/Row в DOM', () => {
  function row() {
    const clicks: number[] = []
    mount(() => h(Row, { title: 'Kaspi', clickable: true, onClick: (e: MouseEvent) => clicks.push(e.detail) }))
    const btn = document.querySelector<HTMLElement>('button')!
    return { btn, clicks }
  }

  const down = (el: HTMLElement, x: number, y: number) =>
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }))
  const move = (el: HTMLElement, x: number, y: number) =>
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))

  it('свайп больше 8 px — клик мышью не проходит', () => {
    const { btn, clicks } = row()
    down(btn, 0, 0)
    move(btn, 0, 20)
    btn.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }))
    expect(clicks).toEqual([])
  })

  it('после свайпа нажатие с клавиатуры (detail 0) доходит', () => {
    const { btn, clicks } = row()
    down(btn, 0, 0)
    move(btn, 0, 20)
    btn.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }))
    expect(clicks).toEqual([0])
  })

  it('короткое движение (≤ 8 px) — обычный клик', () => {
    const { btn, clicks } = row()
    down(btn, 0, 0)
    move(btn, 3, 4)
    btn.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }))
    expect(clicks).toEqual([1])
  })
})
