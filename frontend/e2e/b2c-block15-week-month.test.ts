import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { ApiClient } from '../src/api/client'
import { myWeek, type Decision } from '../src/lib/finance'
import { weekKey } from '../src/lib/dates'
import { money, plain } from '../src/lib/money'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { readPlanView, readWeekView } from '../src/lib/storage'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Obligation, SyncDoc } from '../src/types/finance'
import AppShell from '../src/components/AppShell.vue'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import Statements from '../src/views/Statements.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, tapPay, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 15 «Неделя и Месяц» (B2C-98): два телефона и viewer на фейковом сервере, понедельник 12 октября 2026
 * (неделя 12–18, прошлая — 5–11). Ильяс 700 000 (10-го, пришла по выписке, не отложена), Аруна 500 000 (20-го, ждём).
 * Платежи: аренда 220 000 (5-го), кредит 58 000, кредитка 25 000, рассрочка 20 000; подписки — Netflix 4 500 (8-го),
 * Spotify 2 990 (14-го, «оставить?» ещё не отвечали), iCloud 1 490 (20-го). План трат: Ильяс — продукты 150 000,
 * кафе 40 000; Аруна — продукты 100 000. Очередь: «Отпуск» 40 000 → «Машина» 60 000 → «Подушка» 30 000.
 * Нажатия — методами экранов и стора (SSR, `screen`); браузер — на стенде.
 *
 * Выписка Ильяса 1–12 октября:
 *   06.10 Magnum 30 000 (продукты) · 07.10 Del Papa Cafe 10 000 (кафе) · 08.10 Netflix 4 500 (подписки — платёж)
 *   12.10 Magnum 12 000 (продукты) · 12.10 Coffee Boom 3 500 (кафе) · 12.10 ИП Абенова 7 000 (без раздела)
 * Неделя 12–18:   12 000 + 3 500 + 7 000 = 22 500; прошлая 30 000 + 10 000 = 40 000 (подписка — платёж, не трата недели)
 * Остаток до конца октября: продукты 150 000 − 42 000 = 108 000; кафе 40 000 − 13 500 = 26 500
 * (суммы операций — вне допуска ±2 % подписок: 3 000 у кофейни стало бы вопросом «это платёж по Spotify?»)
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  return { pinia, client, store }
}

async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
    await useOperationsStore().loadUploads(p.client)
  }
}

const K = '2026-10'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
/** Кусок разметки от первого `from` до следующего `to`. */
const between = (html: string, from: string, to: string) => {
  const i = html.indexOf(from)
  if (i < 0) return ''
  const j = html.indexOf(to, i + from.length)
  return html.slice(i, j < 0 ? undefined : j)
}

const sub = (id: string, name: string, amount: number, day: number, keptAt?: string): Obligation =>
  ({ id, name, note: '', day, category: 'd4', versions: [{ from: '2000-01', amount }], ...(keptAt ? { keptAt } : {}), updatedAt: T0 }) as Obligation

function familyDoc(): SyncDoc {
  const base = planFamilyDoc()
  const kept = '2026-10-01T06:00:00.000Z'
  return {
    ...base,
    obligations: [...base.obligations, sub('netflix', 'Netflix', 4_500, 8, kept), sub('spotify', 'Spotify', 2_990, 14), sub('icloud', 'iCloud', 1_490, 20, kept)],
    goals: base.goals.map((g) => (g.id === 'trip' ? { ...g, monthly: 40_000 } : g)),
    spendPlans: [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 40_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 },
    payments: [
      { id: 'sal-a', kind: 'salary', targetId: 'a', period: K, amount: 700_000, accountId: 'card', by: 'a', source: 'statement', opId: 'op-a', at: '2026-10-10T05:00:00.000Z', updatedAt: '2026-10-10T05:00:00.000Z' },
    ],
  }
}

const op = (date: string, amount: number, merchant: string, categoryId: string | null): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
})
const statementA = (): ParsedStatement => ({
  bank: 'kaspi', from: '2026-10-01', to: '2026-10-12', skipped: 0,
  operations: assignIds([
    op('2026-10-06', -30_000, 'Magnum', 'sc_food'),
    op('2026-10-07', -10_000, 'Del Papa Cafe', 'sc_cafe'),
    op('2026-10-08', -4_500, 'Netflix', 'sc_subscriptions'),
    op('2026-10-12', -12_000, 'Magnum', 'sc_food'),
    op('2026-10-12', -3_500, 'Coffee Boom', 'sc_cafe'),
    op('2026-10-12', -7_000, 'ИП Абенова', null),
  ]),
})

/** «Неделя» телефона; `state` — поля экрана (вид, лист, неделя), `act` — нажатие. */
const week = (p: Phone, state: Record<string, unknown> = {}, act?: (s: Record<string, unknown>) => void) =>
  screen(p.pinia, Statements, '/week', undefined, [screenMixin(state, act)])
const month = (p: Phone, state: Record<string, unknown> = {}, path = '/month') => screen(p.pinia, Month, path, undefined, [screenMixin(state)])

describe('e2e / B2C Блок 15 — «Неделя» и «Месяц» на двух телефонах и у viewer', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** Ильяс загрузил выписку и дождался, пока тост уйдёт. */
  async function uploaded(A: Phone) {
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'a.pdf', parsed: statementA() }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await A.store.syncHousehold(A.client)
    return ops
  }

  it('часть 1 — вкладка «План»: память вида на устройстве, точка «Месяца», старые адреса; viewer — только «Месяц»', async () => {
    const A = await phone(server, st, 'a')
    // По умолчанию «План» открывает «Неделю»; зарплата Ильяса пришла и не отложена — точка на «Месяце» и на вкладке.
    expect(readPlanView()).toBe('week')
    const shell = await screen(A.pinia, AppShell, '/')
    expect(shell).toMatch(/href="\/week"[^>]*>(?:(?!<\/a>)[\s\S])*План/)
    expect(A.store.planCall()).toBe(K)
    expect(await week(A)).toContain('data-plan-dot')

    // Перешёл на «Месяц» переключателем — выбор запомнен: вкладка ведёт в «Месяц».
    await week(A, {}, (s) => (s.toMonth as () => void)())
    expect(readPlanView()).toBe('month')
    expect(await screen(A.pinia, AppShell, '/')).toMatch(/href="\/month"[^>]*>(?:(?!<\/a>)[\s\S])*План/)

    // Старые адреса (Р-103) — редиректами.
    setActivePinia(A.pinia)
    const router = createAppRouter(createMemoryHistory())
    for (const [from, to] of [
      ['/money?month=2026-09', '/month?month=2026-09'],
      ['/money/plan', '/money/debts'],
      ['/plan', '/money/debts'],
      ['/statements', '/week'],
      ['/week/salary?from=salary&person=a&period=2026-10', '/month'],
      ['/week/breakdown', '/month'],
    ]) {
      await router.push('/')
      await router.push(from)
      expect(router.currentRoute.value.fullPath, from).toBe(to)
    }

    // Viewer (Р-104): «Недели» нет — «План» это «Месяц», без переключателя.
    const V = await phone(server, st, 'a', 'viewer')
    setActivePinia(V.pinia)
    const routerV = createAppRouter(createMemoryHistory())
    await routerV.push('/week')
    expect(routerV.currentRoute.value.fullPath).toBe('/month')
    expect(await screen(V.pinia, AppShell, '/')).toMatch(/href="\/month"[^>]*>(?:(?!<\/a>)[\s\S])*План/)
    expect(await month(V)).not.toContain('data-plan-view')
  })

  it('часть 2 — «Неделя»: только мои траты — сумма, сравнение, остаток до конца месяца; оба вида, лист раздела, ‹ ›, «Мои выписки»; у партнёра — только ✓', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    // Выписки нет — главное действие одно: «Загрузить».
    const empty = await week(A)
    expect(empty).toContain('data-upload="lead"')
    expect(text(empty)).toContain(sp(money(0)))

    const ops = await uploaded(A)
    await sync(A, B)

    // Числа экрана — из `myWeek` (одна дорога с «Месяцем»), сверены с ручным расчётом в шапке файла.
    setActivePinia(A.pinia)
    const { state, ctx } = A.store.planInput(K)
    const mine = myWeek(state, { ...ctx, uploads: ops.uploads, by: 'a', week: weekKey(), ops: ops.all })
    expect(mine).toMatchObject({ total: 22_500, prev: 40_000 })
    expect(mine.rows.map((r) => [r.categoryId, r.amount, r.rest])).toEqual([['sc_food', 12_000, 108_000], ['_unknown', 7_000, null], ['sc_cafe', 3_500, 26_500]])

    const list = await week(A)
    expect(list).not.toContain('data-upload="lead"')
    expect(text(between(list, 'data-week-total', '</span>'))).toContain(sp(money(22_500)))
    expect(text(between(list, 'data-week-prev', '</span>'))).toContain(`прошлая неделя — ${sp(money(40_000))}`)
    const food = text(between(list, 'data-row="sc_food"', '</button>'))
    expect(food).toContain(`Продукты`)
    expect(food).toContain(`на октябрь осталось ${sp(plain(108_000))} из ${sp(plain(150_000))}`)
    expect(text(between(list, 'data-row="sc_cafe"', '</button>'))).toContain(`осталось ${sp(plain(26_500))} из ${sp(plain(40_000))}`)
    // Платёж (подписка) — не трата недели; цифр партнёра нет.
    expect(list).not.toContain('data-row="sc_subscriptions"')
    expect(list).toMatch(/data-uploaded="true"[^>]*data-my-uploads|data-my-uploads[^>]*data-uploaded="true"/)
    expect(list).toMatch(/data-uploaded="false" data-partner="b"/)

    // Вид плитками — те же остатки; выбор запомнен на устройстве.
    await week(A, {}, (s) => (s.toggleView as () => void)())
    expect(readWeekView()).toBe('tiles')
    const tiles = await week(A)
    expect(tiles).toContain('data-week-tiles')
    expect(tiles).not.toContain('data-week-list')
    expect(text(between(tiles, 'data-row="sc_food"', '</button>'))).toContain(`ост. ${sp(plain(108_000))}`)

    // Лист раздела: сумма недели, продавцы и операции.
    const sheet = text(await week(A, { sectionFor: 'sc_food' }))
    expect(sheet).toContain(sp(money(12_000)))
    expect(between(sheet, 'Продукты', 'Вопросы')).toContain('Magnum')

    // ‹ — прошлая неделя: её сумма; дальше назад своих трат нет.
    const prev = await week(A, {}, (s) => (s.turn as (n: number) => void)(-1))
    expect(text(between(prev, 'data-week-total', '</span>'))).toContain(sp(money(40_000)))
    expect(prev).toMatch(/disabled[^>]*aria-label="Прошлая неделя"|aria-label="Прошлая неделя"[^>]*disabled/)

    // «Мои выписки» — свой кружок: банк, период, число операций.
    const mineUploads = text(await week(A, { uploadsOpen: true }))
    expect(mineUploads).toContain('Мои выписки')
    expect(mineUploads).toContain('6 операций')

    // Аруна: сумм Ильяса нет ни на «Неделе», ни в листах — только его ✓; её главное — «Загрузить».
    const weekB = await week(B)
    expect(weekB).toMatch(/data-uploaded="true" data-partner="a"/)
    expect(weekB).toContain('data-upload="lead"')
    for (const n of [22_500, 12_000, 7_000, 40_000]) expect(text(weekB)).not.toContain(sp(plain(n)))
    // Его траты она видит в «Месяце» — факт рядом с планом.
    const spendB = text(between(await month(B, { opened: 'spend' }), 'data-spend="a"', 'data-spend="b"'))
    expect(spendB).toContain(`${sp(plain(42_000))} из ${sp(plain(150_000))}`)
  })

  it('часть 3 — загрузка «сразу готово»: тост «Загружено N · Отменить», неделя уже с выпиской; «Отменить» — как было; без отмены — записано и видно партнёру', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    setActivePinia(A.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'a.pdf', parsed: statementA() }], A.client)

    // Тост висит: экран уже показывает выписку, но ничего не записано и не отправлено.
    const held = await week(A)
    expect(text(held)).toContain('Загружено 6 операций')
    expect(held).toMatch(/>\s*Отменить\s*</)
    expect(text(between(held, 'data-week-total', '</span>'))).toContain(sp(money(22_500)))
    expect(held).not.toContain('Отправить')
    // Вопрос о подписке был и до выписки; вопросы о самой выписке — после отправки.
    expect(held).toContain('aria-label="Вопросы: 1"')
    expect(ops.all).toHaveLength(0)
    expect(A.store.householdDoc.spendTotals ?? []).toHaveLength(0)
    expect(A.client.upsertOperations).not.toHaveBeenCalled()

    // «Отменить» — как было: пустая неделя и снова «Загрузить».
    await week(A, {}, (s) => (s.undo as () => void)())
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    const undone = await week(A)
    expect(text(between(undone, 'data-week-total', '</span>'))).toContain(sp(money(0)))
    expect(undone).toContain('data-upload="lead"')
    expect(ops.all).toHaveLength(0)
    expect(st.uploads).toHaveLength(0)
    expect(A.client.upsertOperations).not.toHaveBeenCalled()

    // Без отмены: тост ушёл — записано, отправлено, итоги — в документе семьи.
    await ops.upload([{ name: 'a.pdf', parsed: statementA() }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    expect(ops.all).toHaveLength(6)
    expect(st.uploads).toHaveLength(1)
    expect(text(await week(A))).not.toContain('Загружено')
    await sync(A, B)
    expect(await week(B)).toMatch(/data-uploaded="true" data-partner="a"/)

    // Та же выписка второй раз — «уже были», суммы не удваиваются.
    setActivePinia(A.pinia)
    await ops.upload([{ name: 'a.pdf', parsed: statementA() }], A.client)
    const again = await week(A)
    expect(text(again)).toContain('Эти 6 операций уже были')
    expect(text(between(again, 'data-week-total', '</span>'))).toContain(sp(money(22_500)))
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    expect(ops.all).toHaveLength(6)
  })

  it('часть 4 — «! N»: вопросы только в листе, по одному — платёж из выписки, продавец, «оставить подписку?»; ответ «да» ставит ✓ в «Месяце» у обоих', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    await uploaded(A)

    // На самой «Неделе» вопросов нет — только значок с числом.
    let queue: Decision[] = []
    const closed = await week(A, {}, (s) => void (queue = [...(s.queue as Decision[])]))
    expect(queue.map((d) => d.kind)).toEqual(['match', 'unknownBatch', 'keep'])
    expect(closed).toContain('aria-label="Вопросы: 3"')
    for (const t of ['Похоже, это платёж', 'Без раздела', 'Оставить подписку']) expect(closed).not.toContain(t)

    // Лист — первый вопрос и «1 из 3».
    const first = text(await week(A, { questionsOpen: true }))
    expect(first).toContain('Похоже, это платёж по Netflix — отметить?')
    expect(first).toContain('1 из 3')
    expect(first).not.toContain('Без раздела · 1')

    // «Да, отметить» — отметка «из выписки» без списания со счёта; дальше — продавец.
    const card = A.store.accounts.find((x) => x.id === 'card')!.amount
    const second = text(await week(A, { questionsOpen: true }, (s) => (s.onPrimary as (d: Decision) => void)((s.queue as Decision[])[0])))
    await vi.advanceTimersByTimeAsync(0)
    setActivePinia(A.pinia)
    expect(A.store.payments.find((p) => p.targetId === 'netflix' && !p.deletedAt)).toMatchObject({ period: K, amount: 4_500, source: 'statement' })
    expect(A.store.accounts.find((x) => x.id === 'card')!.amount).toBe(card)
    expect(second).not.toContain('Похоже, это платёж')
    expect(text(await week(A, { questionsOpen: true }))).toContain('Без раздела · 1')

    // «Потом» — вопрос уходит до следующего открытия экрана; следующий — подписка.
    let left: string[] = []
    await week(A, { questionsOpen: true }, (s) => {
      ;(s.defer as (d: Decision) => void)((s.queue as Decision[])[0])
      left = (s.queue as Decision[]).map((d) => d.kind)
    })
    expect(left).toEqual(['keep'])

    // У обоих: в «Месяце» подписка Netflix с ✓, группа «1 из 3 списались».
    await sync(A, B)
    for (const p of [A, B]) {
      const dues = await month(p, { opened: 'dues', subsOpen: true })
      expect(text(between(dues, 'data-subs-status', '</span>'))).toContain('1 из 3 списались')
      expect(text(between(dues, 'data-due-id="obligation:netflix"', '</div>'))).toContain(`✓ ${sp(plain(4_500))}`)
    }
    // Аруна про продавцов Ильяса не спрашивается — её лист «!» о них молчит.
    let queueB: Decision[] = []
    await week(B, {}, (s) => void (queueB = [...(s.queue as Decision[])]))
    expect(queueB.map((d) => d.kind)).toEqual(['keep'])
  })

  it('часть 5 — «Месяц»: подписки одной строкой, «Оплатил» нажатием платежа, ✓ зарплаты и «Отложил всё»; точка гаснет, когда дел нет', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')

    // Подписки — одной строкой «Подписки · 3» с суммой; раскрытие — поштучно.
    const dues = await month(A, { opened: 'dues' })
    const subs = text(between(dues, 'data-subs', 'data-due-id="credit:loan"'))
    expect(subs).toContain('Подписки · 3')
    expect(subs).toContain('0 из 3 списались')
    expect(subs).toContain(sp(plain(4_500 + 2_990 + 1_490)))
    expect(dues).not.toContain('data-due-id="obligation:netflix"')
    expect(await month(A, { opened: 'dues', subsOpen: true })).toContain('data-due-id="obligation:spotify"')

    // Нажатие платежа — лист с одной кнопкой «Оплатил»; первая оплата — выбор счёта (`MarkSheet`), дальше — сразу.
    const sheet = await month(A, { opened: 'dues', payFor: 'obligation:rent' })
    expect(sheet).toMatch(/data-pay[^>]*>\s*Оплатил/)
    expect(sheet).not.toContain('data-unpay')
    setActivePinia(A.pinia)
    A.store.markPaid('obligation', 'rent', 'a', { period: '2026-09', accountId: 'card', at: '2026-09-05T05:00:00.000Z' })
    await screen(A.pinia, Month, '/month', undefined, [tapPay('rent')])
    expect(A.store.payments.find((p) => p.targetId === 'rent' && p.period === K && !p.deletedAt)).toMatchObject({ amount: 220_000, accountId: 'card', by: 'a' })
    await sync(A, B)
    for (const p of [A, B]) {
      const paid = await month(p, { opened: 'dues' })
      expect(text(between(paid, 'data-due-id="obligation:rent"', 'data-due-id'))).toContain(`✓ ${sp(plain(220_000))}`)
      expect(text(between(paid, 'data-section="dues"', '</button>'))).toContain('1 из 7 оплачено')
    }
    // «Не оплачено» — в том же листе, тихо.
    expect(await month(A, { opened: 'dues', payFor: 'obligation:rent' })).toContain('data-unpay')

    // Зарплата Ильяса пришла (✓ у суммы), Аруны — ждём; не отложено — «Отложил всё» в разделе целей и точка.
    const top = await month(A)
    expect(text(between(top, 'data-salary="a"', 'data-salary="b"'))).toContain(`✓ ${sp(money(700_000))}`)
    expect(text(between(top, 'data-salary="b"', 'data-sections'))).toContain('ждём 20 октября')
    expect(top).toContain('data-section-dot')
    const queue = await month(A, { opened: 'queue' })
    expect(text(between(queue, 'data-put-all', '</button>'))).toContain(`Отложил всё · ${sp(money(130_000))}`)

    // «Отложил всё» — взносы целям, ✓ у сумм; дел не осталось — точки нет ни в «Месяце», ни на «Неделе».
    await screen(A.pinia, Month, '/month', undefined, [screenMixin({}, (s) => (s.savePuts as (list: unknown) => void)(s.pending))])
    setActivePinia(A.pinia)
    expect(A.store.goals.find((g) => g.id === 'trip')!.have).toBe(50_000 + 40_000)
    expect(A.store.planCall()).toBeNull()
    const done = await month(A, { opened: 'queue' })
    expect(done).not.toContain('data-put-all')
    expect(done.match(/data-put-done/g)).toHaveLength(3)
    expect(done).not.toContain('data-section-dot')
    expect(await week(A)).not.toContain('data-plan-dot')
    await sync(A, B)
    expect((await month(B, { opened: 'queue' })).match(/data-put-done/g)).toHaveLength(3)
  })

  it('часть 6 — «Деньги» без месячного: Капитал · Долги · История, платежи справочником, подписки строкой; viewer — без действий', async () => {
    const A = await phone(server, st, 'a')
    setActivePinia(A.pinia)
    A.store.markPaid('obligation', 'rent', 'a', { accountId: 'card' })

    const capital = await screen(A.pinia, Money, '/money')
    const seen = text(capital)
    for (const t of ['Капитал', 'Долги', 'История', 'Kaspi Gold', 'Аренда', 'Подписки · 3']) expect(seen).toContain(t)
    // Ни плана месяца, ни отметок, ни «Оплатил», ни зарплат — это «Месяц».
    for (const t of ['Оплатил', 'оплачено', 'До зарплаты', 'Остаётся', 'Отложил', 'Пришла', 'нагрузка', 'Подробнее']) expect(seen).not.toContain(t)
    for (const a of ['data-rest', 'data-sections', 'data-salary', 'data-plan-view']) expect(capital).not.toContain(a)
    expect(capital).not.toContain('Netflix')
    expect(await screen(A.pinia, Money, '/money', undefined, [screenMixin({ subsOpen: true })])).toContain('Netflix')
    // «Долги» — долговой план по своему адресу.
    expect(text(await screen(A.pinia, Money, '/money/debts'))).toContain('Копить или гасить?')

    const V = await phone(server, st, 'a', 'viewer')
    for (const path of ['/money', '/money/debts', '/money/history']) {
      const html = await screen(V.pinia, Money, path)
      expect(html, path).not.toMatch(/>\s*(<svg[\s\S]*?<\/svg>\s*)?Добавить( счёт)?\s*</)
      expect(html, path).not.toMatch(/>\s*Оплатил\s*</)
    }
    // Viewer в «Месяце»: всё видно, нажать нечего.
    const monthV = await month(V, { opened: 'queue' })
    expect(text(monthV)).toContain('Отпуск')
    for (const a of ['data-put-all', 'data-extra-income', 'role="switch"']) expect(monthV).not.toContain(a)
    expect(await month(V, { opened: 'dues', payFor: 'obligation:rent' })).not.toContain('data-pay')
  })
})
