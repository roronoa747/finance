import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Select from './Select.vue'

describe('PV-09: kit/Select (SSR)', () => {
  type Props = { modelValue: string; options?: { value: string; label: string }[]; disabled?: boolean }
  const render = (props: Props, slot?: () => ReturnType<typeof h>[]) =>
    renderToString(createSSRApp({ render: () => h(Select, props, slot ? { default: slot } : undefined) }))

  it('варианты из options, выбранное — по модели', async () => {
    const html = await render({
      modelValue: '2026-11',
      options: [
        { value: '2026-10', label: 'Октябрь 2026' },
        { value: '2026-11', label: 'Ноябрь 2026' },
      ],
    })
    expect(html).toContain('Октябрь 2026')
    expect(html).toContain('Ноябрь 2026')
    expect(html).toMatch(/<option value="2026-11" selected>/)
    expect(html).not.toMatch(/<option value="2026-10" selected>/)
    expect(html).toContain('bg-surface-2')
  })

  it('свои варианты в слоте; disabled', async () => {
    const html = await render({ modelValue: '', disabled: true }, () => [
      h('option', { value: '' }, 'Выберите счёт…'),
      h('option', { value: 'none' }, 'Не списывать — только отметить'),
    ])
    expect(html).toContain('Не списывать — только отметить')
    expect(html).toMatch(/<select[^>]* disabled/)
  })
})
