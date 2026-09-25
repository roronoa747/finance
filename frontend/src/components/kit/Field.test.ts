import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Field from './Field.vue'

describe('PV-09: kit/Field — подпись поля и группы кнопок (SSR)', () => {
  const render = (props: { label: string; group?: boolean }) =>
    renderToString(
      createSSRApp({
        render: () =>
          h(Field, props, { default: () => [h('button', 'Каждый месяц'), h('button', 'Разово')] }),
      }),
    )

  it('поле — внутри <label>', async () => {
    const html = await render({ label: 'Сумма, ₸' })
    expect(html).toMatch(/^<label/)
    expect(html).toContain('Сумма, ₸')
    expect(html).not.toContain('role="group"')
  })

  it('группа кнопок — не <label>, а role="group" с именем подписи', async () => {
    const html = await render({ label: 'Как вносите', group: true })
    expect(html).not.toContain('<label')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Как вносите"')
    expect(html).toContain('Разово')
  })
})
