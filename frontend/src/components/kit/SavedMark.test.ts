import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SavedMark from './SavedMark.vue'

describe('kit/SavedMark — «Сохранено» слышно и не сидит в тексте (ревью Н-5)', () => {
  const render = (on: boolean) => renderToString(createSSRApp({ render: () => h(SavedMark, { on }) }))

  it('погашена — текста нет, живая область есть (озвучка ждёт появления текста)', async () => {
    const html = await render(false)
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('Сохранено')
  })

  it('горит — текст внутри живой области', async () => {
    const html = await render(true)
    expect(html).toMatch(/aria-live="polite"[^>]*>.*Сохранено/s)
  })
})
