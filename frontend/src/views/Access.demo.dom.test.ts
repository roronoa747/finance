// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { renderScreen, screenMixin } from '@/test/screenState'
import Access from './Access.vue'
import Money from './Money.vue'
import Week from './Week.vue'
import Dreams from './Dreams.vue'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { spendTotals, unknownGroups } from '@/lib/statements/model'
import type { SpendTotal } from '@/lib/statements/types'
import { monthKey, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { myWeek, spendRows } from '@/lib/finance'
import { money } from '@/lib/money'

/**
 * Демо (пивот 3, B2C-45): «Попробовать» — и «Деньги» показывают все три квадрата с данными: счета с
 * вкладом, план «Сначала долги» с шагом, «История» со своими операциями и отметками. Без запросов к `/api`.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('демо не ходит в сеть'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')

describe('B2C-45: демо — «Деньги» с данными во всех трёх квадратах', () => {
  // 1 октября — худший случай: месяц только начался; сегодняшние операции и отметки — в нём, прошлые недели — «Раньше».
  it('«Попробовать» → Капитал (вклад 14 %, платежи), План (включён, шаг), История (операции и отметки) — без /api', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/access')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Access)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('демо'))!.click()
    await nextTick()
    await nextTick()

    const capital = text(await renderScreen(Money, '/money'))
    expect(capital).toContain('Депозит Kaspi 14 % · общий')
    // Блок 15 (Р-91): «Платежи» — справочник, отметок месяца в нём нет.
    expect(capital).toContain('Аренда квартиры 5-го')
    expect(capital).not.toContain('оплачено')
    expect(capital).toContain('Автокредит')

    const plan = await renderScreen(Money, '/money/debts')
    expect(plan).toMatch(/role="switch" aria-checked="true"/)
    expect(text(plan)).toContain('Цели на паузе Машина')

    const history = text(await renderScreen(Money, '/money/history'))
    expect(history).not.toContain('Пока пусто')
    expect(history).toContain('Galmart')
    expect(history).toContain('между своими · не трата')
    expect(history).toContain('Аренда квартиры оплачено · Аруна')
    expect(history).toMatch(/Всё Операции Отметки /)

    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('B2C-52: демо — итоги из демо-операций той же функцией, что разбор; обе вкладки «как в макете»', () => {
  async function tryDemo() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/access')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Access)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('демо'))!.click()
    await nextTick()
    await nextTick()
  }

  // 1 октября (прошлая неделя — в сентябре) и середина месяца.
  it.each(['2026-10-01T07:00:00Z', '2026-10-15T07:00:00Z'])('%s: итоги Ильяса = spendTotals его демо-операций; «Не разобрано» = операции без раздела; «Неделя» — сумма обоих, чип и два решения', async (iso) => {
    vi.setSystemTime(new Date(iso))
    await tryDemo()
    const finance = useFinanceStore()
    const ops = useOperationsStore()
    const week = weekKey()
    const prev = weekKey(new Date(Date.now() - 7 * 86_400_000))
    const mine = (kind: 'week' | 'month', period: string) => finance.householdDoc.spendTotals!.filter((t) => t.by === 'a' && t.kind === kind && t.period === period && t.amount > 0)
    const strip = (list: SpendTotal[]) => list.map(({ categoryId, amount, ops: n }) => ({ categoryId, amount, ops: n }))
    for (const [kind, period] of [['week', week], ['week', prev], ['month', monthKey()]] as const) {
      expect(strip(mine(kind, period))).toEqual(strip(spendTotals(ops.all, 'a', kind, period)))
    }
    // «Не разобрано» недели — сумма своих операций недели без раздела (у Аруны незнакомого нет).
    /** Траты недели обоих по итогам семьи (`spendRows`) — как их видел бы общий итог; на «Неделе» теперь только свои (Р-95). */
    const picOf = () => ({ ...spendRows(finance.householdDoc.spendTotals!, finance.householdDoc.spendCategories!, { kind: 'week', period: week }), range: weekRange(week) })
    const unknownOps = ops.all.filter((o) => !o.categoryId && !o.internal && o.amount < 0 && weekKey(o.date) === week).reduce((a, o) => a - o.amount, 0)
    const pic = picOf()
    expect(pic.unknown).toBe(unknownOps)
    expect(unknownOps).toBe(75_300) // 10 ИП сегодня (B2C-67)
    // Сумма недели — свои операции недели + итоги Аруны.
    const opsWeek = ops.all.filter((o) => !o.internal && o.amount < 0 && weekKey(o.date) === week).reduce((a, o) => a - o.amount, 0)
    const arunaWeek = finance.householdDoc.spendTotals!.filter((t) => t.by === 'b' && t.kind === 'week' && t.period === week).reduce((a, t) => a + t.amount, 0)
    expect(pic.total).toBe(opsWeek + arunaWeek)

    // Блок 15 (Р-95): «Неделя» — сумма только своих трат (`myWeek`); сравнение недель — в «8 недель», бейджа «↑ N %» нет (Р-116).
    const { state, ctx } = finance.planInput(monthKey())
    const own = myWeek(state, { ...ctx, by: 'a', week, ops: ops.all })
    expect(own.total).toBeGreaterThan(0)
    expect(own.total).toBeLessThan(pic.total)
    const html = text(await renderScreen(Week, '/week', undefined, [screenMixin({ questionsOpen: true })]))
    expect(html).toContain(`${weekRangeLabel(pic.range)} ${text(money(own.total))}`)
    expect(html).not.toMatch(/[↑↓] [0-9]+%/)
    // Вопросы — «Разобрать» в строке «Не разобрано» с подписью «N вопрос(а/ов)» (Р-116; лист уходит в body).
    expect(html).toMatch(/Не разобрано [1-9][0-9]* вопрос/)
    expect(html).toContain('Разобрать')
    expect(html).not.toMatch(/! [1-9]/)

    // «Мечты»: главная мечта, цели и желания строками; строки «Свободно» нет — она в подсказке «Месяца» (Р-116).
    const dreams = text(await renderScreen(Dreams, '/'))
    expect(dreams).toContain('Поездка в Японию')
    expect(dreams).not.toContain('Свободно')
    // Приёмка Б10: 2 цели кроме главной и 3 желания — у каждого участника и общее; пустых «добавить» нет.
    // Блок 11: плюс копилка разбора «Подушка» (Р-66); Блок 14 — фонды «Подушка» и «Запас» в очереди (Р-82, Р-84),
    // главная — первая в очереди, `main` не пишется.
    expect(finance.queue.map((x) => x.goal?.name ?? x.id)).toEqual(['Поездка в Японию', 'Запас', 'debt', 'Машина', 'Подушка', 'Новый диван'])
    expect(finance.householdDoc.goals.some((g) => g.main)).toBe(false)
    for (const w of ['Машина', 'Новый диван', 'Все 3', 'Кофемашина', 'общие', 'Велосипед', 'Ильяс', 'Сапоги', 'Аруна']) expect(dreams).toContain(w)
    expect(dreams).not.toContain('+ Желание')
    // Разделы демо-операций — те, что дают словарь и правила: ответ на одного продавца раскладывает
    // операции заново (`reapply`), и остальные не возвращаются в «не разобрано» (стенд B2C-52).
    const abenova = unknownGroups(ops.all).find((g) => g.label === 'ИП Абенова')!
    await ops.recategorize(abenova.match, { categoryId: 'sc_food' }).catch(() => {})
    const after = picOf()
    expect(after.unknown).toBe(75_300 - 7_600)
    expect(after.total).toBe(pic.total)
    expect(fetch).not.toHaveBeenCalled()
  })
})
