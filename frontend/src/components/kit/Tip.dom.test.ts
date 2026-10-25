// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { TIPS_SEEN_KEY, readTipsSeen } from '@/lib/storage'
import Tip from './Tip.vue'
import Sheet from './Sheet.vue'
import Toast from './Toast.vue'
import { TIP_SEEN_MS, holdTips } from './tips'

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

  it('предмет, сразу открывший лист, — пузырь всё равно отмечен (настоящее касание перерисовывает экран до всплытия)', async () => {
    // Возврат приёмки Блока 2: раздел «Недели» открывает лист; в браузере микрозадачи между обработчиками успевают
    // открыть его до всплытия клика к обёртке. Здесь лист «открывается» прямо в обработчике предмета.
    let release: (() => void) | null = null
    mount(() => h(Tip, { id: 'tab-week', text: 'Подсказка' }, () => h('button', { 'data-subject': 'tab-week', onClick: () => (release = holdTips()) }, 'раздел')))
    await nextTick()
    try {
      subject('tab-week').click()
      await nextTick()
      expect(readTipsSeen()).toEqual(['tab-week'])
    } finally {
      // Удержание очереди общее для файла — снять, даже если проверка упала.
      ;(release as (() => void) | null)?.()
    }
    await nextTick()
    expect(tips(), 'лист закрыт — пузырь не вернулся').toEqual([])
  })

  it('нажатие в самом пузыре (текст) — не предмет: отметки нет', async () => {
    mount(() => tip('tab-money'))
    await nextTick()
    document.querySelector<HTMLElement>('[data-tip] p')!.click()
    await nextTick()
    expect(tips()).toEqual(['tab-money'])
    expect(readTipsSeen()).toEqual([])
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

  it('`wait` (предмета ещё нет) — пузыря нет, очередь не держит, нажатие не отмечает; предмет появился — пузырь', async () => {
    const empty = ref(true)
    mount(() => [h(Tip, { id: 'tab-week', text: 'Подсказка tab-week', wait: empty.value }, () => h('button', { 'data-subject': 'tab-week' }, 'tab-week')), tip('tab-month')])
    await nextTick()
    expect(tips()).toEqual(['tab-month'])
    subject('tab-week').click()
    ok().click()
    await nextTick()
    expect(readTipsSeen()).toEqual(['tab-month'])
    expect(tips()).toEqual([])
    empty.value = false
    await nextTick()
    expect(tips()).toEqual(['tab-week'])
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

  describe('F2-Х3 (FG-11): показанная 4 с — увиденная', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
    afterEach(() => vi.useRealTimers())

    it('4 с на экране — отмечен без «Понятно» и не пропадает на глазах; после перемонтирования не показан', async () => {
      mount(() => [tip('tab-money'), tip('tab-week')])
      await nextTick()
      expect(tips()).toEqual(['tab-money'])
      vi.advanceTimersByTime(TIP_SEEN_MS)
      await nextTick()
      expect(readTipsSeen()).toEqual(['tab-money'])
      // Критик Блока 1: пузырь стоит, пока экран открыт, — очередь не подменяет его следующим.
      expect(tips()).toEqual(['tab-money'])
      // Лист поверх и обратно — тот же пузырь на месте; «Понятно» — уходит, следующий в очереди.
      const release = holdTips()
      await nextTick()
      expect(tips()).toEqual([])
      release()
      await nextTick()
      expect(tips()).toEqual(['tab-money'])
      ;(document.querySelector('[data-tip-ok]') as HTMLElement).click()
      await nextTick()
      expect(tips()).toEqual(['tab-week'])
      mount(() => tip('tab-money'))
      await nextTick()
      expect(tips()).toEqual([])
    })

    it('3 с и ушёл с экрана — не отмечен; под листом и пока предмета нет (wait) таймер не идёт', async () => {
      mount(() => tip('tab-week'))
      await nextTick()
      vi.advanceTimersByTime(3_000)
      app!.unmount()
      app = null
      vi.advanceTimersByTime(5_000)
      expect(readTipsSeen()).toEqual([])

      const release = holdTips()
      mount(() => tip('tab-week'))
      await nextTick()
      expect(tips()).toEqual([])
      vi.advanceTimersByTime(10_000)
      expect(readTipsSeen()).toEqual([])
      release()
      await nextTick()
      expect(tips()).toEqual(['tab-week'])

      const waiting = ref(true)
      mount(() => h(Tip, { id: 'tab-month', text: 'Подсказка', wait: waiting.value }, () => h('span', 'пусто')))
      await nextTick()
      vi.advanceTimersByTime(10_000)
      expect(readTipsSeen()).toEqual([])
    })
  })
})
