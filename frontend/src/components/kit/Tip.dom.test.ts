// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { TIPS_SEEN_KEY, readTipsSeen } from '@/lib/storage'
import Tip from './Tip.vue'
import Sheet from './Sheet.vue'
import Toast from './Toast.vue'

/**
 * Подсказка у предмета (бэклог «первый» FR-05) в DOM: показ по «видел», «Понятно» и нажатие предмета, одна за раз,
 * не поверх листа и тоста.
 */

let app: App | null = null

beforeEach(() => localStorage.clear())
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

function mount(render: () => ReturnType<typeof h> | ReturnType<typeof h>[]) {
  app?.unmount()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.mount(root)
}

const tips = () => [...document.querySelectorAll<HTMLElement>('[data-tip]')].map((t) => t.dataset.tip)
const ok = () => document.querySelector<HTMLButtonElement>('[data-tip-ok]')!
const subject = (id: string) => document.querySelector<HTMLButtonElement>(`[data-subject="${id}"]`)!

/** Предмет — кнопка; счётчик нажатий показывает, что предмет работает как обычно. */
function tip(id: string, presses = ref(0), above = false) {
  return h(Tip, { id, text: `Подсказка ${id}`, above }, () => h('button', { 'data-subject': id, onClick: () => presses.value++ }, id))
}

describe('kit/Tip — подсказка у предмета', () => {
  it('новый id — пузырь со стрелкой и «Понятно»; «Понятно» — скрыт и отмечен, после перемонтирования не показан', async () => {
    mount(() => tip('tab-dreams'))
    await nextTick()
    expect(tips()).toEqual(['tab-dreams'])
    expect(document.querySelector('[data-tip]')!.textContent).toContain('Подсказка tab-dreams')
    ok().click()
    await nextTick()
    expect(tips()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-dreams'])

    mount(() => tip('tab-dreams'))
    await nextTick()
    expect(tips()).toEqual([])
  })

  it('нажатие предмета работает как обычно и закрывает пузырь с отметкой', async () => {
    const presses = ref(0)
    mount(() => tip('tab-money', presses))
    await nextTick()
    subject('tab-money').click()
    await nextTick()
    expect(presses.value).toBe(1)
    expect(tips()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-money'])
  })

  it('«Понятно» не нажимает предмет', async () => {
    const presses = ref(0)
    mount(() => tip('tab-week', presses))
    await nextTick()
    ok().click()
    await nextTick()
    expect(presses.value).toBe(0)
  })

  it('два на экране — виден один (первый); после «Понятно» первого — второй; нажатие ждущего предмета его не отмечает', async () => {
    mount(() => [tip('tab-dreams'), tip('tab-month')])
    await nextTick()
    expect(tips()).toEqual(['tab-dreams'])
    subject('tab-month').click()
    await nextTick()
    expect(readTipsSeen()).toEqual([])
    expect(tips()).toEqual(['tab-dreams'])
    ok().click()
    await nextTick()
    expect(tips()).toEqual(['tab-month'])
    ok().click()
    await nextTick()
    expect(tips()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-dreams', 'tab-month'])
  })

  it('первый уже увиден — показывается следующий; снятый с экрана освобождает очередь', async () => {
    localStorage.setItem(TIPS_SEEN_KEY, JSON.stringify(['tab-dreams']))
    const first = ref(true)
    mount(() => [first.value ? tip('tab-week') : null, tip('tab-month')].filter(Boolean) as ReturnType<typeof h>[])
    await nextTick()
    expect(tips()).toEqual(['tab-week'])
    first.value = false
    await nextTick()
    expect(tips()).toEqual(['tab-month'])
  })

  it('открыт лист — пузыря нет; лист закрыли — пузырь на месте', async () => {
    const open = ref(true)
    mount(() => [tip('tab-dreams'), h(Sheet, { open: open.value, title: 'Лист', onClose: () => (open.value = false) }, () => 'внутри')])
    await nextTick()
    expect(tips()).toEqual([])
    open.value = false
    await nextTick()
    expect(tips()).toEqual(['tab-dreams'])
    open.value = true
    await nextTick()
    expect(tips()).toEqual([])
  })

  it('виден тост — пузыря нет; тост погас — пузырь на месте', async () => {
    const note = ref<string | null>('Сохранено')
    mount(() => [tip('tab-month'), note.value ? h(Toast, null, () => note.value) : null].filter(Boolean) as ReturnType<typeof h>[])
    await nextTick()
    expect(tips()).toEqual([])
    note.value = null
    await nextTick()
    expect(tips()).toEqual(['tab-month'])
  })

  it('`above` — пузырь над предметом (первым в обёртке по порядку)', async () => {
    mount(() => tip('tab-week', ref(0), true))
    await nextTick()
    const bubble = document.querySelector('[data-tip]')!
    expect(bubble.className).toContain('order-first')
  })
})
