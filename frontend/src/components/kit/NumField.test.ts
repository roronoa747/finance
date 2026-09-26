import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { clean } from '@/lib/num'
import NumField from './NumField.vue'

/**
 * PV-23 п. 7: буква в числовом поле не остаётся. `clean` её выбрасывает, модель прежняя —
 * Vue поле не перерисовывает, поэтому обработчик сам выставляет очищенное значение.
 */
async function handler(modelValue: string, kind: 'int' | 'money' | 'rate') {
  const emitted: string[] = []
  let onInput: ((e: Event) => void) | undefined
  const grab = { created(this: any) { if ('onInput' in this.$.setupState) onInput = this.$.setupState.onInput } }
  const app = createSSRApp({ render: () => h(NumField, { modelValue, kind, 'onUpdate:modelValue': (v: string) => emitted.push(v) }) })
  app.mixin(grab)
  const html = await renderToString(app)
  return { html, emitted, onInput: onInput! }
}

describe('NumField: мусор не остаётся в поле', () => {
  it('clean("12a", int, "12") — то же «12»: модель бы не изменилась', () => {
    expect(clean('12a', 'int', '12')).toBe('12')
  })

  it('набрана буква: поле получает «12», в модель уходит «12»', async () => {
    const { html, emitted, onInput } = await handler('12', 'int')
    expect(html).toContain('value="12"')
    const el = { value: '12a', selectionStart: 3 }
    onInput({ target: el } as unknown as Event)
    expect(el.value).toBe('12')
    expect(emitted).toEqual(['12'])
  })

  it('сумма с разрядами: «1 000x» → «1 000»; ставка «14,5%» → «14,5»', async () => {
    const money = await handler('1 000', 'money')
    const m = { value: '1 000x', selectionStart: 6 }
    money.onInput({ target: m } as unknown as Event)
    expect(m.value).toBe('1 000')

    const rate = await handler('14,5', 'rate')
    const r = { value: '14,5%', selectionStart: 5 }
    rate.onInput({ target: r } as unknown as Event)
    expect(r.value).toBe('14,5')
  })
})
