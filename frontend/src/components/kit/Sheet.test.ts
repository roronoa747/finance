import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Sheet from './Sheet.vue'

describe('PV-09: kit/Sheet — окно на ките (SSR)', () => {
  const render = (props: { open: boolean; title: string; z?: number }) =>
    renderToString(
      createSSRApp({
        render: () =>
          h(Sheet, props, {
            mark: () => h('span', 'Сохранено'),
            default: () => h('p', 'Тело окна'),
            footer: () => h('b', 'Готово'),
          }),
      }),
    )

  it('открытое — заголовок, крестик, тело, подвал; диалог назван заголовком', async () => {
    const html = await render({ open: true, title: 'Кредит Kaspi' })
    expect(html).toContain('Кредит Kaspi')
    expect(html).toContain('aria-label="Закрыть"')
    expect(html).toContain('Тело окна')
    expect(html).toContain('Готово')
    expect(html).toContain('Сохранено')
    expect(html).toContain('role="dialog"')
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    // Имя окна и заголовок — только title; отметка стоит рядом, не внутри (ревью Н-5).
    expect(html).toMatch(new RegExp(`<h3 id="${id}"[^>]*>Кредит Kaspi</h3>`))
    expect(html.indexOf('Сохранено')).toBeGreaterThan(html.indexOf('</h3>'))
  })

  it('закрытое — ничего', async () => {
    const html = await render({ open: false, title: 'Кредит Kaspi' })
    expect(html).not.toContain('Кредит Kaspi')
    expect(html).not.toContain('Тело окна')
  })

  it('затемнение и тень — токены, не литеральный цвет; слой задаётся пропом z', async () => {
    const html = await render({ open: true, title: 'Лист', z: 60 })
    expect(html).toContain('bg-scrim')
    expect(html).toContain('shadow-lift')
    expect(html).not.toMatch(/bg-black|shadow-2xl/)
    expect(html).toContain('z-index:60')
    expect(await render({ open: true, title: 'Окно' })).toContain('z-index:50')
  })
})
