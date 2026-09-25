import { describe, it, expect } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { money, plain } from '@/lib/money'
import { simulateStrategy, strategyGain, strategyInputs } from '@/lib/finance'
import type { Credit, Goal, Obligation } from '@/types/finance'
import StrategyCompare from './StrategyCompare.vue'

describe('PV-02: StrategyCompare — «копить или гасить» как в React (SSR)', () => {
  const T0 = '2026-09-01T00:00:00Z'
  const KEY = '2026-09'
  const goal = (id: string, name: string, monthly: number, have: number): Goal => ({
    id, name, need: 5_000_000, seed: have, have, monthly, hue: 'teal', planPct: 0, movements: [], updatedAt: T0,
  })
  const credit = (id: string, name: string, principal: number, annualRate: number, payment: number): Credit => ({
    id, name, note: '', principal, annualRate, payment, day: 15, updatedAt: T0,
  })
  const rent: Obligation = {
    id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0,
  }
  const goals = [goal('flat', 'Квартира', 100_000, 600_000), goal('baby', 'Декрет', 50_000, 400_000)]
  const credits = [credit('card', 'Кредитка', 400_000, 0.33, 25_000), credit('bank', 'Банк', 1_000_000, 0.18, 91_680)]

  type Initial = { months?: 12 | 24 | 36; kept?: string[]; cushion?: boolean; useSaved?: boolean }
  const render = (p: { credits?: Credit[]; goals?: Goal[]; initial?: Initial } = {}) =>
    renderToString(
      createSSRApp(StrategyCompare, {
        credits: p.credits ?? credits,
        goals: p.goals ?? goals,
        obligations: [rent],
        monthKey: KEY,
        initial: p.initial,
      }),
    )

  /** Те же входы, что у компонента, — независимый прогон функций. */
  function expected(p: { credits?: Credit[]; goals?: Goal[] } & Required<Initial>) {
    const x = strategyInputs({
      credits: p.credits ?? credits, goals: p.goals ?? goals, obligations: [rent], key: KEY,
      kept: p.kept, cushion: p.cushion, useSaved: p.useSaved,
    })
    const a = simulateStrategy({ debts: x.debts, saving: x.saving, keep: x.saving, payDebts: false, start: x.start, months: p.months })
    const b = simulateStrategy({
      debts: x.debts, saving: x.saving, keep: x.keep, payDebts: true, start: x.start, months: p.months, buffer: x.buffer, lump: x.lump,
    })
    return { x, a, b, gain: strategyGain(a, b) }
  }

  it('по умолчанию: горизонт, две колонки с числами simulateStrategy, вывод, цели, подушка', async () => {
    const html = await render()
    const { x, a, b, gain } = expected({ months: 36, kept: [], cushion: true, useSaved: false })

    expect(html).toContain('Одинаковые траты, разный порядок')
    expect(html).toContain('Горизонт')
    for (const t of ['Год', 'Два', 'Три']) expect(html).toContain(`>${t}</button>`)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Три</)

    expect(html).toContain('Копим как сейчас')
    expect(html).toContain('Сначала долги')
    for (const r of [a, b]) {
      expect(html).toContain(money(r.savings))
      expect(html).toContain(money(r.debtLeft))
      expect(html).toContain(money(r.interestTotal))
    }
    expect(html).toContain('процентов банку')
    expect(html).toContain('без процентных долгов')
    expect(b.debtFreeMonth).toBeGreaterThan(0)
    expect(html).toContain(`через ${b.debtFreeMonth} мес.`)
    // Выигрыш — вторая колонка подсвечена, первая нет.
    expect(gain).toBeGreaterThan(0)
    expect(html).toContain('Сначала долги выгоднее на')
    expect(html).toContain(money(gain))
    expect(html).toContain('чистыми через 36 мес. — это деньги, которые не ушли банку')
    expect(html).toMatch(/border-line bg-surface-2[^"]*"><div[^>]*>Копим как сейчас/)
    expect(html).toMatch(/border-brand bg-brand-soft[^"]*"><div[^>]*>Сначала долги/)

    expect(html).toContain('Что не останавливать')
    expect(html).toContain('Квартира')
    expect(html).toContain('Декрет')
    expect(html).toContain(`${plain(100_000)}/мес`)
    expect(html).toContain(`${plain(50_000)}/мес`)
    // Подушка: аренда + платежи по долгам, до тысяч.
    expect(x.cushionSize).toBe(337_000)
    expect(html).toContain(`Сначала подушка — ${money(337_000)}`)
    expect(html).toContain('месяц обязательных списаний; без неё первая поломка вернёт вас на кредитную карту')
    expect(html).toContain(`Вложить уже накопленное — ${money(x.spare)}`)
    expect(html).not.toContain('Беспроцентные долги')
  })

  it('горизонт «Год», отмеченная цель и вложенное накопленное — числа снова = simulateStrategy', async () => {
    const initial = { months: 12 as const, kept: ['baby'], cushion: false, useSaved: true }
    const html = await render({ initial })
    const { x, a, b, gain } = expected(initial)
    expect(x).toMatchObject({ keep: 50_000, movable: 600_000, buffer: 0, lump: 600_000 })
    expect(html).toMatch(/aria-pressed="true"[^>]*>Год</)
    for (const r of [a, b]) {
      expect(html).toContain(money(r.savings))
      expect(html).toContain(money(r.debtLeft))
    }
    expect(html).toContain(money(gain))
    expect(html).toContain('чистыми через 12 мес.')
    expect(html).toContain(`Вложить уже накопленное — ${money(600_000)}`)
    expect(html).toMatch(/<input type="checkbox" checked[^>]*>\s*<span[^>]*>Декрет/)
  })

  it('все цели отмечены — направлять нечего: колонок нет, текст React', async () => {
    const html = await render({ initial: { kept: ['flat', 'baby'] } })
    expect(html).toContain(
      'Все цели отмечены как неприкосновенные — направлять в долги нечего. Снимите отметку с цели, которую можно поставить на паузу.',
    )
    expect(html).not.toContain('Копим как сейчас')
    expect(html).not.toContain('выгоднее на')
  })

  it('беспроцентный долг с остатком — заметка; без накопленного в неотмеченных — «Вложить» нет', async () => {
    const zero = credit('zero', 'Рассрочка', 300_000, 0, 30_000)
    const html = await render({
      credits: [...credits, zero],
      goals: [goal('flat', 'Квартира', 100_000, 0)],
    })
    expect(html).toContain(
      'Беспроцентные долги — Рассрочка — досрочно не гасятся: они ничего не стоят, а внесённые раньше срока деньги просто перестают быть доступными.',
    )
    expect(html).not.toContain('Вложить уже накопленное')
  })

  it('без долга с процентами — ничего не показывает', async () => {
    const html = await render({ credits: [credit('zero', 'Рассрочка', 300_000, 0, 30_000)] })
    expect(html).not.toContain('Одинаковые траты')
  })
})
