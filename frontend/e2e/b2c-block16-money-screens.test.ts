import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { debtsOverview, historyMonths, monthPlanPast } from '../src/lib/finance'
import { money, plain } from '../src/lib/money'
import { monthBy } from '../src/lib/dates'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Payment, SyncDoc } from '../src/types/finance'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import DebtFaster from '../src/views/DebtFaster.vue'
import { at, backend, fakeServer, screen, type FakeServer } from './support/family'

/**
 * Блок 16 «Деньги по макету» (B2C-103): два телефона и viewer на фейковом сервере, 12 сентября 2026.
 * Kaspi Gold 2 000 000; «Подушка» 400 000 лежит на Kaspi Gold, «Отпуск» 50 000 и «Машина» 200 000 — вне счетов.
 * Кредиты: кредит 1 000 000, кредитка 300 000, рассрочка 240 000 (базы — до отметок, без сверки). Июль и август:
 * зарплата Ильяса 700 000 на карту, аренда 220 000, кредитка 25 000 (тело 15 000 — проценты 10 000).
 *   Кредитка: 300 000 − 15 000 × 2 = 270 000; полоса 30 000 / 300 000 = 10 %. Долги: 1 000 000 + 270 000 + 240 000 =
 *   1 510 000. Счета: 2 000 000 + 250 000 = 2 250 000 (отметки до сверки 1 сентября карту не двигают); капитал 740 000.
 *   Месяцы «Истории»: август и июль — 700 000 − 220 000 − 25 000 = 455 000 «осталось», отложили 0.
 * Нажатия — методами экранов (SSR, `screen`); браузер — на стенде.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  return { pinia, client, store }
}
async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
  }
}

const K = '2026-09'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
/** Сумма после атрибута `data-…>` в разметке: «2 250 000 ₸» → 2250000. */
const amountAt = (html: string, attr: string) => {
  const m = html.match(new RegExp(`${attr}[^>]*>([^<]*)<`))
  if (!m) throw new Error(`нет ${attr}`)
  return (/[−-]/.test(m[1]) ? -1 : 1) * Number(m[1].replace(/\D/g, ''))
}
/** Открытые подсказки `Hint` (в SSR текст подсказки есть только у открытой). */
const hintsOpen = () => screenMixin({ at: { left: 0, top: 0, width: 300 } })
/** «Что такое капитал»: «Счета и цели — N, долги — M.» (Р-116: итоги «Счета»/«Кредиты» переехали в подсказку). */
const worthParts = (html: string) => {
  const m = text(html).match(/Счета и цели — ([^,]+), долги — ([^.]+)\./)
  if (!m) throw new Error('нет подсказки «Что такое капитал»')
  return { assets: Number(m[1].replace(/\D/g, '')), debt: Number(m[2].replace(/\D/g, '')) }
}
const mark = (kind: Payment['kind'], targetId: string, period: string, amount: number, extra: Partial<Payment> = {}): Payment => ({
  id: `${kind}-${targetId}-${period}`, kind, targetId, period, amount, accountId: 'card', by: 'a', at: `${period}-10T05:00:00.000Z`, updatedAt: T0, ...extra,
})

function familyDoc(): SyncDoc {
  const doc = planFamilyDoc()
  const months = ['2026-07', '2026-08']
  return planFamilyDoc({
    goals: doc.goals.map((g) => (g.id === 'cushion' ? { ...g, accountId: 'card' } : g)),
    credits: doc.credits.map((c) => ({ ...c, principalSetAt: null })),
    payments: months.flatMap((p) => [
      mark('salary', 'a', p, 700_000),
      mark('obligation', 'rent', p, 220_000, { by: 'b' }),
      mark('credit', 'cc', p, 25_000, { principal: 15_000 }),
    ]),
  })
}

let server: FakeServer
const storage = new Map<string, string>()

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  vi.useFakeTimers()
  at('2026-09-12T07:00:00Z')
  server = fakeServer(familyDoc())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('e2e / B2C Блок 16 — «Деньги» по макету на двух телефонах и у viewer', () => {
  it('часть 1 — «Капитал»: «Счета и цели» − «долги» (подсказка) = «Капитал»; «Цели · N» — подушка на счёте вне суммы; зарплата → лист → «Пришла» — у партнёра ✓ в «Месяце»', async () => {
    const A = await phone(server, 'a')
    const B = await phone(server, 'b')
    const html = await screen(A.pinia, Money, '/money', undefined, [screenMixin({ goalsOpen: true }), hintsOpen()])
    // Итогов у заголовков «Счета» / «Кредиты» нет — оба числа в подсказке «Что такое капитал» у суммы (Р-116).
    expect(html).not.toContain('data-accounts-total')
    expect(html).not.toContain('data-credits-total')
    const { assets, debt } = worthParts(html)
    expect(assets).toBe(2_250_000)
    expect(debt).toBe(1_510_000)
    expect(amountAt(html, 'data-worth')).toBe(740_000)
    expect(assets - debt).toBe(amountAt(html, 'data-worth'))
    const seen = text(html)
    expect(seen).toContain(`Цели · 2 ${money(250_000)}`)
    expect(seen).toContain('Подушка на Kaspi Gold — уже в счёте')
    // Зарплаты для справки: дата — в листе зарплаты (Р-116). Ильяс ждём 10-го (день прошёл — «Пришла» можно), Аруна ждём 20-го.
    expect(seen).not.toContain('ждём')
    const status = async (p: Phone, person: 'a' | 'b') =>
      text((await screen(p.pinia, Money, '/money', undefined, [screenMixin({ open: person })])).match(/data-salary-status[\s\S]*?<\/div>/)?.[0] ?? '')
    expect(await status(A, 'a')).toContain('ждём 10 сентября')
    expect(await status(A, 'b')).toContain('ждём 20 сентября')

    // Строка Ильяса → лист зарплаты (тот же, что в «Месяце») → «Пришла зарплата»: одним нажатием на карту прошлого раза.
    const sheet = await screen(A.pinia, Money, '/money', undefined, [screenMixin({ open: 'a' })])
    expect(text(sheet)).toContain('Зарплата · Ильяс')
    await screen(A.pinia, Money, '/money', undefined, [screenMixin({ open: 'a' }), screenMixin({}, (s) => (s.tap as () => void)())])
    setActivePinia(A.pinia)
    const came = A.store.payments.filter((p) => p.kind === 'salary' && p.period === K && !p.deletedAt)
    expect(came).toEqual([expect.objectContaining({ targetId: 'a', amount: 700_000, accountId: 'card', by: 'a' })])

    await sync(A, B)
    const month = await screen(B.pinia, Month, '/month')
    expect(month).toMatch(/data-salary="a"[\s\S]*?data-came/)
    // У Аруны строка Ильяса — с ✓, дата прихода — в листе его зарплаты.
    expect(await screen(B.pinia, Money, '/money')).toMatch(/data-salary="a"(?:(?!data-salary="b")[\s\S])*data-came/)
    expect(await status(B, 'a')).toContain('пришла 12 сентября')
  })

  it('часть 2 — «Долги»: сумма и «без долгов — к», полоса у кредитки, расчёт — своим экраном «Закрыть быстрее», «Шаг сделан» нет', async () => {
    const B = await phone(server, 'b')
    const html = await screen(B.pinia, Money, '/money/debts')
    setActivePinia(B.pinia)
    const o = debtsOverview({ ...B.store.planState(), plans: B.store.plans }, K)
    expect(o.total).toBe(1_510_000)
    expect(amountAt(html, 'data-debts-total')).toBe(o.total)
    expect(text(html)).toContain(`без долгов — ${monthBy(o.freeMonth!, K)}`)
    expect(o.rows.find((r) => r.creditId === 'cc')!.paidShare).toBe(0.1)
    expect(html).toMatch(/data-debt="cc"[\s\S]*?data-debt-bar[\s\S]*?width:10%/)
    expect(html).not.toMatch(/data-debt="loan"[^]*?data-debt-bar[^]*?data-debt="cc"/)
    // Б17: расчёт не раскрывашкой на «Долгах», а ссылкой на экран «Закрыть быстрее»; там «Подробнее» свёрнуто.
    expect(html).toMatch(/<a[^>]*href="\/money\/debts\/faster"[^>]*data-debts-calc[^>]*>\s*Как закрыть быстрее/)
    expect(html).not.toContain('data-plan-main')
    const faster = await screen(B.pinia, DebtFaster, '/money/debts/faster')
    expect(faster).toContain('data-plan-main')
    expect(faster).toMatch(/<details(?![^>]*\sopen)[^>]*data-plan-more/)
    expect(text(html)).not.toContain('Шаг сделан')
    expect(html).toContain('data-add-credit')
  })

  it('часть 3 — «История»: месяцы = сводка «Месяца» того же месяца; лента — под «Все записи»', async () => {
    const A = await phone(server, 'a')
    const html = await screen(A.pinia, Money, '/money/history')
    setActivePinia(A.pinia)
    const state = { ...A.store.householdDoc, credits: A.store.credits, ops: [] }
    expect(historyMonths(state, K)).toEqual([
      { key: '2026-08', left: 455_000, put: 0 },
      { key: '2026-07', left: 455_000, put: 0 },
    ])
    const seen = text(html)
    expect(seen).toContain(`Август осталось ${plain(455_000)}`)
    expect(seen).toContain(`Июль осталось ${plain(455_000)}`)
    expect(html).toMatch(/data-history-feed-body[^>]*style="display:none;?"/)
    // Месяц → «План · Месяц» того месяца сводкой: «Осталось» — то же число (у Аруны: её зарплаты в августе не было).
    const B = await phone(server, 'b')
    const august = await screen(B.pinia, Month, '/month?month=2026-08')
    expect(monthPlanPast(state, '2026-08').left).toBe(455_000)
    expect(text(august)).toContain(`Осталось ${money(455_000)}`)
    // У Ильяса август — планом с «Отложил» (Р-78, Блок 15: своя зарплата пришла и не отложена), не сводкой.
    expect(text(await screen(A.pinia, Month, '/month?month=2026-08'))).toContain('Остаётся')
  })

  it('часть 4 — viewer: зарплаты без нажатия, без «+ Кредит», месяцы «Истории» те же', async () => {
    const V = await phone(server, 'a', 'viewer')
    const capital = await screen(V.pinia, Money, '/money')
    expect(capital).toMatch(/<div[^>]*data-salary="a"/)
    expect(capital).not.toMatch(/<button[^>]*data-salary=/)
    expect(await screen(V.pinia, Money, '/money/debts')).not.toContain('data-add-credit')
    const history = await screen(V.pinia, Money, '/money/history')
    expect(history.match(/data-history-month=/g)).toHaveLength(2)
  })

  // Приёмка Б16: план «Сначала долги» — общий; «без долгов — к» у второго телефона и viewer меняется вслед за ним.
  it('часть 5 — план «Сначала долги» на телефоне Ильяса: у Аруны и viewer «без долгов — к» по прогнозу плана; отмена — снова по графикам', async () => {
    const A = await phone(server, 'a')
    const B = await phone(server, 'b')
    const V = await phone(server, 'b', 'viewer')
    const free = (p: Phone) => {
      setActivePinia(p.pinia)
      return debtsOverview({ ...p.store.planState(), plans: p.store.plans }, K).freeMonth!
    }
    const byGraphs = free(B)

    setActivePinia(A.pinia)
    expect(A.store.choosePlan({ keptGoalIds: [], cushionGoalId: null, months: 12, lump: 0 }, 'a')).not.toBeNull()
    await sync(A, B, V)
    const byPlan = free(B)
    expect(byPlan).not.toBe(byGraphs)
    expect(free(V)).toBe(byPlan)
    expect(text(await screen(B.pinia, Money, '/money/debts'))).toContain(`без долгов — ${monthBy(byPlan, K)}`)
    expect(text(await screen(V.pinia, Money, '/money/debts'))).toContain(`без долгов — ${monthBy(byPlan, K)}`)

    setActivePinia(A.pinia)
    A.store.cancelPlan()
    await sync(A, B)
    expect(free(B)).toBe(byGraphs)
    expect(text(await screen(B.pinia, Money, '/money/debts'))).toContain(`без долгов — ${monthBy(byGraphs, K)}`)
  })
})
