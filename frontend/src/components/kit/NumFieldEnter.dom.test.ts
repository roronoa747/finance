// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import NumField from './NumField.vue'
import NumFieldBlur from './NumFieldBlur.vue'

/** F2-02: «Готово» на цифровой клавиатуре — Enter уводит фокус, значение пишется по blur, форма не уходит. */

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
  return root.querySelector('input') as HTMLInputElement
}

function enter(input: HTMLInputElement) {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  input.dispatchEvent(ev)
  return ev
}

describe('F2-02: NumField и клавиша «Готово»', () => {
  it('у поля enterkeyhint="done"; Enter снимает фокус и даёт blur', async () => {
    const model = ref('')
    let blurs = 0
    const input = mount(() =>
      h(NumField, { modelValue: model.value, 'onUpdate:modelValue': (v: string) => (model.value = v), onBlur: () => blurs++ }),
    )
    expect(input.getAttribute('enterkeyhint')).toBe('done')
    input.focus()
    expect(document.activeElement).toBe(input)
    const ev = enter(input)
    await nextTick()
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(input)
    expect(blurs).toBe(1)
  })

  it('Enter внутри <form> не отправляет её', async () => {
    let submits = 0
    const input = mount(() =>
      h('form', { onSubmit: (e: Event) => (e.preventDefault(), submits++) }, [h(NumField, { modelValue: '5' }), h('button', { type: 'submit' }, 'ok')]),
    )
    input.focus()
    const ev = enter(input)
    await nextTick()
    // Браузер шлёт неявный submit только по не отменённому Enter.
    expect(ev.defaultPrevented).toBe(true)
    expect(submits).toBe(0)
  })

  it('NumFieldBlur: набрал и Enter — commit один раз с набранным значением', async () => {
    const commits: string[] = []
    const input = mount(() => h(NumFieldBlur, { initial: '100', onCommit: (v: string) => commits.push(v) }))
    input.focus()
    input.value = '2500'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    enter(input)
    await nextTick()
    expect(document.activeElement).not.toBe(input)
    expect(commits.map((c) => c.replace(/\s/g, ''))).toEqual(['2500'])
  })
})
