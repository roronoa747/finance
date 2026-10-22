import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { dreamShift, reviewCards, shiftLabel, usualSpend } from '../src/lib/finance'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAiStore } from '../src/stores/ai'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { leadFor } from '../src/test/reviewV4'
import type { ReviewPayloadV4, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import Dreams from '../src/views/Dreams.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 4б «Фидбек» (FB-15…FB-17, FB-23; Р-23…Р-29): разбор v4 — свой у каждого. Два телефона одной семьи и viewer,
 * понедельник 12 октября 2026; каждый загрузил свою выписку 1 июля – 12 октября; согласие на ИИ — у обоих.
 *
 *   Ильяс  июль–сентябрь: Magnum 40 000, Del Papa 10 000, NETFLIX 4 990 (9-го). Октябрь: Magnum 30 000, Del Papa
 *          60 000 (план кафе 10 000 — выше плана), перевод «Замире Ш.» 60 000, Sulpak 120 000 (новый продавец),
 *          NETFLIX 4 990. Факт октября 274 990: переводы людям 22 % (≥ 20 %), Sulpak 44 % (≥ 5 %, ≥ 20 000).
 *   Аруна  июль–октябрь: Small 20 000 в месяц. Своих переводов и разовых нет.
 * План впритык (как `dreamShift.test.ts`): доход 1 200 000 − платежи 323 000 − планы 747 000 (Ильяс 60 000, Аруна
 * 687 000) = 130 000 — ровно взносы мечт. Снимок срока — на начало октября (план без выписок); факт Ильяса 274 990 выше его
 * плана — мечты дальше, крупнейший раздел выше плана — его кафе (60 000 при плане 10 000).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore>; aiReview: ReturnType<typeof vi.fn> }

const K = '2026-10'
const NAME = 'Замира Ш.'

function familyDoc(): SyncDoc {
  return planFamilyDoc({
    spendPlans: [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 50_000, updatedAt: T0 },
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 10_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 687_000, updatedAt: T0 },
    ],
    goalOrder: { ids: ['car', 'cushion', 'trip'], updatedAt: T0 },
  })
}

const op = (date: string, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const statement = (ops: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from: '2026-07-01', to: '2026-10-12', skipped: 0, operations: assignIds(ops) })
const STATEMENT_A = () =>
  statement([
    ...['2026-07', '2026-08', '2026-09'].flatMap((m) => [op(`${m}-05`, -40_000, 'Magnum', 'sc_food'), op(`${m}-07`, -10_000, 'Del Papa Cafe', 'sc_cafe'), op(`${m}-09`, -4_990, 'NETFLIX', 'sc_subscriptions')]),
    op('2026-10-03', -30_000, 'Magnum', 'sc_food'),
    op('2026-10-04', -60_000, NAME, 'sc_people', { kind: 'transfer-out', counterparty: NAME, note: 'Перевод' }),
    op('2026-10-06', -60_000, 'Del Papa Cafe', 'sc_cafe'),
    op('2026-10-09', -4_990, 'NETFLIX', 'sc_subscriptions'),
    op('2026-10-10', -120_000, 'Sulpak', 'sc_shopping'),
  ])
const STATEMENT_B = () => statement(['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => op(`${m}-04`, -20_000, 'Small', 'sc_food')))

describe('e2e / Фидбек Блок 4б — разбор v4 свой у каждого', () => {
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
    vi.stubGlobal('navigator', { onLine: true })
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
    pv = fakePrivate()
    for (const u of ['u-a', 'u-b']) pv.docs.set(u, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member', ai = true): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const user = role === 'viewer' ? 'u-v' : `u-${slot}`
    const auth = useAuthStore()
    auth.setAuthData({
      token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
    })
    auth.ai = ai
    const aiReview = vi.fn(async (body: unknown) => leadFor(body))
    const client = { ...backend(server), ...statementsFor(st, user, slot), ...privateFor(pv, user), aiReview, fxRates: vi.fn(async (code: string) => ({ code, rates: {}, partial: false })) } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await store.pullPrivateDoc(client)
    await useOperationsStore().loadUploads(client)
    useAiStore().sheetMounted = true
    return { pinia, client, store, aiReview }
  }
  const on = (p: Phone) => {
    setActivePinia(p.pinia)
    return { ai: useAiStore(), ops: useOperationsStore(), finance: p.store }
  }

  async function uploaded(p: Phone, parsed: ParsedStatement) {
    const { ops } = on(p)
    await ops.upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }
  async function pull(...to: Phone[]) {
    for (const p of to) {
      const { ops } = on(p)
      await p.store.pullHousehold(p.client)
      await ops.loadUploads(p.client)
    }
  }
  /** Семья: снимок срока на начало месяца (план без выписок), затем выписки обоих. */
  async function family(ai = true) {
    const A = await phone('a', 'member', ai)
    on(A).finance.ensureTermSnap()
    await A.store.syncHousehold(A.client)
    const B = await phone('b', 'member', ai)
    await uploaded(A, STATEMENT_A())
    await uploaded(B, STATEMENT_B())
    await pull(A, B)
    return { A, B }
  }
  /** Карточки кода телефона — как «Месяц» (`MonthPlan.v4Cards`). */
  const cardsOf = (p: Phone) => {
    const { ops, finance } = on(p)
    const { state, ctx } = finance.planInput(K)
    return reviewCards({ ...finance.householdDoc, ...state }, ctx, ops.all, useAuthStore().slot!, { recurringFor: ops.recurringFor })
  }
  const report = (p: Phone) => screen(p.pinia, Month, '/month?review=1')
  const codeKinds = (html: string) => [...html.matchAll(/data-review-card="([^"]+)"/g)].map((m) => m[1])

  it('(а) у каждого свой отчёт: мои карточки по моим операциям; разбор партнёра мне не виден, его повод мой не закрывает', async () => {
    const { A, B } = await family()
    const a = on(A)
    const mine = await a.ai.autoReview(A.client)
    expect(A.aiReview).toHaveBeenCalledTimes(1)
    expect(mine).toMatchObject({ v: 4, by: 'a', reasonKey: `month:${K}` })
    expect(a.finance.myAiReviews.map((r) => r.id)).toEqual([mine!.id])
    await A.store.syncHousehold(A.client)
    await A.store.syncPrivate(A.client)
    // В общем документе разбора нет — он личный: на сервере только в моём личном документе, не в её (критик 4б).
    expect(server.data.aiReviews ?? []).toEqual([])
    expect(JSON.stringify(pv.docs.get('u-a')!.data)).toContain(mine!.id)
    expect(JSON.stringify(pv.docs.get('u-b')!.data)).not.toContain(mine!.id)
    const bodyA = A.aiReview.mock.calls[0][0] as ReviewPayloadV4
    expect(bodyA.cards.map((c) => c.kind)).toEqual(expect.arrayContaining(['people', 'oneoff']))

    // Аруна: моего разбора не видит, повод у неё свой — свой запрос, свои карточки (без переводов и разовой).
    await pull(B)
    // Второй телефон — своё хранилище: попытки разбора (`ff_ai_auto`) у телефонов свои.
    storage.delete('ff_ai_auto')
    const b = on(B)
    expect(b.finance.aiReviewOf(K)).toBeNull()
    const hers = await b.ai.autoReview(B.client)
    expect(B.aiReview).toHaveBeenCalledTimes(1)
    expect(hers).toMatchObject({ v: 4, by: 'b' })
    const bodyB = B.aiReview.mock.calls[0][0] as ReviewPayloadV4
    expect(bodyB.cards.map((c) => c.kind)).not.toContain('people')
    expect(bodyB.cards.map((c) => c.kind)).not.toContain('oneoff')
    // Её разбор — не мой: у Ильяса по-прежнему свой; у неё после своего личного документа — только её.
    expect(on(A).finance.aiReviewOf(K)!.id).toBe(mine!.id)
    expect(on(B).finance.myAiReviews.map((r) => r.id)).toEqual([hers!.id])
    const htmlA = await report(A)
    expect(htmlA).toContain('data-review-lead')
    expect(codeKinds(htmlA)[0]).toBe(on(A).finance.aiReviewOf(K)!.next!.split(':')[0])
    const htmlB = await report(B)
    expect(codeKinds(htmlB)).not.toContain('people')
    expect(htmlB).not.toContain(NAME)
  })

  it('(б) семья без ИИ — «Разбор» с карточками кода, без мысли; запроса нет', async () => {
    const { A } = await family(false)
    const a = on(A)
    expect(await a.ai.autoReview(A.client)).toBeNull()
    const month = await screen(A.pinia, Month, '/month')
    expect(month).toContain('data-review-open')
    expect(month).not.toContain('data-review-sparkle')
    const html = await report(A)
    expect(codeKinds(html).length).toBeGreaterThan(0)
    expect(html).not.toContain('data-review-lead')
    expect(A.aiReview).not.toHaveBeenCalled()
  })

  it('(в) кнопки: «Разобрать» людей → «Кому → что» → карточка меняется (✓); «Отметить разовой» → карточки нет, «обычно» то же; «В платежи» → платёж заведён', async () => {
    const { A } = await family()
    const a = on(A)
    const before = cardsOf(A)
    const people = before.find((c) => c.kind === 'people')!
    expect(people).toMatchObject({ figure: { value: 60_000 }, line: `Больше всех — ${NAME}`, target: { kind: 'cat', categoryId: 'sc_people' } })
    // Лист раздела → лист операции → «Кому → что»: это возврат долга — в «Подарки» нет, в «Прочее».
    await a.ops.recategorize({ counterparty: 'замира ш.' }, { categoryId: 'sc_other' }, A.client)
    // Единственный перевод разобран — карточки людей больше нет (✓ в отчёте ставится по её уходу, критик 4б).
    expect(cardsOf(A).find((c) => c.kind === 'people')).toBeUndefined()

    // «Отметить разовой» у Sulpak: карточки больше нет; «обычно» раздела не меняется (разовые туда не входят).
    const oneoff = cardsOf(A).find((c) => c.kind === 'oneoff')!
    expect(oneoff.target).toMatchObject({ kind: 'op' })
    const { state, ctx } = a.finance.planInput(K)
    const usual = usualSpend(state.people ?? [], ctx.totals, ctx.spendCategories, ctx.uploads, K, 'a')
    // Кнопка отмечает одним нажатием (Х-16) — та же правка; раздел траты остаётся.
    const oneoffId = (oneoff.target as { opId: string }).opId
    const cat = a.ops.all.find((o) => o.id === oneoffId)!.categoryId
    a.ops.editOp(oneoffId, { oneOff: true })
    expect(a.ops.all.find((o) => o.id === oneoffId)).toMatchObject({ oneOff: true, categoryId: cat })
    expect(cardsOf(A).find((c) => c.kind === 'oneoff')).toBeUndefined()
    expect(codeKinds(await report(A))).not.toContain('oneoff')
    const after = a.finance.planInput(K)
    expect(usualSpend(after.state.people ?? [], after.ctx.totals, after.ctx.spendCategories, after.ctx.uploads, K, 'a')).toEqual(usual)

    // «В платежи» у NETFLIX: платёж заведён, отметка месяца — этой строкой, карточки больше нет.
    const pay = cardsOf(A).find((c) => c.kind === 'recurring')
    expect(pay, 'карточка «Не в платежах»').toBeDefined()
    const opId = (pay!.target as { opId: string }).opId
    const id = a.finance.addObligation({ name: 'Netflix', day: 9, category: 'd4', amount: 4_990 })
    await a.ops.addToPayments(opId, id, A.client)
    expect(a.finance.householdDoc.payments?.some((p) => p.targetId === id && p.opId === opId)).toBe(true)
    expect(cardsOf(A).find((c) => c.kind === 'recurring')).toBeUndefined()
  })

  it('(г) имя человека из перевода не уходит в тело `aiReview`; имён участников тоже нет', async () => {
    const { A } = await family()
    await on(A).ai.autoReview(A.client)
    const body = JSON.stringify(A.aiReview.mock.calls[0][0])
    for (const no of [NAME, 'Замира', 'Ильяс', 'Аруна', '2026-10-0']) expect(body).not.toContain(no)
    expect(body).toContain('переводы людям')
  })

  it('(д) Х-8: «мечта сдвинулась» — у Ильяса с его разделом, у Аруны без чужого раздела', async () => {
    const { A, B } = await family()
    // Сдвинулась та мечта очереди, до которой не хватило денег, — ищем её по снимку.
    const label = (p: Phone) => {
      const { finance } = on(p)
      const { state, ctx } = finance.planInput(K)
      const snap = finance.termSnapFor(K)
      const s = (snap?.goals ?? []).map((g) => dreamShift(state, ctx, snap, g.goalId, useAuthStore().slot!)).find(Boolean)
      return s ? shiftLabel(s) : null
    }
    expect(label(A)).toMatch(/кафе и рестораны выше плана$/)
    expect(label(B)).toMatch(/· траты выше плана$/)
    const dreams = await screen(B.pinia, Dreams, '/dreams')
    expect(dreams).not.toContain('кафе и рестораны выше плана')
    expect(dreams).toContain('траты выше плана')
  })

  it('(е) viewer — отчёта v4 нет: ни карточек, ни запроса, ни пилюли без разбора в общем документе', async () => {
    await family()
    const V = await phone('a', 'viewer')
    const v = on(V)
    expect(await v.ai.autoReview(V.client)).toBeNull()
    expect(V.aiReview).not.toHaveBeenCalled()
    const month = await screen(V.pinia, Month, '/month')
    expect(month).not.toContain('data-review-open')
    expect(await report(V)).not.toContain('data-review-card=')
  })
})
