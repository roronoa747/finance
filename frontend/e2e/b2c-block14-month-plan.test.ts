import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { ApiClient } from '../src/api/client'
import { monthPlan } from '../src/lib/finance'
import { money, plain } from '../src/lib/money'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { SyncDoc, WishItem } from '../src/types/finance'
import Dreams from '../src/views/Dreams.vue'
import Money from '../src/views/Money.vue'
import Wishes from '../src/views/Wishes.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 14 «План месяца» (B2C-90): два телефона и viewer на фейковом сервере, понедельник 12 октября 2026.
 * Ильяс 700 000 (10-го, пришла по выписке), Аруна 500 000 (20-го, ждём). Платежи: аренда 220 000, кредит 58 000,
 * кредитка 25 000, рассрочка 20 000 — все Ильяса (плательщик по умолчанию — первый участник). Траты: Ильяс —
 * продукты 150 000, Аруна — продукты 100 000. Очередь: «Отпуск» 40 000 → «Машина» 60 000 → «Подушка» (копилка,
 * фонд, порог 3 мес.) 30 000 → «закрыть кредит» 30 000 (платит Аруна). Нажатия — методами стора и кнопками
 * экранов (SSR, `screen`); браузер — на стенде.
 *
 * Ручной расчёт октября:
 *   Доход        700 000 + 500 000                          = 1 200 000
 *   Платежи      220 000 + 58 000 + 25 000 + 20 000          =   323 000
 *   Траты        150 000 + 100 000                           =   250 000
 *   Очередь      40 000 + 60 000 + 30 000 + 30 000           =   160 000  (порог «Подушки» 3 × 573 000, далеко)
 *   Остаётся     1 200 000 − 323 000 − 250 000 − 160 000     =   467 000
 *   Хватает      Ильяс 700 000 − 323 000 − 150 000 − 130 000 =    97 000
 *                Аруна 500 000 − 100 000 − 30 000            =   370 000   (97 000 + 370 000 = 467 000)
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
  }
}

const K = '2026-10'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
/** Текст элемента с атрибутом `attr` (первого) — из SSR-разметки. */
function part(html: string, attr: string) {
  const at = html.indexOf(attr)
  if (at < 0) return ''
  const open = html.lastIndexOf('<', at)
  const tag = html.slice(open + 1, html.indexOf(' ', open))
  return text(html.slice(open, html.indexOf(`</${tag}>`, at))).trim()
}
const planOf = (p: Phone) => {
  setActivePinia(p.pinia)
  const doc = p.store.householdDoc
  return monthPlan({ ...doc, credits: p.store.credits }, { key: K, totals: doc.spendTotals ?? [], spendCategories: doc.spendCategories ?? [], uploads: [] })
}
const wish = (id: string, name: string): WishItem => ({ id, name, price: 50_000, by: 'a', list: 'all', bought: false, addedOn: T0, updatedAt: T0 }) as WishItem

function familyDoc(): SyncDoc {
  const base = planFamilyDoc()
  return {
    ...base,
    goals: base.goals.map((g) => (g.id === 'trip' ? { ...g, monthly: 40_000 } : g)),
    moneySettings: { ...base.moneySettings!, potGoalId: 'cushion' },
    spendPlans: [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['trip', 'car', 'cushion', 'debt'], updatedAt: T0 },
    debtCard: { monthly: 30_000, pausedAt: null, payer: 'b', updatedAt: T0 },
    wishlist: [wish('w1', 'Кофемашина'), wish('w2', 'Кроссовки'), wish('w3', 'Наушники')],
    payments: [
      { id: 'sal-a', kind: 'salary', targetId: 'a', period: K, amount: 700_000, accountId: 'card', by: 'a', source: 'statement', opId: 'op-a', at: '2026-10-10T05:00:00.000Z', updatedAt: '2026-10-10T05:00:00.000Z' },
    ],
  }
}

/** «Отложить по плану» — кнопкой экрана «Денег». */
async function tapSave(p: Phone) {
  await screen(p.pinia, Money, '/money', undefined, [
    screenMixin({}, (s) => {
      if (typeof s.onSave === 'function') (s.onSave as () => void)()
    }),
  ])
}

describe('e2e / B2C Блок 14 — план месяца на двух телефонах и у viewer', () => {
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
    vi.unstubAllGlobals()
  })

  it('часть 1 — один план на две зарплаты у обоих: доход, платежи, траты, очередь, остаток и «хватает» — ручной расчёт', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    for (const P of [A, B]) {
      const plan = planOf(P)
      expect(plan).toMatchObject({ duesTotal: 323_000, spendTotal: 250_000, queueTotal: 160_000, rest: 467_000, short: 0 })
      expect(plan.income).toEqual({ total: 1_200_000, byPerson: [expect.objectContaining({ person: 'a', amount: 700_000, came: true }), expect.objectContaining({ person: 'b', amount: 500_000, came: false })] })
      expect(plan.queue.map((q) => [q.id, q.given])).toEqual([['trip', 40_000], ['car', 60_000], ['cushion', 30_000], ['debt', 30_000]])
      expect(plan.byPerson.map((x) => [x.person, x.left])).toEqual([['a', 97_000], ['b', 370_000]])
      const html = await screen(P.pinia, Money, '/money')
      expect(part(html, 'data-rest')).toBe(sp(money(467_000)))
      expect(part(html, 'data-salary="a"')).toContain('✓ пришла')
      expect(part(html, 'data-salary="b"')).toContain('ждём 20 октября')
      expect(text(html)).toContain(`+${sp(plain(97_000))}`)
      expect(text(html)).toContain(`+${sp(plain(370_000))}`)
      // У каждого платежа и цели — кружок плательщика и дата.
      expect(html.match(/data-due[ >]/g)).toHaveLength(4)
      expect(text(html)).toContain(`Отложим ${sp(money(160_000))}`)
    }
  })

  it('часть 2 — выключил цель: остаток и даты пересчитаны сразу и у партнёра; на «Мечтах» — «на паузе»', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    const before = planOf(A)
    setActivePinia(A.pinia)
    A.store.pauseGoal('car', true)
    const after = planOf(A)
    // 467 000 + 60 000 «Машины» = 527 000.
    expect(after.rest).toBe(527_000)
    expect(after.queue.find((q) => q.id === 'car')).toMatchObject({ given: 0, paused: 'off', doneMonth: null })
    expect(before.queue.find((q) => q.id === 'car')!.doneMonth).not.toBeNull()
    await sync(A, B)
    expect(planOf(B).rest).toBe(527_000)
    const money_ = await screen(B.pinia, Money, '/money')
    expect(part(money_, 'data-rest')).toBe(sp(money(527_000)))
    expect(part(money_, 'data-queue="car"')).toContain('на паузе')
    expect(part(await screen(B.pinia, Dreams, '/'), 'data-id="car"')).toContain('на паузе')
    // Включил обратно — как было.
    setActivePinia(B.pinia)
    B.store.pauseGoal('car', false)
    expect(planOf(B).rest).toBe(467_000)
  })

  it('часть 3 — перетащил цель выше: она раньше получает деньги, а наверху — герой «Мечт» у обоих', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    expect((await screen(B.pinia, Dreams, '/')).includes('data-id="car"')).toBe(true)
    setActivePinia(A.pinia)
    A.store.moveInQueue('car', 0)
    expect(planOf(A).queue.map((q) => q.id)).toEqual(['car', 'trip', 'cushion', 'debt'])
    await sync(A, B)
    setActivePinia(B.pinia)
    expect(B.store.heroGoal?.id).toBe('car')
    const dreams = await screen(B.pinia, Dreams, '/')
    // «Машина» — герой, в списке её нет; «Отпуск» — первой строкой.
    expect(dreams).not.toContain('data-id="car"')
    expect(dreams.indexOf('data-id="trip"')).toBeGreaterThan(-1)
    expect(part(await screen(B.pinia, Money, '/money'), 'data-queue="car"')).toContain('главная')
  })

  it('часть 4 — желания переставляются; порядок у партнёра тот же', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    setActivePinia(A.pinia)
    A.store.moveWish('w3', 0)
    await sync(A, B)
    setActivePinia(B.pinia)
    expect(B.store.wishes.map((w) => w.id)).toEqual(['w3', 'w1', 'w2'])
    storage.set('ff_wishes_view', JSON.stringify('list'))
    const html = await screen(B.pinia, Wishes, '/wishes')
    expect(html.indexOf('data-id="w3"')).toBeLessThan(html.indexOf('data-id="w1"'))
  })

  it('часть 5 — смена плательщика: «хватает» обоих пересчитано, прошлые записи не тронуты', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    setActivePinia(A.pinia)
    A.store.setPayer('obligation', 'rent', 'b')
    await sync(A, B)
    // Ильяс 97 000 + 220 000 = 317 000; Аруна 370 000 − 220 000 = 150 000.
    expect(planOf(B).byPerson.map((x) => [x.person, x.left])).toEqual([['a', 317_000], ['b', 150_000]])
    const html = await screen(B.pinia, Money, '/money')
    expect(text(html)).toContain(`+${sp(plain(317_000))}`)
    expect(text(html)).toContain(`+${sp(plain(150_000))}`)
    expect(B.store.payments.find((p) => p.id === 'sal-a')).toMatchObject({ amount: 700_000 })
  })

  it('часть 6 — «Отложить по плану»: взносы Ильяса по плану, запись месяца; повтор не пишет; у партнёра — «Отложено», без удвоения', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    expect(await screen(A.pinia, Money, '/money')).toMatch(/>\s*Отложить по плану\s*</)
    // У Аруны зарплата не пришла — её кнопки нет.
    expect(await screen(B.pinia, Money, '/money')).not.toMatch(/>\s*Отложить по плану\s*</)
    await tapSave(A)
    setActivePinia(A.pinia)
    expect(A.store.allocations).toEqual([
      expect.objectContaining({ kind: 'plan', source: 'salary', sourceId: 'a', period: K, total: 700_000, parts: [{ target: 'trip', amount: 40_000 }, { target: 'car', amount: 60_000 }, { target: 'cushion', amount: 30_000 }] }),
    ])
    const haves = Object.fromEntries(A.store.goals.map((g) => [g.id, g.have]))
    expect(haves).toMatchObject({ trip: 90_000, car: 260_000, cushion: 430_000 })
    // План не изменился: взносы от начала месяца.
    expect(planOf(A).rest).toBe(467_000)
    await tapSave(A)
    expect(A.store.allocations).toHaveLength(1)
    await sync(A, B)
    setActivePinia(B.pinia)
    expect(B.store.allocations).toHaveLength(1)
    expect(Object.fromEntries(B.store.goals.map((g) => [g.id, g.have]))).toEqual(haves)
    expect(part(await screen(B.pinia, Money, '/money'), 'data-plan-saved')).toContain(`Отложено ${sp(money(130_000))}`)
  })

  it('часть 7 — viewer видит тот же план без переключателей, плательщиков, ⋮⋮ и кнопки', async () => {
    const V = await phone(server, st, 'a', 'viewer')
    const html = await screen(V.pinia, Money, '/money')
    expect(part(html, 'data-rest')).toBe(sp(money(467_000)))
    expect(html).toContain('просмотр')
    expect(html.slice(0, html.indexOf('data-more'))).not.toContain('role="switch"')
    expect(html).not.toContain('data-grip')
    expect(html).not.toContain('aria-label="Платит')
    expect(html).not.toMatch(/>\s*Отложить по плану\s*</)
  })

  it('часть 8 — старые адреса разбора и «Вашего порядка» открывают «Деньги»', async () => {
    await phone(server, st, 'a')
    const router = createAppRouter(createMemoryHistory())
    useFinanceStore().finishSetup()
    for (const old of ['/week/breakdown?from=salary&person=a&period=2026-10', '/week/order', '/week/salary?from=freed', '/ritual?from=rest&amount=1&period=2026-09']) {
      await router.push(old)
      expect(router.currentRoute.value.fullPath).toBe('/money')
    }
  })

  it('часть 9 — два телефона без сети: порядок с одного и пауза с другого сливаются, оба видят оба изменения', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    setActivePinia(A.pinia)
    A.store.moveInQueue('cushion', 0)
    at('2026-10-12T07:05:00Z')
    setActivePinia(B.pinia)
    B.store.pauseGoal('trip', true)
    await sync(A)
    await sync(B, A)
    for (const P of [A, B]) {
      setActivePinia(P.pinia)
      expect(P.store.goalOrder?.ids).toEqual(['cushion', 'trip', 'car', 'debt'])
      expect(P.store.goals.find((g) => g.id === 'trip')?.pausedAt).toBeTruthy()
      expect(planOf(P).queue.map((q) => [q.id, q.given])).toEqual([['cushion', 30_000], ['trip', 0], ['car', 60_000], ['debt', 30_000]])
    }
    // Порядок — объект целиком (Р-84): позже переставил другой — его порядок.
    at('2026-10-12T07:10:00Z')
    setActivePinia(B.pinia)
    B.store.moveInQueue('car', 0)
    await sync(B, A)
    setActivePinia(A.pinia)
    expect(A.store.goalOrder?.ids).toEqual(['car', 'cushion', 'trip', 'debt'])
  })

  it('часть 10 (приёмка) — фонд наверху очереди: деньги первым получает он, а герой «Мечт» и «главная» — первая цель', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    setActivePinia(A.pinia)
    A.store.moveInQueue('cushion', 0)
    await sync(A, B)
    for (const P of [A, B]) {
      setActivePinia(P.pinia)
      // Сумма та же (467 000): порог «Подушки» далеко, все получают свой взнос; меняется только порядок.
      expect(planOf(P).queue.map((q) => [q.id, q.given])).toEqual([['cushion', 30_000], ['trip', 40_000], ['car', 60_000], ['debt', 30_000]])
      expect(planOf(P).rest).toBe(467_000)
      expect(P.store.heroGoal?.id).toBe('trip')
      const html = await screen(P.pinia, Money, '/money')
      expect(part(html, 'data-queue="trip"')).toContain('главная')
      expect(part(html, 'data-queue="cushion"')).not.toContain('главная')
      // «Мечты»: фонды — только в плане (макет), герой — «Отпуск», в списке его нет.
      const dreams = await screen(P.pinia, Dreams, '/')
      expect(dreams).not.toContain('data-id="cushion"')
      expect(dreams).not.toContain('data-id="trip"')
    }
  })
})
