// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import type { NumKind } from '@/lib/num'
import type { Currency } from '@/types/finance'
import NumField from './NumField.vue'

/**
 * Набор по символу, как с клавиатуры (возврат приёмки ML-09): каждый знак вставляется у курсора, поле
 * перерисовывается и ставит курсор само. Точка с клавиатуры `decimal` — та же запятая: «9.99» → «9,99»,
 * а не «999,» (курсор вставал перед запятой, и цифры уходили в целую часть).
 */

let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

async function field(props: { kind?: NumKind; currency?: Currency }) {
  const model = ref('')
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(NumField, { ...props, modelValue: model.value, 'onUpdate:modelValue': (v: string) => (model.value = v) }) })
  app.mount(root)
  const input = root.querySelector('input') as HTMLInputElement
  input.focus()
  return { input, model }
}

async function typeChars(input: HTMLInputElement, chars: string) {
  for (const ch of chars) {
    const at = input.selectionStart ?? input.value.length
    input.value = input.value.slice(0, at) + ch + input.value.slice(at)
    input.setSelectionRange(at + 1, at + 1)
    input.dispatchEvent(new Event('input'))
    for (let i = 0; i < 3; i++) await nextTick()
  }
}

describe('NumField: набор по символу с точкой', () => {
  it('$: «9.99» → «9,99», подсказка «Округлим до 10 $»', async () => {
    const { input, model } = await field({ currency: 'USD' })
    await typeChars(input, '9.99')
    expect(input.value).toBe('9,99')
    expect(model.value).toBe('9,99')
    expect(document.body.textContent).toContain('Округлим до 10 $')
  })

  it('$: «1250.5» → «1 250,5»; «12.3» → «12,3»; запятая — как раньше', async () => {
    const a = await field({ currency: 'USD' })
    await typeChars(a.input, '1250.5')
    expect(a.input.value).toBe('1 250,5')
    app!.unmount()
    const b = await field({ currency: 'USD' })
    await typeChars(b.input, '12.3')
    expect(b.input.value).toBe('12,3')
    app!.unmount()
    const c = await field({ currency: 'USD' })
    await typeChars(c.input, '9,99')
    expect(c.input.value).toBe('9,99')
  })

  it('ставка: «36.5» → «36,5» (было «365,» и в main до блока)', async () => {
    const { input } = await field({ kind: 'rate' })
    await typeChars(input, '36.5')
    expect(input.value).toBe('36,5')
  })

  it('тенге: точка не пишется и курсор не сбивается — «12.3» → «123»', async () => {
    const { input } = await field({ kind: 'money' })
    await typeChars(input, '12.3')
    expect(input.value).toBe('123')
  })
})
