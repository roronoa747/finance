// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { monthPlan, myWeek, sectionWeek } from '@/lib/finance'
import { periodsOf, spendTotals } from '@/lib/statements/model'
import { money, plain } from '@/lib/money'
import { WEEK_VIEW_KEY } from '@/lib/storage'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import type { StatementUploadResponse } from '@/types/api'
import Statements from './Statements.vue'

// Чтение PDF подменено: экран получает готовый разбор (сам разбор — тесты парсеров).
const readResult = vi.hoisted(() => ({ value: { ok: [], errors: [] } as { ok: unknown[]; errors: { name: string; message: string; detail?: string }[] } }))
vi.mock('@/lib/statements/read', () => ({ readStatementFiles: vi.fn(async () => readResult.value) }))

/**
 * B2C-95 (Р-95, Р-96, Р-98, Р-100…Р-102): «План · Неделя» — только мои траты. Цифры экрана — из `myWeek` /
 * `sectionWeek` (компонент не считает); цифр партнёра нет — только ✓; ‹ › листают недели; вид ☰ / ▦ запоминается;
 * лист раздела — топ и операции; «Мои выписки» — свои загрузки; остаток раздела — тот же, что в «Месяце».
 *
 * Четверг 24 сентября 2026: W39 = 21–27 сентября, W38 = 14–20. Алихан (a): продукты W39 4 000 + 3 000 + 2 000 +
 * 1 500 + 1 000 + 500 = 12 000 (шесть операций), такси 5 000, цветы 9 000 (вне плана); W38 — продукты 20 000,
 * такси 5 000; раньше в сентябре — продукты 30 000. План Алихана: продукты 100 000, такси 11 000, кафе 40 000.
 * Дана (b): продукты W39 7 700 — на экране Алихана её цифр нет.
 */
let app: App | null = null
let n = 0
const op = (date: string, amount: number, categoryId: string | null, merchant: string): Operation => ({
  id: `o${++n}`, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId, internal: false,
})
const OPS: Operation[] = [
  op('2026-09-03', 30_000, 'sc_food', 'Magnum'),
  op('2026-09-15', 20_000, 'sc_food', 'Magnum'),
  op('2026-09-16', 5_000, 'sc_transport', 'Yandex Go'),
  op('2026-09-21', 4_000, 'sc_food', 'Magnum'),
  op('2026-09-22', 3_000, 'sc_food', 'Magnum'),
  op('2026-09-22', 2_000, 'sc_food', 'Small'),
  op('2026-09-23', 1_500, 'sc_food', 'Small'),
  op('2026-09-23', 1_000, 'sc_food', 'Базар'),
  op('2026-09-24', 500, 'sc_food', 'Magnum'),
  op('2026-09-22', 5_000, 'sc_transport', 'Yandex Go'),
  op('2026-09-23', 9_000, 'sc_fun', 'Цветы'),
]
const TOTALS: SpendTotal[] = [
  ...periodsOf(OPS).flatMap(({ kind, period }) => spendTotals(OPS, 'a', kind, period, '')),
  { id: 'b:week:2026-W39:sc_food', by: 'b', kind: 'week', period: '2026-W39', categoryId: 'sc_food', amount: 7_700, ops: 2, updatedAt: '' },
  { id: 'b:month:2026-09:sc_food', by: 'b', kind: 'month', period: '2026-09', categoryId: 'sc_food', amount: 61_000, ops: 9, updatedAt: '' },
]
const upload = (id: string, slot: 'a' | 'b', from: string, to: string, extra: Partial<StatementUploadResponse> = {}): StatementUploadResponse => ({
  id, slot, bank: 'kaspi', period_from: from, period_to: to, ops_count: 11, created_at: '2026-09-24T05:00:00Z', ...extra,
})
const BOTH = [upload('u1', 'a', '2026-09-01', '2026-09-24'), upload('u2', 'b', '2026-09-01', '2026-09-23', { bank: 'freedom', ops_count: 40 })]

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openWeek(o: { uploads?: StatementUploadResponse[]; plans?: boolean; slot?: 'a' | 'b' } = {}) {
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: o.uploads ?? BOTH })
  const pinia = createPinia()
  setActivePinia(pinia)
  const slot = o.slot ?? 'a'
  useAuthStore().setAuthData({
    token: 't', user: { id: `u-${slot}`, email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: `u-${slot}`, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [
    { id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' },
    { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: '' },
  ]
  finance.householdDoc.spendTotals = TOTALS
  if (o.plans !== false) {
    finance.householdDoc.spendPlans = [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 100_000, updatedAt: '' },
      { id: 'a:sc_transport', by: 'a', categoryId: 'sc_transport', amount: 11_000, updatedAt: '' },
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 40_000, updatedAt: '' },
    ]
  }
  const store = useOperationsStore()
  if (slot === 'a') for (const x of OPS) store.ops[x.id] = x
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/week')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Statements)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return { finance, store, router }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')
const flush = async () => {
  for (let i = 0; i < 6; i++) await nextTick()
  await Promise.resolve()
  for (let i = 0; i < 3; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const weekOf = (finance: ReturnType<typeof useFinanceStore>, week = '2026-W39') => {
  const { state, ctx } = finance.planInput('2026-09')
  return myWeek(state, { ...ctx, by: 'a', week, ops: OPS })
}
const row = (id: string) => q(`[data-row="${id}"]`)

describe('B2C-95: «План · Неделя» — мои траты', () => {
  it('сумма недели, сравнение и разделы — из myWeek; от большего к меньшему; цифр партнёра нет — только ✓', async () => {
    const { finance } = await openWeek()
    const w = weekOf(finance)
    // 12 000 + 5 000 + 9 000 = 26 000 против 25 000 прошлой: +4 %.
    expect(w).toMatchObject({ total: 26_000, prev: 25_000, pct: 4 })
    expect(txt(q('[data-week-label]'))).toBe('21–27 сентября')
    expect(txt(q('[data-week-total]'))).toBe(norm(money(w.total)))
    expect(txt(q('[data-week-delta]'))).toBe('↑ 4%')
    expect(txt(q('[data-week-prev]'))).toBe(norm(`прошлая неделя — ${money(25_000)}`))
    expect(all('[data-week-list] [data-row]').map((el) => [el.dataset.row, txt(el.querySelector('[data-amount]'))])).toEqual(
      w.rows.map((r) => [r.categoryId, norm(plain(r.amount))]),
    )
    expect(w.rows.map((r) => r.categoryId)).toEqual(['sc_food', 'sc_fun', 'sc_transport', 'sc_cafe'])
    // Стрелки к прошлой неделе: продукты меньше, цветы — новое, такси столько же, кафе без трат.
    expect(all('[data-row] [data-arrow]').map((el) => el.dataset.arrow)).toEqual(['down', 'up', 'same', ''])
    // Партнёр: его кружок с ✓, а 7 700 его продуктов нет ни в сумме, ни в строках.
    expect(q('[data-partner="b"]')!.dataset.uploaded).toBe('true')
    expect(txt(document.body)).not.toContain('7 700')
    expect(txt(document.body)).not.toContain(norm(money(33_700)))
    // Своя выписка есть — брендовой кнопки нет, «⊕» тихий; вопросов нет — значка «!» нет.
    expect(q('[data-upload]')!.dataset.upload).toBe('quiet')
    expect(all('button').filter((b) => b.className.includes('bg-brand '))).toHaveLength(0)
    expect(q('[data-bang]')).toBeNull()
  })

  it('остаток раздела — тот же, что в «Месяце» для этого участника (обе функции и экран); мало — цветом', async () => {
    const { finance } = await openWeek()
    const w = weekOf(finance)
    const { state, ctx } = finance.planInput('2026-09')
    const mine = monthPlan(state, ctx).spend.find((s) => s.by === 'a')!
    expect(mine.rows.length).toBe(3)
    for (const r of mine.rows) {
      const mineRow = w.rows.find((x) => x.categoryId === r.categoryId)!
      expect(mineRow.rest).toBe(r.plan - (r.fact ?? 0))
    }
    // Продукты: 100 000 − 62 000 = 38 000; такси: 11 000 − 10 000 = 1 000 — мало (< 15 %); кафе — весь план.
    expect(txt(row('sc_food')!.querySelector('[data-rest]'))).toBe(norm(`на сентябрь осталось ${plain(38_000)} из ${plain(100_000)}`))
    expect(txt(row('sc_transport')!.querySelector('[data-rest]'))).toBe(norm(`на сентябрь осталось ${plain(1_000)} из ${plain(11_000)}`))
    expect(row('sc_transport')!.querySelector('[data-rest] b')!.className).toContain('text-warn')
    expect(row('sc_food')!.querySelector('[data-rest] b')!.className).not.toContain('text-warn')
    expect(txt(row('sc_cafe')!.querySelector('[data-rest]'))).toBe(norm(`на сентябрь осталось ${plain(40_000)} из ${plain(40_000)}`))
    // Раздел не из плана — «вне плана», без полосы.
    expect(txt(row('sc_fun')!.querySelector('[data-rest]'))).toBe('вне плана')
  })

  it('‹ › листают недели: назад — пока есть свои траты, вперёд — не дальше текущей; прошлая неделя — остаток на её конец', async () => {
    const { finance } = await openWeek()
    const back = () => q<HTMLButtonElement>('button[aria-label="Прошлая неделя"]')!
    const forward = () => q<HTMLButtonElement>('button[aria-label="Следующая неделя"]')!
    expect(forward().disabled).toBe(true)
    await press(back())
    const prev = weekOf(finance, '2026-W38')
    expect(txt(q('[data-week-label]'))).toBe('14–20 сентября')
    expect(txt(q('[data-week-total]'))).toBe(norm(money(prev.total)))
    expect(prev.total).toBe(25_000)
    // Остаток продуктов на 20 сентября: 100 000 − (30 000 + 20 000) = 50 000 — траты после недели не вычтены.
    expect(txt(row('sc_food')!.querySelector('[data-rest]'))).toContain(norm(plain(50_000)))
    expect(forward().disabled).toBe(false)
    await press(back()) // W37 — трат нет
    await press(back()) // W36 — самая ранняя со своими тратами (3 сентября)
    expect(txt(q('[data-week-label]'))).toBe('31 августа – 6 сентября')
    expect(back().disabled).toBe(true)
    await press(forward())
    await press(forward())
    await press(forward())
    expect(txt(q('[data-week-label]'))).toBe('21–27 сентября')
    expect(forward().disabled).toBe(true)
  })

  it('вид ☰ / ▦ — плитки с тем же остатком; выбор запоминается на устройстве', async () => {
    await openWeek()
    expect(q('[data-week-list]')).not.toBeNull()
    await press(q('[data-view-toggle]'))
    expect(q('[data-week-list]')).toBeNull()
    expect(all('[data-week-tiles] [data-row]').map((el) => el.dataset.row)).toEqual(['sc_food', 'sc_fun', 'sc_transport', 'sc_cafe'])
    expect(txt(q('[data-week-tiles] [data-row="sc_food"] [data-rest]'))).toBe(norm(`· ост. ${plain(38_000)}`))
    expect(q('[data-week-tiles] [data-row="sc_food"] svg')).not.toBeNull()
    expect(q('[data-week-tiles] [data-row="sc_fun"] svg')).toBeNull()
    expect(q('[data-week-prev]')).toBeNull()
    expect(JSON.parse(localStorage.getItem(WEEK_VIEW_KEY)!)).toBe('tiles')
    // Открыли заново — плитки.
    app?.unmount()
    document.body.innerHTML = ''
    await openWeek()
    expect(q('[data-week-tiles]')).not.toBeNull()
    await press(q('[data-view-toggle]'))
    expect(JSON.parse(localStorage.getItem(WEEK_VIEW_KEY)!)).toBe('list')
  })

  it('нажатие раздела — лист: сумма, к прошлой, остаток, топ продавцов, операции по дням и «Ещё N»', async () => {
    const { finance } = await openWeek()
    await press(row('sc_food'))
    const d = sectionWeek(OPS, { week: '2026-W39', categoryId: 'sc_food' })
    const sheet = q('[role="dialog"]')!
    expect(txt(sheet)).toContain('Продукты')
    expect(txt(sheet.querySelector('[data-section-total]'))).toBe(norm(money(12_000)))
    const meta = txt(sheet.querySelector('[data-section-meta]'))
    expect(meta).toContain('21–27 сентября')
    expect(meta).toContain(norm(`↓ ${plain(8_000)} к прошлой`))
    expect(meta).toContain(norm(`на сентябрь осталось ${plain(weekOf(finance).rows[0]!.rest!)}`))
    // Топ: Magnum 4 000 + 3 000 + 500 = 7 500 (3 раза), Small 3 500 (2 раза), Базар 1 000.
    expect(d.tops).toEqual([{ name: 'Magnum', count: 3, amount: 7_500 }, { name: 'Small', count: 2, amount: 3_500 }, { name: 'Базар', count: 1, amount: 1_000 }])
    expect(txt(sheet.querySelector('[data-section-tops]'))).toBe(norm(`Magnum3 раза · ${plain(7_500)}Small2 раза · ${plain(3_500)}Базар1 раз · ${plain(1_000)}`))
    // Операции — первые пять по дням, шестая — за «Ещё 1 · 4 000 ₸».
    const ops = txt(sheet.querySelector('[data-section-ops]'))
    expect(ops).toContain('24 сентября, чт')
    expect(ops).toContain('23 сентября, ср')
    expect(ops).not.toContain('21 сентября')
    expect(txt(sheet.querySelector('[data-section-more]'))).toBe(norm(`Ещё 1 · ${money(4_000)}`))
    await press(sheet.querySelector<HTMLElement>('[data-section-more]'))
    expect(txt(q('[role="dialog"] [data-section-ops]'))).toContain('21 сентября, пн')
    expect(q('[data-section-more]')).toBeNull()
    // В листе — только чтение: кнопок действий нет.
    expect(all('[role="dialog"] button').filter((b) => b.className.includes('bg-brand '))).toHaveLength(0)
  })

  it('свой кружок — лист «Мои выписки»: только свои загрузки, банк, период, число операций и «+ Загрузить выписку»', async () => {
    await openWeek({ uploads: [...BOTH, upload('u0', 'a', '2026-08-25', '2026-08-31', { ops_count: 44, created_at: '2026-09-01T05:00:00Z' })] })
    await press(q('[data-my-uploads]'))
    const sheet = q('[role="dialog"]')!
    expect(txt(sheet)).toContain('Мои выписки')
    const rows = all('[role="dialog"] [data-upload]').map(txt)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('Kaspi')
    expect(rows[0]).toContain('1–24 сентября · 11 операций')
    expect(rows[0]).toContain('24 сентября')
    expect(rows[1]).toContain('25–31 августа · 44 операции')
    expect(txt(sheet)).not.toContain('Freedom')
    expect(all('[role="dialog"] button').some((b) => txt(b) === '+ Загрузить выписку')).toBe(true)
  })

  it('своей выписки за неделю нет — главное «Загрузить» (одна брендовая), свой кружок бледный; партнёр загрузил — у него ✓', async () => {
    await openWeek({ uploads: [BOTH[1]!] })
    expect(q('[data-my-uploads]')!.dataset.uploaded).toBe('false')
    expect(q('[data-partner="b"]')!.dataset.uploaded).toBe('true')
    const brand = all('button').filter((b) => b.className.includes('bg-brand '))
    expect(brand.map(txt)).toEqual(['Загрузить'])
    expect(q('[data-upload]')!.dataset.upload).toBe('lead')
  })

  it('плана трат нет — разделы без полос и остатка, тихая «План трат — в «Месяце»» ведёт в «Месяц»', async () => {
    const { router } = await openWeek({ plans: false })
    expect(all('[data-week-list] [data-row]').map((el) => el.dataset.row)).toEqual(['sc_food', 'sc_fun', 'sc_transport'])
    expect(q('[data-rest]')).toBeNull()
    expect(txt(document.body)).not.toContain('вне плана')
    await press(q('[data-to-plan]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/month'), { timeout: 10_000 })
  })

  it('тренд 8 недель — свёрнут; раскрытие — восемь столбцов, текущая неделя последней', async () => {
    await openWeek()
    expect(q('[data-trend-bars]')).toBeNull()
    await press(q('[data-week-trend] button'))
    expect(all('[data-trend-bars] > div')).toHaveLength(8)
    expect(txt(all('[data-trend-bars] > div').at(-1)!)).toContain('21.09')
    expect(txt(all('[data-trend-bars] > div').at(-1)!)).toContain('26к')
  })

  it('второй участник видит только своё: сумма — его итоги, операций и цифр первого нет', async () => {
    await openWeek({ uploads: [], slot: 'b', plans: false })
    // Дана: её итоги W39 — 7 700 (в документе), выписки за неделю нет.
    expect(txt(q('[data-week-total]'))).toBe(norm(money(7_700)))
    expect(q('[data-upload]')!.dataset.upload).toBe('lead')
    expect(txt(document.body)).not.toContain('12 000')
  })
})

/**
 * B2C-96 (Р-97): загрузка «сразу готово» — без сводки и «Отправить»: неделя показывает выписку сразу, тост
 * «Загружено N · Отменить»; «Отменить» возвращает как было; уход с экрана — отправка. Вопросы — только за «! N».
 */
describe('B2C-96: загрузка «сразу готово» и вопросы за «!»', () => {
  const NEW: Operation[] = [op('2026-09-22', 2_000, 'sc_cafe', 'Starbucks'), op('2026-09-23', 3_000, 'sc_cafe', 'Wolt')]
  const parsed = (operations: Operation[] = NEW) => ({ name: 'выписка.pdf', parsed: { bank: 'kaspi' as const, from: '2026-09-21', to: '2026-09-24', operations, skipped: 0 } })
  const pickFile = async () => {
    const input = q<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'выписка.pdf')] })
    input.dispatchEvent(new Event('change'))
    await flush()
    await flush()
  }
  const server = () => {
    const createStatementUpload = vi.spyOn(apiClient, 'createStatementUpload').mockResolvedValue({ id: 'up-1', slot: 'a', bank: 'kaspi', period_from: '2026-09-21', period_to: '2026-09-24', ops_count: 2, created_at: '2026-09-24T07:00:00Z' })
    const upsertOperations = vi.spyOn(apiClient, 'upsertOperations').mockResolvedValue({ upserted: 2 })
    return { createStatementUpload, upsertOperations }
  }

  it('выбрал файл — тост «Загружено N · Отменить» и неделя уже с выпиской; ничего не записано; «Отменить» возвращает как было', async () => {
    const api = server()
    // Своей выписки за неделю ещё нет (траты недели — из прошлой загрузки), партнёр загрузил.
    const { finance, store } = await openWeek({ uploads: [BOTH[1]!] })
    expect(q('[data-upload]')!.dataset.upload).toBe('lead')
    expect(txt(q('[data-week-total]'))).toBe(norm(money(26_000)))
    const before = JSON.stringify(finance.householdDoc.spendTotals)

    readResult.value = { ok: [parsed()], errors: [] }
    await pickFile()
    // Тост и «сразу готово»: +5 000 кафе, своя ✓, брендовой кнопки больше нет — без сводки и «Отправить».
    expect(txt(q('[data-toast]'))).toBe('Загружено 2 операцииОтменить')
    expect(txt(q('[data-week-total]'))).toBe(norm(money(31_000)))
    expect(txt(row('sc_cafe')!.querySelector('[data-amount]'))).toBe(norm(plain(5_000)))
    expect(q('[data-my-uploads]')!.dataset.uploaded).toBe('true')
    expect(q('[data-upload]')!.dataset.upload).toBe('quiet')
    expect(all('button').filter((b) => b.className.includes('bg-brand '))).toHaveLength(0)
    expect(txt(document.body)).not.toContain('Отправить')
    expect(txt(document.body)).not.toContain('Списания')
    // В документе и копии — как было; на сервер ничего не ушло.
    expect(store.held).toBe(true)
    expect(Object.keys(store.ops)).toHaveLength(OPS.length)
    expect(JSON.stringify(finance.householdDoc.spendTotals)).toBe(before)
    expect(api.createStatementUpload).not.toHaveBeenCalled()

    await press(q('[data-toast-action]'))
    expect(txt(q('[data-toast]'))).toBe('Отменено')
    expect(txt(q('[data-week-total]'))).toBe(norm(money(26_000)))
    expect(q('[data-upload]')!.dataset.upload).toBe('lead')
    expect(q('[data-my-uploads]')!.dataset.uploaded).toBe('false')
    expect(store.held).toBe(false)
    expect(store.draft).toBeNull()
    expect(store.pending).toEqual([])
    expect(JSON.stringify(finance.householdDoc.spendTotals)).toBe(before)
    expect(api.createStatementUpload).not.toHaveBeenCalled()
    expect(api.upsertOperations).not.toHaveBeenCalled()
  })

  it('пока висит тост, листы показывают то же, что экран: раздел — операции выписки, «Мои выписки» — её строку (критик)', async () => {
    server()
    const { store } = await openWeek({ uploads: [BOTH[1]!] })
    readResult.value = { ok: [parsed()], errors: [] }
    await pickFile()
    expect(store.held).toBe(true)
    await press(row('sc_cafe'))
    expect(txt(q('[data-section-total]'))).toBe(norm(money(5_000)))
    const ops = txt(q('[data-section-ops]'))
    expect(ops).toContain('Starbucks')
    expect(ops).toContain('Wolt')
    expect(txt(document.body)).not.toContain('За эту неделю трат нет')
    await press(q('[data-my-uploads]'))
    expect(all('[data-uploads] [data-upload]')).toHaveLength(1)
    expect(txt(q('[data-uploads]'))).toContain('2 операции')
    // Отмена — чтобы уход с экрана в конце теста ничего не отправил.
    store.undoUpload()
  })

  it('без отмены: ушли с экрана — выписка записана и отправлена, итоги недели в документе', async () => {
    const api = server()
    const { finance, store } = await openWeek({ uploads: [BOTH[1]!] })
    readResult.value = { ok: [parsed()], errors: [] }
    await pickFile()
    expect(store.held).toBe(true)
    app!.unmount()
    app = null
    await vi.waitFor(() => expect(api.upsertOperations).toHaveBeenCalledTimes(1))
    expect(store.held).toBe(false)
    expect(Object.keys(store.ops)).toHaveLength(OPS.length + 2)
    expect(api.createStatementUpload).toHaveBeenCalledWith({ bank: 'kaspi', period_from: '2026-09-21', period_to: '2026-09-24', ops_count: 2 })
    expect(finance.householdDoc.spendTotals!.find((t) => t.id === 'a:week:2026-W39:sc_cafe')?.amount).toBe(5_000)
  })

  it('те же операции второй раз — «Эти N операций уже были», суммы не удваиваются', async () => {
    server()
    const { store } = await openWeek()
    readResult.value = { ok: [parsed(OPS.slice(3, 5))], errors: [] }
    await pickFile()
    expect(txt(q('[data-toast]'))).toBe('Эти 2 операции уже былиОтменить')
    expect(txt(q('[data-week-total]'))).toBe(norm(money(26_000)))
    store.undoUpload()
  })

  it('файл не прочитан — тихий лист «Не прочитано» с именем и причиной, без брендовой кнопки и без тоста', async () => {
    const { store } = await openWeek()
    readResult.value = { ok: [], errors: [{ name: 'чек.pdf', message: 'Пока понимаю выписки Kaspi и Freedom' }] }
    await pickFile()
    const sheet = q('[role="dialog"]')!
    expect(txt(sheet)).toContain('Не прочитано')
    expect(txt(sheet.querySelector('[data-read-error]'))).toBe('чек.pdfПока понимаю выписки Kaspi и Freedom')
    expect(all('[role="dialog"] button').filter((b) => b.className.includes('bg-brand '))).toHaveLength(0)
    expect(q('[data-toast]')).toBeNull()
    expect(store.held).toBe(false)
  })

  it('«! N» — число вопросов; лист — по одному с «N из M»; «Потом» откладывает; вопросов нет — значка нет', async () => {
    vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
    const { finance, store } = await openWeek()
    expect(q('[data-bang]')).toBeNull()
    // Незнакомый продавец и подписка без ответа — два вопроса.
    store.ops.u1 = { ...op('2026-09-22', 7_500, null, 'ИП ЖАНСАЯ'), id: 'u1' }
    finance.householdDoc.obligations = [{ id: 'nf', name: 'Netflix', note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 4_990 }], updatedAt: '' }]
    await flush()
    expect(txt(q('[data-bang]'))).toBe('!2')
    expect(q('[data-bang]')!.getAttribute('aria-label')).toBe('Вопросы: 2')
    // На экране вопросов нет — только в листе.
    expect(txt(document.body)).not.toContain('Без раздела')
    await press(q('[data-bang]'))
    const sheet = () => txt(q('[role="dialog"]'))
    expect(sheet()).toContain('Вопросы')
    expect(sheet()).toContain('1 из 2')
    expect(sheet()).toContain('Без раздела · 1')
    expect(sheet()).not.toContain('Оставить подписку')
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Потом'))
    expect(sheet()).toContain('2 из 2')
    expect(sheet()).toContain('Оставить подписку Netflix?')
    expect(txt(q('[data-bang]'))).toBe('!1')
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Оставить'))
    expect(q('[role="dialog"]')).toBeNull()
    expect(q('[data-bang]')).toBeNull()
  })
})
