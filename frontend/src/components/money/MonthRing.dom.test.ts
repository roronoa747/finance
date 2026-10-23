// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, type App } from 'vue'
import MonthRing from './MonthRing.vue'

/**
 * Х-23 (владелец 2026-10-23, Блок 5 «Фидбек»): кольцо «Месяца» без дохода рисует доли из сумм разделов — база дуг
 * равна их сумме, а не доходу; при всех нулях — одна дорожка. С доходом — как было: доли из дохода, сверх него — обрезка.
 */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const R = 88
const C = 2 * Math.PI * R
const parts = (dues: number, spend: number, queue: number) => [
  { key: 'dues', amount: dues, color: '--s1' },
  { key: 'spend', amount: spend, color: '--s8' },
  { key: 'queue', amount: queue, color: '--s3' },
]

function mount(props: { parts: ReturnType<typeof parts>; total: number }) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(MonthRing, props)
  app.mount(root)
}
const arcs = () => [...document.querySelectorAll<SVGElement>('[data-month-ring] circle[data-part]')]
/** Длина дуги из `stroke-dasharray` («len−GAP C») плюс зазор 2. */
const len = (el: SVGElement) => Number(el.getAttribute('stroke-dasharray')!.split(' ')[0]) + 2

describe('Х-23: кольцо без дохода', () => {
  it('доход 0, суммы разделов есть — дуги долями из их суммы, кольцо целиком', () => {
    mount({ parts: parts(100_000, 50_000, 50_000), total: 0 })
    const a = arcs()
    expect(a.map((el) => el.dataset.part)).toEqual(['dues', 'spend', 'queue'])
    expect(len(a[0])).toBeCloseTo(C / 2, 6)
    expect(len(a[1])).toBeCloseTo(C / 4, 6)
    expect(len(a[2])).toBeCloseTo(C / 4, 6)
    expect(a[1].getAttribute('stroke-dashoffset')).toBe(String(-C / 2))
  })

  it('доход 0 и суммы 0 — только дорожка', () => {
    mount({ parts: parts(0, 0, 0), total: 0 })
    expect(arcs()).toEqual([])
    expect(document.querySelectorAll('[data-month-ring] circle').length).toBe(1)
  })

  it('доход есть — доли из дохода, не из суммы разделов; сверх дохода — обрезка', () => {
    mount({ parts: parts(100_000, 50_000, 50_000), total: 400_000 })
    const a = arcs()
    expect(len(a[0])).toBeCloseTo(C / 4, 6)
    expect(len(a[1])).toBeCloseTo(C / 8, 6)
    app?.unmount()
    document.body.innerHTML = ''
    mount({ parts: parts(300_000, 300_000, 0), total: 400_000 })
    const b = arcs()
    expect(b.map((el) => el.dataset.part)).toEqual(['dues', 'spend'])
    expect(len(b[0]) + len(b[1])).toBeCloseTo(C, 6)
  })
})
