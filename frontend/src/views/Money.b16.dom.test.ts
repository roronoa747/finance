// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, planOf, T0 } from '@/test/planFamily'
import { capitalGoals, debtsOverview, historyMonths, monthPlanPast, monthSalaries } from '@/lib/finance'
import { monthBy } from '@/lib/dates'
import { money, plain, rateField } from '@/lib/money'
import type { Payment, SyncDoc } from '@/types/finance'
import Money from '@/views/Money.vue'
import Month from '@/views/Month.vue'
import DebtFaster from '@/views/DebtFaster.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Блок 16 (Р-108…Р-111, эталон money-b16.html): «Деньги» по макету — «Капитал» с зарплатами для справки и «Цели · N»
 * в «Счетах», «Долги» и «История». Числа — из `finance.ts`; экран их не складывает.
 */
let app: App | null = null
let router: Router

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const KEY = '2026-09'
const paid = (kind: Payment['kind'], targetId: string, period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `${kind}-${targetId}-${period}`, kind, targetId, period, amount, accountId: 'card', by: 'a', at: `${period}-10T05:00:00.000Z`, updatedAt: T0, ...extra,
})

/**
 * Семья: Kaspi Gold 2 000 000; Подушка 400 000 лежит на Kaspi Gold, Отпуск 50 000 и Машина 200 000 — вне счетов;
 * кредиты 1 000 000 + 300 000 + 240 000 = 1 540 000. Счета: 2 000 000 + 250 000 = 2 250 000; капитал — 710 000.
 * Зарплата Ильяса за август пришла на Kaspi Gold — сентябрьская ждёт (10-го, сегодня 12-е): «Пришла» одним нажатием.
 */
function familyDoc(extra: Partial<SyncDoc> = {}): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.map((g) => (g.id === 'cushion' ? { ...g, accountId: 'card' } : g)),
    payments: [paid('salary', 'a', '2026-08', 700_000)],
    ...extra,
  })
}

async function open(role: 'member' | 'viewer' = 'member', doc = familyDoc(), path = '/money', view = Money) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(doc, 1)
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')
/** Сумма с экрана в целых тенге: «−1 540 000 ₸» → −1540000. */
const num = (el: Element | null) => {
  const t = txt(el)
  return (/[−-]/.test(t) ? -1 : 1) * Number(t.replace(/\D/g, ''))
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const dialog = () => q('[role="dialog"]')
const dialogButton = (label: string) => all('[role="dialog"] button').find((b) => txt(b).startsWith(label))

describe('B2C-100: «Капитал» — зарплаты для справки и «Цели · N» в «Счетах»', () => {
  it('«Счета» − «Кредиты» = «Капитал» на экране (итоги — в подсказке у суммы, Р-116); цели вне счетов — в итоге «Счетов»', async () => {
    const finance = await open()
    const goals = capitalGoals(finance.goals, finance.accounts)
    // Итогов у заголовков «Счета» и «Кредиты» нет — они в подсказке «Что такое капитал».
    expect(q('[data-accounts-total]')).toBeNull()
    expect(q('[data-credits-total]')).toBeNull()
    expect(num(q('[data-goals-total]'))).toBe(goals.total)
    await press(q('button[aria-label="Что такое капитал"]'))
    const note = txt(q('[role="note"]'))
    expect(note).toContain('Всё, что есть, минус всё, что должны.')
    expect(note).toContain(`Счета и цели — ${norm(money(2_250_000))}, долги — ${norm(money(1_540_000))}.`)
    expect(2_250_000 - 1_540_000).toBe(num(q('[data-worth]')))
    expect(num(q('[data-worth]'))).toBe(710_000)
    // Брендовой кнопки на экране нет (правило 12).
    expect(all('button').filter((b) => /(^|\s)bg-brand(\s|$)/.test(b.className))).toEqual([])
  })

  it('«Цели · N» свёрнута; раскрытие — цели, на счёте — «на Kaspi Gold», серой суммой; нажатие цели — её экран', async () => {
    await open()
    const head = q('[data-goals] button')!
    expect(txt(head)).toContain('Цели · 2')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-goal]')).toBeNull()
    await press(head)
    expect(all('[data-goal]').map((r) => r.dataset.goal)).toEqual(['car', 'trip', 'cushion'])
    const cushion = q('[data-goal="cushion"]')!
    expect(txt(cushion)).toContain('на Kaspi Gold — уже в счёте')
    // Серая — --ink-2 (Р-116: подписи не бледные).
    expect(cushion.querySelector('.num')!.classList.contains('text-ink-2')).toBe(true)
    expect(q('[data-goal="trip"] .num')!.classList.contains('text-ink-2')).toBe(false)
    await press(q('[data-goal="trip"] button'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/goals/trip'), { timeout: 5000 })
  })

  it('зарплаты: ✓ у пришедшей; дата («ждём» / «пришла») — в листе зарплаты (Р-116); строки = monthSalaries', async () => {
    const doc = familyDoc()
    const finance = await open('member', { ...doc, payments: [...doc.payments!, paid('salary', 'b', KEY, 500_000, { by: 'b', at: '2026-09-11T05:00:00.000Z' })] })
    const lines = monthSalaries(finance.monthPlanOf(KEY), { people: finance.people, payments: finance.payments })
    expect(lines.map((s) => [s.person, s.came])).toEqual([['a', false], ['b', true]])
    expect(q('[data-capital-salaries] [data-salary-status]')).toBeNull()
    expect(q('[data-capital-salaries] [data-salary="a"] [data-came]')).toBeNull()
    expect(q('[data-capital-salaries] [data-salary="b"] [data-came]')).not.toBeNull()
    expect(num(q('[data-capital-salaries] [data-salary="b"] b'))).toBe(500_000)
    for (const [id, when] of [['a', 'ждём 10 сентября'], ['b', 'пришла 11 сентября']]) {
      await press(q(`[data-capital-salaries] [data-salary="${id}"]`))
      expect(txt(q('[role="dialog"] [data-salary-status]'))).toContain(when)
      await press(q('[role="dialog"] button[aria-label="Закрыть"]'))
    }
  })

  it('строка зарплаты — тот же лист, что в «Месяце»; «Пришла» из «Капитала» пишет ту же отметку', async () => {
    const finance = await open()
    await press(q('[data-capital-salaries] [data-salary="a"]'))
    const fromCapital = txt(dialog())
    expect(fromCapital).toContain('Зарплата · Ильяс')
    expect(fromCapital).toContain('ждём 10 сентября')
    expect(dialogButton('Изменить оклад')).toBeTruthy()
    await press(dialogButton('Пришла зарплата'))
    // Лист закрылся сам — ✓ у суммы в строке (как в «Месяце»).
    expect(dialog()).toBeNull()
    expect(q('[data-capital-salaries] [data-salary="a"] [data-came]')).not.toBeNull()
    const marks = finance.payments.filter((p) => p.kind === 'salary' && p.period === KEY && !p.deletedAt)
    expect(marks).toMatchObject([{ targetId: 'a', amount: 700_000, accountId: 'card', by: 'a' }])

    // В «Месяце» — тот же лист (общий компонент): тот же текст до «Пришла».
    app?.unmount()
    document.body.innerHTML = ''
    await open('member', familyDoc(), '/month', Month)
    await press(q('[data-salary="a"]'))
    expect(txt(dialog())).toBe(fromCapital)
  })

  // Критик Б17: дата и «хватает» переехали в лист (Р-116) — viewer открывает его только для чтения, иначе числа потеряны.
  it('viewer — лист зарплаты только для чтения: «Когда» и «Хватает» есть, кнопок нет', async () => {
    await open('viewer')
    await press(q('[data-capital-salaries] [data-salary="a"]'))
    expect(txt(q('[role="dialog"] [data-salary-status]'))).toContain('ждём 10 сентября')
    expect(q('[role="dialog"] [data-left]')).not.toBeNull()
    expect(dialogButton('Изменить оклад')).toBeFalsy()
    expect(dialogButton('Пришла зарплата')).toBeFalsy()
  })
})

describe('B2C-101: «Долги» по макету', () => {
  // Кредитка: отметка сентября с телом 15 000 — полоса 15 000 / (300 000 − 15 000 + 15 000) = 5 %.
  const ccMark = paid('credit', 'cc', KEY, 25_000, { principal: 15_000 })

  it('карточка и строки = debtsOverview; полоса — только у кредита с отметками; брендовых кнопок нет', async () => {
    const finance = await open('member', familyDoc({ payments: [ccMark] }), '/money/debts')
    const o = debtsOverview({ ...finance.planState(), plans: finance.plans }, KEY)
    expect(num(q('[data-debts-total]'))).toBe(o.total)
    expect(o.total).toBe(1_540_000 - 15_000)
    expect(txt(q('[data-debts-free]'))).toBe(`без долгов — ${monthBy(o.freeMonth!, KEY)}`)
    expect(all('[data-debt]').map((r) => r.dataset.debt)).toEqual(o.rows.map((r) => r.creditId))
    const cc = q('[data-debt="cc"]')!
    // В строке — платёж в месяц; ставка (40 %) — в листе кредита (Р-116).
    expect(txt(cc)).toContain(`${plain(25_000).replace(/\s+/g, ' ')} в месяц`)
    expect(txt(cc)).not.toContain('40 %')
    expect(cc.querySelector<HTMLElement>('[data-debt-bar] span')!.style.width).toBe('5%')
    expect(q('[data-debt="loan"] [data-debt-bar]')).toBeNull()
    // На «Долгах» брендовых нет совсем: расчёт с «Выбрать этот план» — на своём экране «Закрыть быстрее» (Б17, правило 12).
    expect(all('button').filter((b) => /(^|\s)bg-brand(\s|$)/.test(b.className))).toEqual([])
    expect(document.body.textContent).not.toContain('Шаг сделан')
    // Ставка — в листе кредита: нажатие строки.
    await press(cc)
    expect(txt(q('[role="dialog"]'))).toContain('Ставка, % годовых')
    expect(all('[role="dialog"] input').map((i) => (i as HTMLInputElement).value)).toContain(rateField(0.4))
  })

  it('«Как закрыть быстрее» — ссылка на свой экран (Б17); там «Сначала долги», «Подробнее» свёрнуто; план включается и выключается оттуда', async () => {
    await open('member', familyDoc(), '/money/debts')
    const link = q<HTMLAnchorElement>('a[data-debts-calc]')!
    expect(link.getAttribute('href')).toBe('/money/debts/faster')
    expect(q('[data-plan-main]')).toBeNull()
    await press(link)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/money/debts/faster'), { timeout: 5000 })
    app?.unmount()
    document.body.innerHTML = ''
    const finance = await open('member', familyDoc(), '/money/debts/faster', DebtFaster)
    expect(txt(q('[data-plan-main]'))).toContain('Сначала долги')
    const more = q<HTMLDetailsElement>('details[data-plan-more]')!
    expect(more.open).toBe(false)
    // Включить — раскрываются «Подробнее» и «Копить или гасить?» с выбором плана.
    await press(q('[data-plan-main] [role="switch"]'))
    expect(more.open).toBe(true)
    await press(all('[data-plan-more] button').find((b) => txt(b) === 'Выбрать этот план'))
    expect(finance.activePlan).not.toBeNull()
    // Выключить — подтверждение.
    await press(q('[data-plan-main] [role="switch"]'))
    await press(dialogButton('Отменить план'))
    expect(finance.activePlan).toBeNull()
  })

  it('строка кредита — лист кредита; «+ Кредит» — форма нового долга', async () => {
    await open('member', familyDoc(), '/money/debts')
    await press(q('[data-debt="loan"]'))
    expect(txt(dialog())).toContain('Кредит')
    await press(q('[role="dialog"] button[aria-label="Закрыть"]'))
    await press(q('[data-add-credit]'))
    expect(dialog()).not.toBeNull()
  })

  it('viewer — без «+ Кредит», переключатель плана неактивен', async () => {
    await open('viewer', familyDoc(), '/money/debts')
    expect(q('[data-add-credit]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    await open('viewer', familyDoc(), '/money/debts/faster', DebtFaster)
    expect(q<HTMLButtonElement>('[data-plan-main] [role="switch"]')!.disabled).toBe(true)
  })

  it('без долгов — «Долгов нет», без расчёта и строк', async () => {
    await open('member', familyDoc({ credits: [] }), '/money/debts')
    expect(txt(q('[data-debts]'))).toContain('Долгов нет')
    expect(q('[data-debts-calc]')).toBeNull()
    expect(q('[data-debt]')).toBeNull()
  })

  // Критик Б16: «без долгов — к» с планом — прогноз плана, а не графики; другой месяц, чем без плана.
  it('с планом «Сначала долги» — «без долгов — к» по прогнозу плана', async () => {
    const without = debtsOverview({ ...(await open('member', familyDoc(), '/money/debts')).planState(), plans: [] }, KEY).freeMonth!
    app?.unmount()
    document.body.innerHTML = ''
    const finance = await open('member', familyDoc({ plans: [planOf()] }), '/money/debts')
    const o = debtsOverview({ ...finance.planState(), plans: finance.plans }, KEY)
    expect(o.freeMonth).not.toBe(without)
    expect(txt(q('[data-debts-free]'))).toBe(`без долгов — ${monthBy(o.freeMonth!, KEY)}`)
  })

  it('кредит не закрывается при нынешнем платеже — «не закрывается» в строке, «без долгов — к» нет', async () => {
    const base = familyDoc()
    await open('member', familyDoc({ credits: base.credits!.map((c) => (c.id === 'cc' ? { ...c, payment: 5_000 } : c)) }), '/money/debts')
    expect(txt(q('[data-debt="cc"]'))).toContain('не закрывается')
    expect(q('[data-debts-free]')).toBeNull()
  })

  it('долгов и плана нет, есть прошлый план — «Прошлые планы» видны сразу, без свёртки', async () => {
    const done = planOf({ status: 'done', endedAt: '2026-09-01T05:00:00.000Z' })
    await open('member', familyDoc({ credits: [], plans: [done] }), '/money/debts')
    expect(q('[data-debts-calc]')).toBeNull()
    expect(document.body.textContent).toContain('Прошлые планы')
  })
})

describe('B2C-102: «История» — месяцы и «Все записи»', () => {
  // Июль: зарплата Ильяса 700 000, аренда 220 000; август: зарплата 700 000 (familyDoc), аренда и взнос в «Отпуск» 40 000.
  const doc = () => {
    const base = familyDoc()
    return familyDoc({
      payments: [
        ...base.payments!,
        paid('salary', 'a', '2026-07', 700_000),
        paid('obligation', 'rent', '2026-07', 220_000),
        paid('obligation', 'rent', '2026-08', 220_000),
      ],
      goals: base.goals.map((g) => (g.id === 'trip' ? { ...g, movements: [{ id: 'mv', date: '2026-08-11T06:00:00.000Z', amount: 40_000, by: 'a' as const }] } : g)),
    })
  }

  it('строки = historyMonths (= сводка «Месяца»); нажатие — /month?month=', async () => {
    const finance = await open('member', doc(), '/money/history')
    const state = { ...finance.householdDoc, credits: finance.credits, ops: [] }
    const list = historyMonths(state, KEY)
    // Август: 700 000 − 220 000 − 40 000 = 440 000, отложили 40 000; июль: 700 000 − 220 000 = 480 000.
    expect(list).toEqual([{ key: '2026-08', left: 440_000, put: 40_000 }, { key: '2026-07', left: 480_000, put: 0 }])
    for (const m of list) expect(m.left).toBe(monthPlanPast(state, m.key).left)
    expect(all('[data-history-month]').map((r) => r.dataset.historyMonth)).toEqual(['2026-08', '2026-07'])
    const aug = q('[data-history-month="2026-08"]')!
    expect(txt(aug)).toContain('Август')
    expect(num(aug.querySelector('[data-left]'))).toBe(440_000)
    expect(num(aug.querySelector('[data-put]'))).toBe(40_000)
    expect(q('[data-history-month="2026-07"] [data-put]')).toBeNull()
    // Чип «История» — без подписи месяца (Р-116): август — первой строкой списка.
    expect(q('[aria-label="Деньги"] [aria-current="page"] small')).toBeNull()
    await press(aug.querySelector<HTMLElement>('button.row-open'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?month=2026-08'), { timeout: 5000 })
  })

  it('«Все записи» свёрнуто; раскрытие — прежняя лента', async () => {
    await open('member', doc(), '/money/history')
    const body = q('[data-history-feed-body]')!
    expect(body.style.display).toBe('none')
    await press(q('[data-history-feed]'))
    expect(body.style.display).toBe('')
    // Лента «Истории» (HistorySquare): чипы фильтра и отметки по дням.
    expect(txt(body)).toContain('Отметки')
  })

  it('пусто — одна строка, без кнопок в списке', async () => {
    await open('member', familyDoc({ payments: [] }), '/money/history')
    expect(txt(q('[data-history-empty]'))).toBe('Здесь появятся прошлые месяцы')
    expect(q('[data-history-months]')).toBeNull()
  })

  it('viewer — те же месяцы', async () => {
    await open('viewer', doc(), '/money/history')
    expect(all('[data-history-month]')).toHaveLength(2)
  })
})

describe('ML-17: «Долги» — долг человеку, «Людям · N», «Отдал» у строки', () => {
  const BRO = { id: 'bro', name: 'Брату', note: '', principal: 500_000, principalSetAt: T0, annualRate: 0, payment: 50_000, day: 25, person: true, updatedAt: T0 }
  const ob = (id: string, name: string, day: number, amount: number) =>
    ({ id, name, note: '', day, category: 'd4' as const, people: true, versions: [{ from: '2000-01', amount }], updatedAt: T0 })
  const people = [ob('mom', 'Маме', 5, 100_000), ob('school', 'Школа', 1, 45_000)]
  // Август отдали с Kaspi Gold — «Отдал» сентября пишет одним нажатием с того же счёта (Р-5).
  const augGiven = paid('credit', 'bro', '2026-08', 50_000, { principal: 50_000, at: '2026-08-25T05:00:00.000Z' })
  function withPeople(extra: Partial<SyncDoc> = {}) {
    const base = familyDoc()
    return familyDoc({ credits: [...base.credits!, BRO], obligations: [...base.obligations!, ...people], payments: [...base.payments!, augGiven], ...extra })
  }
  const giveIn = (id: string) => q(`[data-debt="${id}"]`)!.parentElement!.querySelector<HTMLElement>('[data-debt-give]')

  it('строка брата без ставки и срока, «Отдал» в строке; «Людям · 2» свёрнута и не в сумме долгов', async () => {
    const finance = await open('member', withPeople(), '/money/debts')
    const o = debtsOverview({ ...finance.planState(), plans: finance.plans }, KEY)
    // 1 540 000 кредитов + 500 000 брату = 2 040 000; «Маме» и «Школа» (145 000 в месяц) — не остаток.
    expect(o.total).toBe(2_040_000)
    expect(num(q('[data-debts-total]'))).toBe(2_040_000)
    const bro = q('[data-debt="bro"]')!
    expect(txt(bro)).toBe(`Брату${norm(money(500_000))}${norm(plain(50_000))} в месяц`)
    expect(giveIn('bro')).not.toBeNull()
    expect(giveIn('loan')).toBeNull()
    // Людям: 100 000 + 45 000 = 145 000 в месяц; свёрнута.
    expect(txt(q('[data-people]'))).toContain('Людям · 2')
    expect(num(q('[data-people-total]'))).toBe(145_000)
    expect(q('[data-people-list]')).toBeNull()
    await press(q('[data-people] button'))
    expect(txt(q('[data-people-list]'))).toMatch(/Школа.*Маме/)
    expect(q('[data-add-people]')).not.toBeNull()
    // Платёж людям — его лист.
    await press(all('[data-people-list] [data-payment] button')[1])
    expect(txt(dialog())).toContain('Маме')
  })

  it('«Отдал» — отметка месяца на платёж, остаток падает, ✓ у суммы, кнопки нет', async () => {
    const finance = await open('member', withPeople(), '/money/debts')
    const spy = vi.spyOn(finance, 'markPaid')
    await press(giveIn('bro'))
    expect(spy).toHaveBeenCalledWith('credit', 'bro', 'a', { period: KEY, accountId: 'card' })
    expect(finance.payments.find((p) => p.targetId === 'bro' && p.period === KEY)).toMatchObject({ amount: 50_000, principal: 50_000 })
    // 500 000 − 50 000 = 450 000; сумма долгов 2 040 000 − 50 000 = 1 990 000.
    expect(txt(q('[data-debt="bro"]'))).toContain(norm(money(450_000)))
    expect(num(q('[data-debts-total]'))).toBe(1_990_000)
    expect(q('[data-debt="bro"] [data-debt-given]')).not.toBeNull()
    expect(giveIn('bro')).toBeNull()
  })

  it('первая отдача — счёт спрашивает лист отметки', async () => {
    await open('member', withPeople({ payments: [] }), '/money/debts')
    await press(giveIn('bro'))
    expect(txt(dialog())).toContain('Брату')
  })

  it('viewer — строка и «Людям» видны, без «Отдал», «+ Людям» и «+ Долг»', async () => {
    await open('viewer', withPeople(), '/money/debts')
    expect(q('[data-debt="bro"]')).not.toBeNull()
    expect(giveIn('bro')).toBeNull()
    await press(q('[data-people] button'))
    expect(q('[data-people-list]')).not.toBeNull()
    expect(q('[data-add-people]')).toBeNull()
    expect(q('[data-add-credit]')).toBeNull()
  })

  it('лист долга человеку: без ставки и досрочки; «Отдаю сейчас» 30 000 → «✓ Отдал в сентябре»', async () => {
    const finance = await open('member', withPeople(), '/money/debts')
    await press(q('[data-debt="bro"]'))
    const d = () => txt(dialog())
    for (const t of ['Ставка', 'ГЭСВ', 'Посчитать досрочно', 'График платежей', 'Примечание']) expect(d()).not.toContain(t)
    expect(d()).toContain('закроется в')
    expect(d()).toContain('Удалить долг')
    const input = all('[role="dialog"] label').find((l) => txt(l).startsWith('Отдаю сейчас'))!.querySelector('input')!
    expect(input.value).toBe(plain(50_000))
    input.value = '30 000'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await press(q('[data-person-give]'))
    expect(finance.payments.find((p) => p.targetId === 'bro' && p.period === KEY)).toMatchObject({ amount: 30_000, principal: 30_000 })
    expect(txt(q('[data-person-given]'))).toBe(`✓ Отдал в сентябре${norm(money(30_000))}`)
    expect(q('[data-person-give]')).toBeNull()
  })

  it('viewer — лист только чтением: остаток, «В месяц», «День», без полей и кнопок', async () => {
    await open('viewer', withPeople(), '/money/debts')
    await press(q('[data-debt="bro"]'))
    expect(txt(dialog())).toContain('В месяц')
    expect(all('[role="dialog"] input')).toEqual([])
    expect(q('[data-person-give]')).toBeNull()
    expect(txt(dialog())).not.toContain('Удалить долг')
  })
})
