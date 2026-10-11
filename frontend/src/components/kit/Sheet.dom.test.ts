// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('ворота Б17: экран за открытым листом не прокручивается', () => {
  it('два листа: экран заперт, пока открыт хоть один; закрыли оба — снова прокручивается', async () => {
    const s = reactive({ a: false, b: false })
    mount(() =>
      h('div', [
        h(Sheet, { open: s.a, title: 'Окно', onClose: () => (s.a = false) }, () => h('p', 'нижнее')),
        h(Sheet, { open: s.b, title: 'Лист', z: 60, onClose: () => (s.b = false) }, () => h('p', 'верхнее')),
      ]),
    )
    const locked = () => 'sheetOpen' in document.documentElement.dataset
    await nextTick()
    expect(locked()).toBe(false)
    s.a = true
    await nextTick()
    expect(locked()).toBe(true)
    s.b = true
    await nextTick()
    s.b = false
    await nextTick()
    expect(locked()).toBe(true)
    s.a = false
    await nextTick()
    expect(locked()).toBe(false)
  })
})

describe('PN-35: лист закрывается стягиванием вниз', () => {
  let wide = false
  let reduce = false

  beforeEach(() => {
    wide = false
    reduce = false
    // happy-dom — 1024 px (окно `sm:`), высоты нет: телефон и лист в 600 px задаём сами; время событий — фейковое.
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) => ({ matches: q.includes('min-width') ? wide : q.includes('reduced-motion') ? reduce : false, media: q }) as MediaQueryList,
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function tall(dialog: HTMLElement, h = 600) {
    Object.defineProperty(dialog, 'offsetHeight', { value: h, configurable: true })
    return dialog
  }

  function touch(el: HTMLElement, type: string, y: number, x = 0) {
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
    const end = type === 'touchend' || type === 'touchcancel'
    const ev = new TouchEvent(type, { touches: end ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    return ev
  }

  /** Палец ставят на `el`, ведут на `dy` (и `dx`) за `ms` четырьмя шагами и отпускают; лист доезжает. */
  async function swipe(el: HTMLElement, dy: number, { ms = 400, dx = 0, end = 'touchend' } = {}) {
    touch(el, 'touchstart', 100)
    const moves: TouchEvent[] = []
    for (let k = 1; k <= 4; k++) {
      vi.advanceTimersByTime(ms / 4)
      moves.push(touch(el, 'touchmove', 100 + (dy * k) / 4, (dx * k) / 4))
    }
    await nextTick()
    const during = { transform: dialogs().at(-1)!.style.transform }
    touch(el, end, 100 + dy)
    vi.advanceTimersByTime(200)
    await nextTick()
    return { moves, during }
  }

  function one() {
    const s = reactive({ open: true })
    const seen: boolean[] = []
    mount(() =>
      h(Sheet, { open: s.open, title: 'Окно', onClose: () => (s.open = false) }, () =>
        h('input', { id: 'field', onBlur: () => seen.push(s.open) }),
      ),
    )
    return { s, seen }
  }

  it('стянул за порог — закрыт через close(): поле с фокусом получает blur до close; во время жеста лист едет за пальцем, затемнение светлеет', async () => {
    const { s, seen } = one()
    await nextTick()
    const dialog = tall(dialogs()[0])
    document.getElementById('field')!.focus()

    touch(dialog, 'touchstart', 100)
    vi.advanceTimersByTime(100)
    const move = touch(dialog, 'touchmove', 250)
    await nextTick()
    expect(move.defaultPrevented).toBe(true)
    expect(dialog.style.transform).toBe('translateY(150px)')
    expect(Number((scrimOf(dialog).firstElementChild as HTMLElement).style.opacity)).toBeCloseTo(0.75)
    expect(s.open).toBe(true)

    touch(dialog, 'touchend', 250)
    vi.advanceTimersByTime(200)
    await nextTick()
    expect({ open: s.open, seen }).toEqual({ open: false, seen: [true] })
  })

  it('недотянул медленно — открыт, лист вернулся на место без сдвига', async () => {
    const { s } = one()
    await nextTick()
    const dialog = tall(dialogs()[0])
    const { during } = await swipe(dialog, 80)
    expect(during.transform).toBe('translateY(80px)')
    expect(s.open).toBe(true)
    expect(dialog.style.transform).toBe('')
  })

  it('короткий лист: порог — 30 % высоты (лист 200 px закрывается с 70 px)', async () => {
    const { s } = one()
    await nextTick()
    await swipe(tall(dialogs()[0], 200), 70)
    expect(s.open).toBe(false)
  })

  it('быстрое смахивание закрывает и с короткого хода', async () => {
    const { s } = one()
    await nextTick()
    await swipe(tall(dialogs()[0]), 60, { ms: 40 })
    expect(s.open).toBe(false)
  })

  it('содержимое прокручено (scrollTop > 0) — жест прокручивает, лист не трогается', async () => {
    const { s } = one()
    await nextTick()
    const dialog = tall(dialogs()[0])
    Object.defineProperty(dialog, 'scrollTop', { value: 50, configurable: true })
    const { moves, during } = await swipe(dialog, 300)
    expect(moves.some((m) => m.defaultPrevented)).toBe(false)
    expect(during.transform).toBe('')
    expect(s.open).toBe(true)
  })

  it('вверх и вбок — не трогает; touchcancel — назад, не закрывает', async () => {
    const { s } = one()
    await nextTick()
    const dialog = tall(dialogs()[0])
    expect((await swipe(dialog, -300)).moves.some((m) => m.defaultPrevented)).toBe(false)
    expect((await swipe(dialog, 100, { dx: 200 })).moves.some((m) => m.defaultPrevented)).toBe(false)
    await swipe(dialog, 300, { end: 'touchcancel' })
    expect(s.open).toBe(true)
    expect(dialog.style.transform).toBe('')
  })

  it('выделение текста в поле — жест не тянет лист', async () => {
    const { s } = one()
    await nextTick()
    const field = document.getElementById('field') as HTMLInputElement
    field.value = 'Kaspi Gold'
    field.setSelectionRange(0, 5)
    await swipe(field, 300)
    expect(s.open).toBe(true)
  })

  it('лист поверх листа: тянется только верхний, нижний остаётся', async () => {
    const s = reactive({ a: true, b: true })
    mount(() =>
      h('div', [
        h(Sheet, { open: s.a, title: 'Окно', onClose: () => (s.a = false) }, () => h('p', 'нижнее')),
        h(Sheet, { open: s.b, title: 'Лист', z: 60, onClose: () => (s.b = false) }, () => h('p', 'верхнее')),
      ]),
    )
    await nextTick()
    const [low, top] = dialogs().map((d) => tall(d))
    await swipe(low, 300)
    expect(s).toEqual({ a: true, b: true })
    await swipe(top, 300)
    expect(s).toEqual({ a: true, b: false })
  })

  it('окно по центру (sm:) не тянется', async () => {
    wide = true
    const { s } = one()
    await nextTick()
    await swipe(tall(dialogs()[0]), 300)
    expect(s.open).toBe(true)
  })

  it('«Уменьшить движение» — закрывается сразу, без доезда', async () => {
    reduce = true
    const { s } = one()
    await nextTick()
    const dialog = tall(dialogs()[0])
    touch(dialog, 'touchstart', 100)
    vi.advanceTimersByTime(300)
    touch(dialog, 'touchmove', 400)
    touch(dialog, 'touchend', 400)
    vi.advanceTimersByTime(0)
    await nextTick()
    expect(s.open).toBe(false)
  })

  it('ручка-полоска у листа — токен line-strong, на широком экране скрыта', async () => {
    one()
    await nextTick()
    const grip = dialogs()[0].querySelector<HTMLElement>('.bg-line-strong')!
    expect(grip.getAttribute('aria-hidden')).toBe('true')
    expect(grip.className).toContain('sm:hidden')
  })
})
