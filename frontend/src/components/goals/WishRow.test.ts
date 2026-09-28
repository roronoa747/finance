import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { WishItem } from '@/types/finance'
import WishRow from './WishRow.vue'

/** Точка автора в строке желания (Н-12): цвет участника — через `personColor`, у третьего слота — `--ink-3`. */
async function render(by: WishItem['by']) {
  const wish: WishItem = { id: 'w1', name: 'Наушники', price: 45_000, by, addedOn: '2026-09-10', bought: false, updatedAt: '2026-09-10T00:00:00.000Z' }
  const app = createSSRApp({ render: () => h(WishRow, { wish, src: null, canEdit: false, meta: 'Гость · 10 сентября' }) })
  return renderToString(app)
}

describe('WishRow — точка автора', () => {
  it('автор c — var(--ink-3), несуществующего var(--pc) нет; a — var(--pa)', async () => {
    const c = await render('c')
    expect(c).toContain('background:var(--ink-3)')
    expect(c).not.toContain('var(--pc)')
    expect(await render('a')).toContain('background:var(--pa)')
  })
})
