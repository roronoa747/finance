import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia } from 'pinia'
import type { WishItem } from '@/types/finance'
import { money } from '@/lib/money'
import WishRow from './WishRow.vue'

/** Строка желания списком (пачка 2 «Figma», 90:19, FG-22): строка 80, фото 56, без подписи «кто · когда». */
const wish = (extra: Partial<WishItem> = {}): WishItem => ({
  id: 'w1', name: 'Наушники', price: 45_000, by: 'a', addedOn: '2026-09-10', bought: false, updatedAt: '2026-09-10T00:00:00.000Z', photoId: 'ph', ...extra,
})

async function render(props: { wish: WishItem; canEdit: boolean; bought?: boolean }) {
  const app = createSSRApp({ render: () => h(WishRow, { src: 'blob:x', ...props }) })
  app.use(createPinia())
  return renderToString(app)
}

describe('WishRow — строка 80 (FG-22)', () => {
  it('участник: галочка, фото 56, название 16, цена справа; точки автора и подписи нет', async () => {
    const html = await render({ wish: wish(), canEdit: true })
    expect(html).toContain('aria-label="Отметить купленным"')
    expect(html).toContain('size-14')
    expect(html).toContain('text-[16px]')
    expect(html).not.toContain('var(--pa)')
    expect(html).not.toContain('сентября')
    expect(html.indexOf('Наушники')).toBeLessThan(html.indexOf(money(45_000)))
    expect(html).toContain(`>${money(45_000)}</span>`)
    // `/ux`: порядок макета 90:19 — фото у края, галочка у названия.
    expect(html.indexOf('data-photo')).toBeLessThan(html.indexOf('aria-label="Отметить купленным"'))
    expect(html.indexOf('aria-label="Отметить купленным"')).toBeLessThan(html.indexOf('Наушники'))
  })

  it('купленное — зачёркнуто, «купили», без даты; viewer — без галочки', async () => {
    const html = await render({ wish: wish({ bought: true, boughtOn: '2026-09-20T00:00:00.000Z' }), canEdit: false, bought: true })
    expect(html).toContain('line-through')
    expect(html).toContain('купили')
    expect(html).not.toContain('сентября')
    expect(html).not.toContain('Отметить купленным')
    expect(html).not.toContain('Вернуть в список')
  })

  it('без фото — плашка 56 со значком, а не пустое место', async () => {
    const html = await render({ wish: wish({ photoId: undefined }), canEdit: true })
    expect(html).toMatch(/size-14[^"]*"[^>]*data-photo/)
    expect(html).toContain('<svg')
  })
})
