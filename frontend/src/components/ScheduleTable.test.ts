import { describe, it, expect } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { money } from '@/lib/money'
import type { ScheduleRow } from '@/lib/finance'
import ScheduleTable from './ScheduleTable.vue'

describe('FG-16: ScheduleTable — «График платежей» с валютой у каждой суммы (Р-12, SSR)', () => {
  const rows: ScheduleRow[] = [
    { period: '2026-10', day: 10, amount: 214_400, body: 8_150, interest: 206_250, extra: 0, left: 14_991_850, paid: true },
    { period: '2026-11', day: 10, amount: 214_400, body: 8_262, interest: 206_138, extra: 500_000, left: 14_483_588, paid: false },
  ]
  const render = (extraLabel?: string) => renderToString(createSSRApp(ScheduleTable, { rows, ...(extraLabel ? { extraLabel } : {}) }))
  const cells = (html: string) => [...html.matchAll(/<span class="text-ink(?:-2)?">([^<]*)<\/span>/g)].map((m) => m[1].trim())

  it('платёж, в долг, банку, остаток и досрочка — money(n)', async () => {
    const html = await render()
    expect(cells(html)).toEqual([
      'Платёж', 'В долг', 'Банку', 'Остаток',
      money(214_400), money(8_150), money(206_250), money(14_991_850),
      money(214_400), money(8_262), money(206_138), money(14_483_588),
    ])
    expect(html).toMatch(new RegExp(`досрочка ${money(500_000)}\\s*</span>`))
  })

  it('оплаченный месяц помечен, своя подпись досрочки', async () => {
    const html = await render('план')
    expect(html.match(/aria-label="оплачен"/g)).toHaveLength(1)
    expect(html).toContain(`план ${money(500_000)}`)
  })
})
