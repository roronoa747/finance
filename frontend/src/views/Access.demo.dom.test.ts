// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { createAppRouter } from '@/router'
import { renderScreen, screenMixin } from '@/test/screenState'
import Landing from './Landing.vue'
import Money from './Money.vue'
import Week from './Week.vue'
import Dreams from './Dreams.vue'
import DebtFaster from './DebtFaster.vue'
import GoalDetail from './GoalDetail.vue'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { spendTotals, unknownGroups } from '@/lib/statements/model'
import type { SpendTotal } from '@/lib/statements/types'
import { monthKey, todayIso, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { amountTotal, capitalGoals, capitalStats, closerThisMonth, liveAccounts, liveCredits, liveGoals, myWeek, netWorth, openDebt, spendRows, tripOps, tripSpent, tripStatus, tripTotal } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import { useAuthStore } from '@/stores/auth'
import { demoPhotoUrl, photoUrl } from '@/lib/photos/store'

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
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Landing)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Попробовать'))!.click()
    await nextTick()
    await nextTick()

    const capital = text(await renderScreen(Money, '/money'))
    expect(capital).toContain('Депозит Kaspi 14 % · общий')
    // Блок 15 (Р-91): «Платежи» — справочник, отметок месяца в нём нет.
    expect(capital).toContain('Аренда квартиры 5-го')
    expect(capital).not.toContain('оплачено')
    expect(capital).toContain('Автокредит')

    // План «Сначала долги» — на экране «Закрыть быстрее» (Б17), «Долги» ведут туда ссылкой.
    const debts = await renderScreen(Money, '/money/debts')
    expect(debts).toContain('data-debts-calc')
    // Мелочи Р-6: долг брату — строкой с «Отдал», мама — «Людям · 1».
    expect(debts).toContain('data-debt="cr-bro"')
    expect(debts).toContain('data-debt-give')
    expect(text(debts)).toContain('Людям · 1')
    const plan = await renderScreen(DebtFaster, '/money/debts/faster')
    expect(plan).toMatch(/role="switch" aria-checked="true"/)
    expect(text(plan)).toContain('Цели на паузе Машина')

    const history = text(await renderScreen(Money, '/money/history'))
    expect(history).not.toContain('Пока пусто')
    expect(history).toContain('Galmart')
    expect(history).toContain('между своими · не трата')
    expect(history).toContain('Аренда квартиры оплачено · Партнёр')
    expect(history).toMatch(/Всё Операции Отметки /)

    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('B2C-52: демо — итоги из демо-операций той же функцией, что разбор; обе вкладки «как в макете»', () => {
  async function tryDemo() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Landing)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Попробовать'))!.click()
    await nextTick()
    await nextTick()
  }

  // 1 октября (прошлая неделя — в сентябре) и середина месяца.
  it.each(['2026-10-01T07:00:00Z', '2026-10-15T07:00:00Z'])('%s: итоги участника a = spendTotals его демо-операций; «Не разобрано» = операции без раздела; «Неделя» — сумма обоих, чип и два решения', async (iso) => {
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
    // Вопросы — строка «Не разобрано» с подписью «N вопрос(а/ов)» сама кнопка (Р-116, FB-19; лист уходит в body).
    expect(html).toMatch(/Не разобрано [1-9][0-9]* вопрос/)
    expect(html).not.toContain('Разобрать')
    expect(html).not.toMatch(/! [1-9]/)

    // «Мечты»: главная мечта, цели и желания строками; строки «Свободно» нет — она в подсказке «Месяца» (Р-116).
    const dreams = text(await renderScreen(Dreams, '/'))
    expect(dreams).toContain('Поездка в Японию')
    expect(dreams).not.toContain('Свободно')
    // Приёмка Б10: 2 цели кроме главной и 3 желания — у каждого участника и общее; пустых «добавить» нет.
    // Блок 11: плюс копилка разбора «Подушка» (Р-66); Блок 14 — фонды «Подушка» и «Запас» в очереди (Р-82, Р-84),
    // главная — первая в очереди, `main` не пишется.
    expect(finance.queue.map((x) => x.goal?.name ?? x.id)).toEqual(['Поездка в Японию', 'Запас', 'debt', 'Машина', 'Подушка', 'Новый диван'])
    // PN-15: «Велосипед» сбылся «за 4 месяца» — не в очереди, в листе «Сбылось · 1» (FG-21: ссылка у «Целей»). Строки желаний — без «чьё».
    expect(finance.householdDoc.goals.find((g) => g.id === 'g-bike')).toMatchObject({ doneAt: expect.any(String), have: 230_000 })
    expect(dreams).toContain('Сбылось · 1')
    expect(finance.householdDoc.goals.some((g) => g.main)).toBe(false)
    for (const w of ['Машина', 'Новый диван', 'Желания 3', 'Кофемашина', 'Велосипед', 'Сапоги']) expect(dreams).toContain(w)
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

describe('B2C-110 (Р-118): демо — фото из приложения, люди «Вы» и «Партнёр»', () => {
  it('у всех целей и желаний — фото бандла (адрес без сервера); имён «Ильяс», «Аруна», «Демо Семья» нет; без /api', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Landing)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Попробовать'))!.click()
    await nextTick()
    await nextTick()

    const finance = useFinanceStore()
    const doc = finance.householdDoc
    const photoIds = [...doc.goals.filter((g) => !g.deletedAt), ...doc.wishlist].map((x) => x.photoId)
    expect(photoIds).toHaveLength(9) // PN-15: + сбывшийся «Велосипед»
    for (const id of photoIds) {
      expect(id).toMatch(/^demo:/)
      // Один путь показа фото: `photoUrl` отдаёт адрес картинки бандла сразу, не зовя сервер.
      expect(await photoUrl(id!)).toBe(demoPhotoUrl(id!))
      expect(demoPhotoUrl(id!)).toMatch(/assets\/demo\/.+\.jpg/)
    }
    // Цель из шаблона — с автором фото (Р-28), как заведённая из шаблона.
    expect(doc.goals.find((g) => g.id === 'g-trip')?.photoCredit?.author).toBe('Roméo A.')
    // Блок 3 «понятность» (PN-11): «Новый диван» — новая тема «Мебель» (PN-07), картинка — демо-файл; у героя — взнос этого
    // месяца 50 000 при 100 000 в месяц → «ближе на 15 дней» (PN-09); на обложке его нет — «N % · название» на фото (FR-09, FG-21),
    // на экране цели — только тост после взноса (куда переезжает число месяца — хвост §4 бэклога «первый»).
    expect(doc.goals.find((g) => g.id === 'g-sofa')).toMatchObject({ template: 'furniture', photoId: 'demo:sofa' })
    const trip = doc.goals.find((g) => g.id === 'g-trip')!
    expect(trip.have).toBe(600_000)
    expect(trip.movements.filter((m) => m.date.startsWith(monthKey())).map((m) => m.amount)).toEqual([50_000])
    expect(closerThisMonth(trip, monthKey())).toBe(15)
    const hero = await renderScreen(Dreams, '/')
    expect(hero).not.toContain('ближе')
    expect(text(hero)).toMatch(/[0-9]+\s%\s+Поездка в Японию/)

    const auth = useAuthStore()
    const all = JSON.stringify({ doc, user: auth.user, household: auth.household, member: auth.member })
    for (const name of ['Ильяс', 'Аруна', 'Аруны', 'Ильяса', 'Демо Семья']) expect(all).not.toContain(name)
    expect(doc.people.map((p) => p.name)).toEqual(['Вы', 'Партнёр'])
    const dreams = text(await renderScreen(Dreams, '/'))
    expect(dreams).not.toMatch(/Ильяс|Аруна/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('PN-06 (понятность Р-2, Р-3): демо — плашка Капитала с формулой и осмысленной статистикой', () => {
  it('формула «счета − долги» = netWorth; статистика демо — четыре доли, рост, «без долгов к», переплата в зарплатах; закрытый экран без строк', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Landing)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Попробовать'))!.click()
    await nextTick()
    await nextTick()

    const finance = useFinanceStore()
    const key = monthKey()
    const stats = capitalStats(finance.monthPlanOf(key), { ...finance.planState(), plans: finance.plans }, key)
    // Демо-цифры дают все четыре доли (автокредит и долг брату, аренда и подписки, взносы по плану, остаток), рост,
    // срок с планом «Сначала долги» и переплату — статистика осмысленна без правки сумм демо.
    expect(stats.parts.map((p) => p.key)).toEqual(['credits', 'payments', 'goals', 'rest'])
    for (const p of stats.parts) expect(p.amount, p.key).toBeGreaterThan(0)
    expect(stats.short).toBe(0)
    expect(stats.growth).toBeGreaterThan(0)
    expect(stats.debtFree.month).not.toBeNull()
    expect(stats.debtFree.salaries).toBeGreaterThan(0)
    expect(stats.overpay.amount).toBeGreaterThan(0)
    expect(stats.overpay.salaries).not.toBeNull()

    // PN-25: партнёр — «аванс и зарплата» (аванс 15-го 150 000, остаток 30-го 300 000), сумма месяца прежняя — 450 000.
    const b = finance.monthPlanOf(key).income.byPerson.find((x) => x.person === 'b')!
    expect(b).toMatchObject({ amount: 450_000, eventCount: 2, cameCount: 0 })
    expect(b.events.map((e) => [e.day, e.amount, e.kind])).toEqual([
      [`${key}-15`, 150_000, 'advance'],
      [`${key}-30`, 300_000, 'salary'],
    ])

    const worth = netWorth(liveAccounts(finance.accounts), liveCredits(finance.credits), liveGoals(finance.goals))
    const assets = amountTotal(liveAccounts(finance.accounts)) + capitalGoals(finance.goals, finance.accounts).total
    const debt = openDebt(finance.credits)
    expect(debt).toBeGreaterThan(0)
    expect(assets - debt).toBe(worth)
    const raw = await renderScreen(Money, '/money')
    expect(raw).toContain(`data-worth-formula>счета ${plain(assets)} − долги ${money(debt)}<`)
    expect(raw).not.toContain('Что такое капитал')
    expect(raw).not.toContain('data-stat-row')
    const opened = text(await renderScreen(Money, '/money', undefined, [screenMixin({ statsOpen: true })]))
    for (const p of stats.parts) expect(opened).toContain(`${text(money(p.amount))} ${p.pct} %`)
    expect(opened).toContain('Капитал растёт на')
    expect(opened).toContain('Без долгов')
    expect(opened).toContain('Переплата')

    // PN-29: Spotify — подписка партнёра; раскрытые «Подписки · 3» делятся на «Общие · 2» и «Партнёр · 1».
    const subs = await renderScreen(Money, '/money', undefined, [screenMixin({ subsOpen: true })])
    expect([...subs.matchAll(/data-subs-who="(\w+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()])).toEqual([
      ['all', 'Общие · 2'],
      ['b', 'Партнёр · 1'],
    ])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('PN-32 (понятность Р-14): демо — прошедшая поездка «Поездка в Японию»', () => {
  // Начало месяца и середина, понедельник и воскресенье — даты поездки и операции демо считаются «N дней назад».
  it.each(['2026-10-01T07:00:00Z', '2026-10-15T07:00:00Z', '2026-10-18T07:00:00Z'])('%s: «За поездку — N из M» — четыре своих операции и запись партнёра; герой «Мечт» — «название · N %»', async (iso) => {
    vi.setSystemTime(new Date(iso))
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Landing)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await nextTick()
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Попробовать'))!.click()
    await nextTick()
    await nextTick()

    const finance = useFinanceStore()
    const ops = useOperationsStore()
    const trip = finance.goals.find((g) => g.id === 'g-trip')!
    expect(tripStatus(trip, todayIso())).toBe('after')
    const mine = tripOps(ops.all, trip, new Set(), new Set())
    expect(mine.map((o) => o.merchant).sort()).toEqual(['Del Papa Cafe', 'Magnum', 'Small', 'Yandex Go'])
    const own = tripTotal(mine)
    expect(finance.householdDoc.tripSpends!.find((t) => t.id === 'g-trip:a')).toMatchObject({ amount: own.amount, ops: 4 })
    const spent = tripSpent(trip, finance.householdDoc.tripSpends, finance.people)
    expect(spent).toMatchObject({ total: own.amount + 64_000, budget: 400_000 })

    const screen = text(await renderScreen(GoalDetail, '/goals/g-trip')).replace(/\s+/g, ' ')
    expect(screen).toContain(`Потрачено в поездке ${money(spent.total)} из ${money(400_000)}`.replace(/\s+/g, ' '))
    // Поездка прошла (решение владельца Б): «Съездили?» вместо срока и «Пополнить».
    expect(screen).toContain('Съездили?')
    expect(screen).not.toContain('Пополнить')
    // Обложка «Мечт» — «N %» и название на фото (FR-09, FG-21), не «потрачено».
    const hero = text(await renderScreen(Dreams, '/'))
    expect(hero).toMatch(/[0-9]+\s%\s+Поездка в Японию/)
    expect(hero).not.toContain('потрачено')
  })
})
