import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { money, plain } from '../src/lib/money'
import { assignIds } from '../src/lib/statements/model'
import { foundPayments } from '../src/lib/statements/firstRun'
import { todayIso } from '../src/lib/dates'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { myWeek, planByFact, type Decision } from '../src/lib/finance'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Payment, SyncDoc } from '../src/types/finance'
import Week from '../src/views/Week.vue'
import Month from '../src/views/Month.vue'
import Money from '../src/views/Money.vue'
import Start from '../src/views/Start.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 5 «Фидбек» (FB-19…FB-21; Р-30…Р-37): «Неделя» Б, «Месяц» Б, «Деньги» ровно, заметка себе, первый запуск «сначала
 * траты». Два телефона и viewer; пятница 23 октября 2026 (W43 = 19–25 окт); каждый загрузил свою выписку 1–22 октября.
 *
 * Ручной расчёт:
 *   Ильяс (a)  план октября: продукты 600 000 + кафе 100 000 + транспорт 75 000 = 775 000 → план недели 775 000 × 7 / 31 =
 *              175 000 ровно. Выписка: W40 Magnum 20 000; W41 Magnum 25 000, Yandex Go 4 000; W42 Magnum 30 000, Coffee
 *              Boom 6 000; W43 Magnum 30 000, Coffee Boom 6 500, ИП Ахметова 5 000 (без раздела). Неделя W43 = 30 000 +
 *              6 500 + 5 000 = 41 500 → «осталось 133 500 / 175 000»; факт октября 126 500.
 *   Аруна (b)  план: продукты 100 000 → план недели 100 000 × 7 / 31 = 22 580,6 → 22 581. Выписка: W41 Small 15 000, W43
 *              Small 30 000 → W43 30 000 > 22 581 → «сверх плана 7 419 / 22 581».
 *   Зарплаты:  Ильяс 700 000 (10-го) — пришла (отметка октября); Аруна 500 000 (20-го) — ждёт.
 *   Новая семья (д): выписка 7 сен – 22 окт (46 дней ≥ 14), шесть полных недель W37…W42 (продукты 20 000 … 30 000 по
 *              2 000 в неделю, кафе 6 000, транспорт 3 000): среднее продуктов 25 000 × 52 / 12 = 108 333 → 109 000,
 *              кафе 26 000, транспорт 13 000 → план 148 000; доход 300 000 12-го (два раза) → «Это ваш доход?»;
 *              Apple Music 4 990 14 сен и 13 окт → «нашли в выписке».
 */
type Phone = { pinia: Pinia; client: ApiClient; user: string; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, pv: FakePrivate, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member', user = `u-${slot}`): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot), ...privateFor(pv, user) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await store.pullPrivateDoc(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, user, store }
}

async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  await from.store.syncPrivate(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
    await p.store.pullPrivateDoc(p.client)
    await useOperationsStore().loadUploads(p.client)
    await useOperationsStore().pull(p.client)
  }
}

const K = '2026-10'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
const between = (html: string, from: string, to: string) => {
  const i = html.indexOf(from)
  if (i < 0) return ''
  const j = html.indexOf(to, i + from.length)
  return html.slice(i, j < 0 ? undefined : j)
}
const count = (html: string, needle: string) => html.split(needle).length - 1

const salaryCame = (by: 'a' | 'b', amount: number): Payment => ({
  id: `sal-${by}-${K}`, kind: 'salary', targetId: by, period: K, amount, accountId: null, by, at: '2026-10-10T05:00:00.000Z', updatedAt: T0,
})
function familyDoc(): SyncDoc {
  const base = planFamilyDoc()
  return planFamilyDoc({
    spendPlans: [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 600_000, updatedAt: T0 },
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 100_000, updatedAt: T0 },
      { id: 'a:sc_transport', by: 'a', categoryId: 'sc_transport', amount: 75_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 },
    ],
    payments: [...(base.payments ?? []).filter((p) => p.kind !== 'salary'), salaryCame('a', 700_000)],
  })
}

const op = (date: string, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const statement = (ops: Omit<Operation, 'id'>[], from = '2026-10-01', to = '2026-10-22'): ParsedStatement => ({ bank: 'kaspi', from, to, skipped: 0, operations: assignIds(ops) })
const STATEMENT_A = () =>
  statement([
    op('2026-10-02', -20_000, 'Magnum', 'sc_food'),
    op('2026-10-06', -25_000, 'Magnum', 'sc_food'),
    op('2026-10-08', -4_000, 'Yandex Go', 'sc_transport'),
    op('2026-10-13', -30_000, 'Magnum', 'sc_food'),
    op('2026-10-15', -6_000, 'Coffee Boom', 'sc_cafe'),
    op('2026-10-20', -30_000, 'Magnum', 'sc_food'),
    op('2026-10-21', -6_500, 'Coffee Boom', 'sc_cafe'),
    op('2026-10-22', -5_000, 'ИП Ахметова', null),
  ])
const STATEMENT_B = () => statement([op('2026-10-07', -15_000, 'Small', 'sc_food'), op('2026-10-20', -30_000, 'Small', 'sc_food')])

const week = (p: Phone, state: Record<string, unknown> = {}, path = '/week') => {
  setActivePinia(p.pinia)
  return screen(p.pinia, Week, path, undefined, [screenMixin(state)])
}
const month = (p: Phone, state: Record<string, unknown> = {}, path = '/month') => {
  setActivePinia(p.pinia)
  return screen(p.pinia, Month, path, undefined, [screenMixin(state)])
}
const money$ = (p: Phone, path = '/money') => {
  setActivePinia(p.pinia)
  return screen(p.pinia, Money, path)
}

describe('e2e / Фидбек Блок 5 — вид главных экранов, заметка, первый запуск «сначала траты»', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements
  let pv: FakePrivate

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-23T07:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** Телефон загрузил свою выписку, дождался конца тоста и отправил итоги. */
  async function uploaded(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }

  async function family() {
    const A = await phone(server, st, pv, 'a')
    const B = await phone(server, st, pv, 'b')
    await uploaded(A, STATEMENT_A())
    await uploaded(B, STATEMENT_B())
    await sync(A, B)
    await sync(B, A)
    return { A, B }
  }
  const weekOf = (p: Phone) => {
    setActivePinia(p.pinia)
    const { state, ctx } = p.store.planInput(K)
    return myWeek(state, { ...ctx, totals: p.store.householdDoc.spendTotals ?? [], uploads: useOperationsStore().uploads, by: useAuthStore().slot!, week: '2026-W43', ops: useOperationsStore().all })
  }

  it('(а) «Неделя»: шапка — сумма недели и кружки; план 775 000 на октябрь → полоса и «осталось 133 500 / 175 000» = myWeek; Аруна — «сверх плана 7 419 / 22 581»; «Не разобрано» — кнопка в «Вопросы»; viewer «Неделю» не видит', async () => {
    const { A, B } = await family()
    const wa = weekOf(A)
    expect(wa).toMatchObject({ total: 41_500, plan: 175_000, rest: 133_500 })
    const html = await week(A)
    // Шапка в два яруса: сумма и кружки выписок в одной карточке; ✓-бейджа и карточки `data-week-sum` нет.
    const head = between(html, 'data-week-head', 'data-week-plan')
    expect(text(between(head, 'data-week-total', '</span>'))).toContain(sp(money(41_500)))
    expect(head).toContain('data-week-strip')
    expect(head).toContain('data-upload="quiet"')
    expect(html).not.toContain('data-week-sum')
    expect(html).not.toContain('data-to-plan')
    // Полоса плана недели — брендовая, одна подпись.
    const bar = between(html, 'data-week-plan', 'data-week-list')
    expect(bar).toContain('bg-brand')
    expect(text(between(bar, 'data-week-rest', '</span>'))).toContain(sp(`осталось ${plain(133_500)} / ${plain(175_000)}`))
    // Строки разделов — без полос и остатка; «Не разобрано» — сама кнопка в «Вопросы».
    expect(html).not.toContain('data-rest')
    expect(html).not.toContain('вне плана')
    expect(html).toMatch(/<button[^>]*data-row="_unknown"[^>]*data-bang/)
    expect(text(html)).not.toContain('Разобрать')
    expect(text(between(html, 'data-row="_unknown"', '</button>'))).toContain('1 вопрос')
    // Лист «Вопросы» открывается с пачки «Без раздела · 1».
    expect(text(await week(A, { questionsOpen: true }))).toContain('Без раздела · 1')
    // Остаток раздела — в листе раздела, как был.
    expect(text(between(await week(A, { sectionFor: 'sc_food' }), 'data-section-meta', '</p>'))).toContain(sp(`на октябрь осталось ${plain(600_000 - 105_000)} из ${plain(600_000)}`))

    // Аруна: своя полоса — перерасход `--warn`.
    expect(weekOf(B)).toMatchObject({ total: 30_000, plan: 22_581, rest: -7_419 })
    const hers = between(await week(B), 'data-week-plan', 'data-week-list')
    expect(hers).toContain('bg-warn')
    expect(text(between(hers, 'data-week-rest', '</span>'))).toContain(sp(`сверх плана ${plain(7_419)} / ${plain(22_581)}`))

    // Viewer: гард ведёт в «Месяц»; его «Неделя» без загрузки, полосы и заметок.
    const V = await phone(server, st, pv, 'a', 'viewer', 'u-v')
    const viewer = await week(V)
    for (const a of ['data-upload=', 'data-note', 'data-bang']) expect(viewer).not.toContain(a)
  })

  it('(б) «Месяц»: «Остаётся» справа от кольца = monthPlan().rest; разделы — одна точка, призыв подписью; зарплата Ильяса пришла — строка подсвечена без ✓, Аруна ждёт — серая; у Аруны после синка — то же', async () => {
    const { A, B } = await family()
    const plan = A.store.monthPlanOf(K)
    const html = await month(A)
    const top = between(html, 'data-month-top', 'data-sections')
    expect(top).toContain('data-month-ring')
    expect(top).not.toContain('r="110"')
    expect(text(between(top, 'data-rest>', '</span>')).replace(/^.*?>/, '').trim()).toBe(sp(money(plan.rest)))
    expect(top).toContain('data-afford-open')
    // Разделы — в той же карточке; второй точки-призыва нет, призыв — подписью брендом.
    expect(between(html, 'data-month-top', 'data-salary=')).toContain('data-sections')
    expect(html).not.toContain('data-section-dot')
    expect(count(between(html, 'data-section="queue"', 'data-salary='), 'rounded-full')).toBe(1)
    // Зарплата Ильяса пришла, взносы ждут «Отложил» — призыв у «Целей»: «0 из N отложено».
    expect(html).toContain('data-section-call')
    expect(text(between(html, 'data-section-call', '</span>'))).toMatch(/0 из \d+ отложено/)
    // Зарплаты — ниже разделов: Ильяс — `data-came` и подсветка, ✓ и «N из M пришли» нет; Аруна — тихая сумма.
    expect(html.indexOf('data-sections')).toBeLessThan(html.indexOf('data-salary="a"'))
    const rowA = between(html, 'data-salary="a"', 'data-salary="b"')
    expect(rowA).toContain('data-came')
    expect(html).toMatch(/bg-ok-soft[^>]*data-salary="a"[^>]*data-came/)
    expect(text(rowA)).toContain(sp(money(700_000)))
    expect(text(rowA)).not.toContain('✓')
    expect(html).not.toContain('data-came-count')
    const rowB = between(html, 'data-salary="b"', 'data-extra-income')
    expect(rowB).not.toContain('data-came')
    expect(rowB).toContain('text-ink-2')
    expect(text(rowB)).toContain(sp(money(500_000)))
    // «N из M пришли» — в листе зарплаты.
    expect(text(between(await month(A, { salaryFor: 'a' }), 'data-salary-status', '</div>'))).toContain('пришла')

    // Второй телефон (Аруна) — та же подсветка строки Ильяса.
    await sync(A, B)
    const hers = await month(B)
    expect(between(hers, 'data-salary="a"', 'data-salary="b"')).toContain('data-came')
    expect(between(hers, 'data-salary="b"', 'data-extra-income')).not.toContain('data-came')
  })

  it('(в) «Деньги»: сегмент как «Неделя | Месяц», слот у каждой строки, суммы без «₸», зарплат нет; viewer — то же без «Добавить»', async () => {
    const { A } = await family()
    const html = await money$(A)
    const seg = between(html, 'aria-label="Деньги"', 'data-capital')
    expect(html).toMatch(/bg-surface-2[^>]*aria-label="Деньги"/)
    expect(seg).toMatch(/aria-current="page"[^>]*>\s*Капитал/)
    expect(seg).not.toContain('border-brand')
    expect(html).not.toContain('data-capital-salaries')
    expect(html).not.toContain('data-salary=')
    // Слоты 32 у строк счетов, «Целей», кредитов, платежей, подписок и «Добавить».
    const lists = html.slice(html.indexOf('Счета'))
    expect(count(lists, 'size-8')).toBeGreaterThanOrEqual(6)
    expect(lists).toContain('data-payment-slot')
    expect(lists).toContain('data-add-account')
    expect(lists).toContain('data-add-payment')
    // «₸» — у каждой суммы, и в списках тоже (Р-12 бэклога «Figma»; было «только у капитала», Р-34).
    expect(text(between(html, 'data-worth', '</span>'))).toContain('₸')
    expect(text(lists)).toContain('₸')
    // Viewer — без «Добавить».
    const V = await phone(server, st, pv, 'a', 'viewer', 'u-v')
    const viewer = await money$(V)
    expect(viewer).toContain('aria-label="Деньги"')
    expect(viewer).not.toContain('data-add-account')
    expect(viewer).not.toContain('data-add-payment')
    expect(viewer).not.toContain('data-salary=')
  })

  it('(г) заметка: Ильяс «+ → Заметка» с датой на этой неделе → карточка, ✓ — сделано; у Аруны и viewer — нет; второй телефон Ильяса видит (личный документ)', async () => {
    const { A, B } = await family()
    setActivePinia(A.pinia)
    expect(await screen(A.pinia, Week, '/week?note=1')).toContain('data-note-sheet')
    const id = A.store.addNote({ text: 'Продлить страховку', date: '2026-10-21', amount: 60_000 })
    const html = await week(A)
    const card = between(html, `data-note="${id}"`, 'data-note-done')
    expect(text(card)).toContain('Продлить страховку')
    expect(text(card)).toContain(sp(`21 октября · ${plain(60_000)}`))
    // Карточка — между полосой плана и разделами.
    expect(html.indexOf('data-week-plan')).toBeLessThan(html.indexOf(`data-note="${id}"`))
    expect(html.indexOf(`data-note="${id}"`)).toBeLessThan(html.indexOf('data-week-list'))
    // Деньги заметки нигде не считаются: сумма недели прежняя.
    expect(text(between(html, 'data-week-total', '</span>'))).toContain(sp(money(41_500)))
    A.store.setNoteDone(id, true)
    expect(await week(A)).toMatch(new RegExp(`data-note="${id}"[^>]*data-done="true"`))
    // Пункт «Заметка» в «+» — после «Траты» (оболочка); у viewer заметок нет.
    await sync(A, B)
    expect(await week(B)).not.toContain('data-note')
    const V = await phone(server, st, pv, 'a', 'viewer', 'u-v')
    expect(await week(V)).not.toContain('data-note')
    // Второй телефон Ильяса — тот же личный документ.
    const A2 = await phone(server, st, pv, 'a')
    const again = await week(A2)
    expect(again).toContain(`data-note="${id}"`)
    expect(again).toMatch(new RegExp(`data-note="${id}"[^>]*data-done="true"`))
  })

  it('(д) первый запуск: `intro → dream → spend → invite` → выписка ≥ 14 дней; без оклада «Месяц» — «—»; «Это ваш доход?» → доход; «нашли N в выписке» → «В платежи»; точка и «Поставить план» → spendPlans = planByFact; партнёр по коду — `intro → spend`', async () => {
    server = fakeServer({ ...defaultSyncDoc() })
    const A = await phone(server, st, pv, 'a')
    expect(A.store.setupDone).toBe(false)
    expect(await screen(A.pinia, Start, '/start')).toContain('data-intro-page')
    expect(await screen(A.pinia, Start, '/start/dream')).toContain('На что копим?')
    A.store.addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    const spend = await screen(A.pinia, Start, '/start/spend')
    expect(spend).toContain('Тратьте как обычно')
    expect(spend).toContain('2 из 3')
    expect(spend).not.toContain('Зарплата в месяц')
    // Выписка 7 сен – 22 окт: шесть полных недель, доход 12-го, Apple Music дважды.
    const ops: Omit<Operation, 'id'>[] = []
    for (let i = 0; i < 6; i++) {
      const mon = new Date(Date.UTC(2026, 8, 7 + i * 7))
      const d = (k: number) => new Date(mon.getTime() + k * 864e5).toISOString().slice(0, 10)
      ops.push(op(d(1), -(20_000 + i * 2_000), 'Magnum', 'sc_food'), op(d(2), -6_000, 'Coffee Boom', 'sc_cafe'), op(d(3), -3_000, 'Yandex Go', 'sc_transport'))
    }
    ops.push(op('2026-09-14', -4_990, 'APPLE.COM BILL', 'sc_subscriptions'), op('2026-10-13', -4_990, 'APPLE.COM BILL', 'sc_subscriptions'))
    ops.push(op('2026-09-12', 300_000, 'ТОО Ромашка', null, { kind: 'income' }), op('2026-10-12', 300_000, 'ТОО Ромашка', null, { kind: 'income' }))
    await uploaded(A, statement(ops, '2026-09-07', '2026-10-22'))
    // Дальше — партнёр («Пропустить»): `finish` ставит setupDoneAt и onboardedAt; оклада нет.
    await screen(A.pinia, Start, '/start/spend', undefined, [screenMixin({ uploaded: true }, (s) => (s.afterSpend as () => void)())])
    expect(await screen(A.pinia, Start, '/start/invite')).toContain('Пригласите партнёра')
    await screen(A.pinia, Start, '/start/invite', undefined, [screenMixin({ uploaded: true }, (s) => (s.finish as () => void)())])
    expect(A.store.setupDone).toBe(true)
    expect(A.store.people[0]).toMatchObject({ id: 'a', onboardedAt: expect.any(String) })
    expect(A.store.people[0].salary ?? 0).toBe(0)
    await sync(A)

    // «Месяц» без дохода: «—», без «Не хватает»; «нашли 1 в выписке»; «Поставить план» уже ждёт (выписка ≥ 14 дней).
    const noIncome = await month(A)
    expect(noIncome).toContain('data-rest-none')
    expect(noIncome).not.toContain('data-rest>')
    expect(text(noIncome)).not.toContain('Не хватает')
    expect(noIncome).toContain('data-add-salary')
    // Повторы продавцов за 3 месяца: Apple Music (словарь); кофейня и такси каждую неделю — мимо (TL-01, Р-1: не одно списание в месяц).
    expect(text(between(noIncome, 'data-section="dues"', 'data-section="spend"'))).toContain('нашли 1 в выписке')
    expect(noIncome).toContain('data-plan-fact')

    // «Неделя»: «Это ваш доход?» первым → «Да» — оклад 300 000, 12-го; точка на сегменте — ждёт «Поставить план».
    const q = await week(A, { questionsOpen: true })
    expect(q).toContain('data-plan-dot')
    expect(text(q)).toContain('Это ваш доход?')
    await week(A, { questionsOpen: true }, '/week').then(() =>
      screen(A.pinia, Week, '/week', undefined, [
        screenMixin({ questionsOpen: true }, (s) => {
          const d = s.decision as Decision
          expect(d.kind).toBe('income')
          ;(s.onPrimary as (d: Decision) => void)(d)
        }),
      ]),
    )
    expect(A.store.people[0]).toMatchObject({ salary: 300_000, payday: 12 })
    expect(A.store.monthPlanOf(K).income.total).toBe(300_000)
    expect(await month(A)).not.toContain('data-rest-none')

    // «нашли в выписке» → «В платежи» (как `AddPaymentSheet`): платёж, отметка октября, правило; строка ушла.
    setActivePinia(A.pinia)
    const opsStore = useOperationsStore()
    const found = foundPayments(opsStore.all, { rules: A.store.merchantRules, payments: A.store.payments, today: todayIso() })
    const apple = found.find((f) => f.name === 'APPLE.COM BILL')!
    expect(found).toHaveLength(1)
    expect([apple.amount, apple.day]).toEqual([4_990, 13])
    const dues = await month(A, { opened: 'dues' })
    expect(dues).toContain(`data-found-row="${apple.opId}"`)
    const obId = A.store.addObligation({ name: apple.name, note: 'ежемесячно', day: apple.day, category: 'd4', every: 'month', amount: apple.amount })
    await opsStore.addToPayments(apple.opId, obId, A.client)
    expect(A.store.payments.find((p) => p.targetId === obId)).toMatchObject({ period: K, amount: 4_990, source: 'statement' })
    expect(foundPayments(opsStore.all, { rules: A.store.merchantRules, payments: A.store.payments, today: todayIso() }).map((f) => f.name)).not.toContain('APPLE.COM BILL')
    expect(await month(A, { opened: 'dues' })).not.toContain(`data-found-row="${apple.opId}"`)

    // «Поставить план»: расчёт по шести неделям — продукты 109 000, кафе 26 000, транспорт 13 000, итог 148 000.
    const { state, ctx } = A.store.planInput(K)
    const p = planByFact(state, ctx, 'a', todayIso())!
    expect(p.rows.map((r) => [r.categoryId, r.amount])).toEqual([['sc_food', 109_000], ['sc_cafe', 26_000], ['sc_transport', 13_000]])
    expect(p.total).toBe(148_000)
    const call = await month(A)
    expect(text(between(call, 'data-section="spend"', 'data-section="queue"'))).toContain('обычно в месяц')
    expect(text(between(call, 'data-section="spend"', 'data-section="queue"'))).toContain(sp(plain(148_000)))
    await month(A, { planFactOpen: true }).then((sheet) => {
      expect(sheet).toContain('data-plan-fact-sheet')
      expect([...sheet.matchAll(/data-plan-fact-row="([^"]+)"/g)].map((m) => m[1])).toEqual(['sc_food', 'sc_cafe', 'sc_transport'])
      expect(sheet).not.toContain('data-plan-fact-more')
    })
    await screen(A.pinia, Month, '/month', undefined, [screenMixin({}, (s) => (s.savePlanFact as () => void)())])
    expect((A.store.householdDoc.spendPlans ?? []).filter((x) => x.by === 'a').map((x) => [x.categoryId, x.amount])).toEqual(p.rows.map((r) => [r.categoryId, r.amount]))
    expect(A.store.planFactCall()).toBeNull()
    expect(await month(A)).not.toContain('data-plan-fact')
    // «Неделя» получила полосу плана: 148 000 × 7 / 31 = 33 419.
    const planned = await week(A)
    expect(planned).toContain('data-week-plan')
    expect(text(between(planned, 'data-week-rest', '</span>'))).toContain(`/ ${sp(plain(33_419))}`)
    expect(planned).not.toContain('data-plan-dot')

    // Партнёр по коду: `intro → spend` — без мечты и приглашения; «Позже» — people[b] с onboardedAt, оклада нет.
    await sync(A)
    const B = await phone(server, st, pv, 'b')
    expect(await screen(B.pinia, Start, '/start')).toContain('data-intro-page')
    for (const path of ['/start/dream', '/start/invite']) expect(await screen(B.pinia, Start, path)).toContain('data-intro-page')
    const his = await screen(B.pinia, Start, '/start/spend')
    expect(his).toContain('Тратьте как обычно')
    expect(his).not.toContain('1 из 1')
    await screen(B.pinia, Start, '/start/spend', undefined, [screenMixin({}, (s) => (s.afterSpend as () => void)())])
    expect(B.store.people.find((x) => x.id === 'b')).toMatchObject({ onboardedAt: expect.any(String) })
    expect(B.store.people.find((x) => x.id === 'b')?.salary ?? 0).toBe(0)
    expect(B.store.householdDoc.setupDoneAt).toBe(A.store.householdDoc.setupDoneAt)
  })
})
