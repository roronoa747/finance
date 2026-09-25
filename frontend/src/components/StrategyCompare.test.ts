import { describe, it, expect } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { money, plain } from '@/lib/money'
import { simulateStrategy, strategyGain, strategyInputs } from '@/lib/finance'
import type { Credit, DebtPlan, Goal, Obligation } from '@/types/finance'
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
  // Ссылки калькулятора (цель-подушка, экран плана) — RouterLink: нужен роутер.
  const render = (p: { credits?: Credit[]; goals?: Goal[]; initial?: Initial } = {}) => {
    const app = createSSRApp(StrategyCompare, {
      credits: p.credits ?? credits,
      goals: p.goals ?? goals,
      obligations: [rent],
      monthKey: KEY,
      initial: p.initial,
    })
    app.use(createRouter({ history: createMemoryHistory(), routes }))
    return renderToString(app)
  }

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

describe('PV-15: «Выбрать этот план» в калькуляторе (SSR)', () => {
  const T0 = '2026-09-01T00:00:00Z'
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
  const plan: DebtPlan = {
    id: 'p', status: 'active', by: 'a', startedAt: '2026-09-10T05:00:00.000Z', keptGoalIds: [], cushionGoalId: 'baby',
    creditIds: ['card', 'bank'], months: 36, lump: 0, forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null }, updatedAt: T0,
  }

  const render = (extra: Record<string, unknown> = {}, list = goals) => {
    const app = createSSRApp(StrategyCompare, { credits, goals: list, obligations: [rent], monthKey: '2026-09', canChoose: true, ...extra })
    app.use(createRouter({ history: createMemoryHistory(), routes }))
    return renderToString(app)
  }
  const text = (html: string) => html.replace(/<!--[^>]*-->/g, '').replace(/<[^>]+>/g, ' ').replace(/[ \n\t\r]+/g, ' ')

  it('без плана — радио подушки по целям и «Без подушки», совет завести подушку, кнопка и пояснение', async () => {
    const html = await render()
    expect(html).toContain('Подушка — какая цель?')
    expect(html.match(/type="radio"/g)).toHaveLength(goals.length + 1)
    expect(html).toContain('Без подушки')
    expect(html).toContain('Заведите цель-подушку — план начнёт с неё')
    expect(html).toContain('href="/goals"')
    expect(html).toMatch(/>\s*Выбрать этот план\s*</)
    const t = text(html)
    // Подушки нет — на паузе обе цели: 100 000 + 50 000; первый долг — самый дорогой, шаг — их сумма.
    expect(t).toContain(`На паузу встанут: Квартира, Декрет — ${money(150_000)} в месяц.`)
    expect(t).toContain('Первым гасится «Кредитка» — самый дорогой долг.')
    expect(t).toContain(`Шаг этого месяца — ${money(150_000)} досрочно в «Кредитка».`)
  })

  it('подушка отмечена — не на паузе, совета нет; пустая подушка — шаг «пополнить подушку»', async () => {
    const html = await render({ initial: { cushionGoalId: 'baby' } })
    expect(html).toMatch(/type="radio" name="plan-cushion" checked[^>]*>\s*<span[^>]*>Декрет</)
    expect(html).not.toContain('Заведите цель-подушку')
    expect(text(html)).toContain(`На паузу встанут: Квартира — ${money(100_000)} в месяц.`)
    expect(text(html)).toContain(`Шаг этого месяца — ${money(100_000)} досрочно в «Кредитка».`)

    // Месяц списаний: 220 000 + 25 000 + 91 680 = 336 680; в подушке 30 000 — не хватает 306 680.
    const thin = [goal('flat', 'Квартира', 100_000, 600_000), goal('cush', 'Подушка', 50_000, 30_000)]
    const t = text(await render({ initial: { cushionGoalId: 'cush' } }, thin))
    expect(t).toContain(`Шаг этого месяца — пополнить подушку «Подушка» на ${money(100_000)}: до месяца обязательных списаний не хватает ${money(306_680)}.`)
  })

  it('viewer — без кнопки выбора, остальное видно (Р-12)', async () => {
    const html = await render({ canChoose: false })
    expect(html).not.toMatch(/>\s*Выбрать этот план\s*</)
    expect(html).toContain('Подушка — какая цель?')
    expect(text(html)).toContain('Первым гасится «Кредитка»')
  })

  it('с активным планом — карточка «План выбран» с шагом и ссылкой на план, выбора нет', async () => {
    const step = { kind: 'prepay', creditId: 'card', amount: 100_000, period: '2026-09', applied: null }
    const html = await render({ plan, step })
    expect(text(html)).toContain('План выбран в сентябре 2026')
    expect(text(html)).toContain(`шаг этого месяца ${money(100_000)}`)
    expect(html).toContain('href="/plan"')
    expect(html).not.toMatch(/>\s*Выбрать этот план\s*</)
    expect(html).not.toContain('type="radio"')
  })
})
