// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import Hint from './Hint.vue'

/** PV-23 п. 6: окно пояснения закреплено на экране — закрывается прокруткой, нажатием мимо, Escape. */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

async function mountHint() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(Hint, null, () => 'ГЭСВ — из договора') })
  app.mount(root)
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Пояснение"]')!
  const note = () => document.querySelector<HTMLElement>('[role="note"]')
  const open = async () => {
    button.click()
    await nextTick()
  }
  return { button, note, open }
}

describe('Hint в DOM', () => {
  it('открывается fixed с зажатыми координатами; прокрутка любой области закрывает', async () => {
    const { button, note, open } = await mountHint()
    await open()
    expect(note()?.style.left).toMatch(/px$/)
    expect(note()?.style.width).toMatch(/px$/)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // Прокручивается <main> оболочки, а не окно: слушатель — на захвате.
    const main = document.createElement('main')
    document.body.appendChild(main)
    main.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(note()).toBeNull()
  })

  it('нажатие мимо и Escape закрывают, нажатие по самому пояснению — нет', async () => {
    const { note, open } = await mountHint()
    await open()
    note()!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(note()).not.toBeNull()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await nextTick()
    expect(note()).toBeNull()

    await open()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(note()).toBeNull()
  })
})
