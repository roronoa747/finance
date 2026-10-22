// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { routes } from '../src/router'
import type { ApiClient } from '../src/api/client'
import { monthPlan, reviewCards, usualSpend } from '../src/lib/finance'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAiStore } from '../src/stores/ai'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { leadFor } from '../src/test/reviewV4'
import type { AiReviewLead } from '../src/types/api'
import type { ReviewPayloadV3, ReviewPayloadV4, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'
import { saveV3 } from './support/reviewV3'

/**
 * Приёмка Блока 4б «Фидбек» (FB-15…FB-17, FB-23; возврат `/ux` — Х-11, Х-13, Х-15, Х-16): то, что e2e исполнителя
 * (`fb-block4-review-v4`, (а)–(е)) не закрывает, — настоящим экраном «Месяца» (happy-dom, нажатия по data-атрибутам) на
 * двух телефонах одной семьи. Та же семья, что у исполнителя: понедельник 12 октября 2026, выписки 1 июля – 12 октября.
 *
 *   Ильяс  июль–сентябрь: Magnum 40 000, Del Papa 10 000, NETFLIX 4 990. Октябрь: Magnum 30 000, перевод «Замире Ш.»
 *          60 000, Del Papa 60 000, NETFLIX 4 990, Sulpak 120 000 — новый продавец в «Покупках», плана у раздела нет.
 *   Аруна  июль–октябрь: Small 20 000 в месяц.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore>; aiReview: ReturnType<typeof vi.fn> }
type Answer = (body: unknown) => AiReviewLead

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

let app: App | null = null
let router: Router

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const press = async (el: Element | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  ;(el as HTMLElement).click()
  await flush()
}
const codeKinds = () => [...document.querySelectorAll('[data-review-card]')].map((el) => el.getAttribute('data-review-card'))
const sheetTitles = () => [...document.querySelectorAll('[role="dialog"] h3')].map(txt)
const cardButton = (kind: string) => q(`[data-review-card="${kind}"] [data-review-card-button]`)

describe('e2e / приёмка Фидбек Блок 4б — разбор v4 после возврата `/ux`', () => {
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
    // Экран сам в сеть не ходит: всё через клиент телефона.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
    pv = fakePrivate()
    for (const u of ['u-a', 'u-b']) pv.docs.set(u, { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function phone(slot: 'a' | 'b', ai = true, answer: Answer = leadFor): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const user = `u-${slot}`
    const auth = useAuthStore()
    auth.setAuthData({
      token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
    })
    auth.ai = ai
    const aiReview = vi.fn(async (body: unknown) => answer(body))
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
      await p.store.pullPrivateDoc(p.client)
      await ops.loadUploads(p.client)
    }
  }
  async function family(opts: { ai?: boolean; answer?: Answer } = {}) {
    const A = await phone('a', opts.ai ?? true, opts.answer)
    on(A).finance.ensureTermSnap()
    await A.store.syncHousehold(A.client)
    const B = await phone('b', opts.ai ?? true)
    await uploaded(A, STATEMENT_A())
    await uploaded(B, STATEMENT_B())
    await pull(A, B)
    return { A, B }
  }
  const cardsOf = (p: Phone) => {
    const { ops, finance } = on(p)
    const { state, ctx } = finance.planInput(K)
    return reviewCards({ ...finance.householdDoc, ...state }, ctx, ops.all, useAuthStore().slot!, { recurringFor: ops.recurringFor })
  }
  const factOf = (p: Phone, by: 'a' | 'b') => {
    const { finance } = on(p)
    const { state, ctx } = finance.planInput(K)
    return monthPlan(state, ctx).spend.find((s) => s.by === by)?.fact ?? null
  }
  const usualOf = (p: Phone, by: 'a' | 'b') => {
    const { finance } = on(p)
    const { state, ctx } = finance.planInput(K)
    return usualSpend(state.people ?? [], ctx.totals, ctx.spendCategories, ctx.uploads, K, by)
  }
  /** «Месяц» телефона настоящим экраном (happy-dom), адрес — как у пилюли. */
  async function mountMonth(p: Phone, path = '/month') {
    app?.unmount()
    document.body.innerHTML = ''
    setActivePinia(p.pinia)
    router = createRouter({ history: createMemoryHistory(), routes })
    await router.push(path)
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Month)
    app.use(p.pinia)
    app.use(router)
    app.mount(root)
    await flush()
  }

  it('(ж) Х-13: новая крупная покупка без плана раздела — одна карточка «Похоже на разовую», «Работа ИИ» без двойного счёта', async () => {
    const { A } = await family()
    const cards = cardsOf(A)
    const oneoff = cards.find((c) => c.kind === 'oneoff')!
    expect(oneoff).toMatchObject({ figure: { value: 120_000 }, monthly: 120_000 })
    // Раздел «Покупки» держится только на этой покупке — карточки «Поставить план» у него нет, и ни одна другая карточка
    // не повторяет её сумму.
    expect(cards.find((c) => c.kind === 'plan' && c.target.kind === 'plan' && c.target.categoryId === 'sc_shopping')).toBeUndefined()
    expect(cards.filter((c) => c.figure.value === 120_000)).toHaveLength(1)
    // Счётчик сохранённого разбора — сумма карточек по одному разу, меньше своего факта месяца.
    const mine = await on(A).ai.autoReview(A.client)
    const sum = cards.reduce((s, c) => s + c.monthly, 0)
    expect(mine!.work!.monthly).toBe(sum)
    expect(mine!.work!.monthly!).toBeLessThan(factOf(A, 'a')!)
    // Экран: в отчёте разовая есть, плана «Покупок» нет.
    await mountMonth(A, '/month?review=1')
    expect(codeKinds()).toContain('oneoff')
    expect(document.querySelectorAll('[data-review-card="plan"]')).toHaveLength(cards.filter((c) => c.kind === 'plan').length)
  })

  it('(з) Х-16 на двух телефонах: «Отметить разовой» одним нажатием — раздел тот же, итоги с разовой; у партнёра факты те же; «Отменить» снимает', async () => {
    const { A, B } = await family({ ai: false })
    const usualA = usualOf(A, 'a')
    const factA = factOf(A, 'a')
    const factB = factOf(B, 'b')
    const sulpak = on(A).ops.all.find((o) => o.merchant === 'Sulpak')!

    await mountMonth(A, '/month?review=1')
    const sheets = sheetTitles().length
    await press(cardButton('oneoff'))
    // Листа нет — отмечено сразу; раздел не тронут; ✓ и строка «продавец · раздел · разовая»; тост.
    expect(sheetTitles()).toHaveLength(sheets)
    expect(on(A).ops.all.find((o) => o.id === sulpak.id)).toMatchObject({ oneOff: true, categoryId: 'sc_shopping' })
    expect(q('[data-review-card="oneoff"] [data-review-card-done]')).not.toBeNull()
    expect(txt(q('[data-review-card="oneoff"] [data-review-card-op]'))).toMatch(/^Sulpak · .+ · разовая$/)
    expect(txt(q('[data-review-oneoff-toast]'))).toBe('Отметили разовой')

    // Правка — в моём личном документе; итог месяца раздела — с разовой; факт и «обычно» не сдвинулись.
    await A.store.syncHousehold(A.client)
    await A.store.syncPrivate(A.client)
    expect(JSON.stringify(pv.docs.get('u-a')!.data.opEdits)).toContain(sulpak.id)
    expect(pv.docs.get('u-b')!.data.opEdits).toBeUndefined()
    const total = (server.data.spendTotals ?? []).find((t) => t.by === 'a' && t.period === K && t.categoryId === 'sc_shopping')!
    expect(total).toMatchObject({ amount: 120_000, oneOff: 120_000 })
    expect(factOf(A, 'a')).toBe(factA)
    expect(usualOf(A, 'a')).toEqual(usualA)

    // Аруна после синка: моей операции и правки не видит, моя строка «факт» и её факт — те же.
    await pull(B)
    expect(on(B).ops.all.some((o) => o.id === sulpak.id)).toBe(false)
    expect(factOf(B, 'a')).toBe(factA)
    expect(factOf(B, 'b')).toBe(factB)

    // «Отменить» в тосте (тот же открытый отчёт, тост ещё виден) — разовой больше нет, кнопка вернулась, итог без разовой.
    setActivePinia(A.pinia)
    await press(q('[data-toast-action]'))
    expect(on(A).ops.all.find((o) => o.id === sulpak.id)!.oneOff).toBeFalsy()
    expect(cardButton('oneoff')).not.toBeNull()
    await A.store.syncHousehold(A.client)
    expect((server.data.spendTotals ?? []).find((t) => t.id === total.id)).toMatchObject({ oneOff: 0 })
  })

  it.each([
    ['без ИИ', false],
    ['с ИИ и согласием', true], // возврат приёмки 4б: было «Не вышло» — запрос без карточек считался сбоем
  ])('(и) Х-11: участник %s и без выписок — «Нужна выписка», одна кнопка «Загрузить выписку» ведёт к загрузке; запроса нет', async (_, ai) => {
    const A = await phone('a', ai)
    if (ai) on(A).ai.setConsent(true)
    expect(await on(A).ai.autoReview(A.client)).toBeNull()
    await mountMonth(A)
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(txt(q('[data-review-empty] h2'))).toBe('Нужна выписка'))
    expect(txt(q('[data-report]'))).not.toContain('Не вышло')
    expect(codeKinds()).toEqual([])
    expect(document.querySelectorAll('[data-report] button:not([data-report-close]), [data-report] a')).toHaveLength(1)
    await press(q('[data-review-upload]'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/week?upload=1'))
    expect(A.aiReview).not.toHaveBeenCalled()
  })

  it('(к) Х-15: у мысли нет крупной цифры, если её показывает карточка `next`; с другой `next` — цифра есть', async () => {
    // Мысль ставит крупной цифру первой карточки (факт f1 — её число); `next` — сама эта карточка или вторая.
    let next = 'c1'
    const answer: Answer = (body) => {
      const b = body as ReviewPayloadV4
      return { title: 'Главное', text: 'Разберём главное месяца.', figure: b.facts[0].id, next: b.cards.find((c) => c.id === next)!.id }
    }
    const { A } = await family({ answer })
    const first = await on(A).ai.autoReview(A.client)
    expect(first!.lead!.figure).not.toBeNull()
    await mountMonth(A, '/month?review=1')
    expect(q('[data-review-lead]')).not.toBeNull()
    expect(q('[data-review-lead] [data-review-figure]')).toBeNull()

    // Повод «обновить» — вторая мысль с той же цифрой, но `next` — другая карточка: цифра у мысли есть.
    next = 'c2'
    at('2026-10-12T09:00:00Z') // «Обновить» позже первого: свой последний разбор — по `at`
    const second = await on(A).ai.runReview(K, 'refresh', A.client)
    expect(second).not.toBeNull()
    expect(on(A).finance.aiReviewOf(K)!.id).not.toBe(first!.id)
    await mountMonth(A, '/month?review=1')
    const flat = (s: string) => s.replace(/\s/g, '')
    expect(flat(txt(q('[data-review-lead] [data-review-figure]')))).toBe(flat(first!.lead!.figure!.value))
  })

  it('(л) переход: сохранённый общий v3 месяца виден, пока нет своего v4; свой v4 пришёл — отчёт v4, v3 не закрыл повод', async () => {
    const { A } = await family()
    const a = on(A)
    const v3 = saveV3(a.finance, K, (body: ReviewPayloadV3) => ({
      where: 'Кафе выросло.',
      advices: [{ title: 'Шаг', text: 'Один шаг месяца.', figure: null, action: body.actions[0].id }],
    }))
    await A.store.syncHousehold(A.client)
    expect(a.finance.aiReviewOf(K)!.id).toBe(v3.id)
    await mountMonth(A, '/month?review=1')
    expect(txt(q('[data-review-advice-title]'))).toBe('Шаг')
    expect(q('[data-review-lead]')).toBeNull()

    // Общий v3 повод v4 не закрывает: свой разбор спрашивается и встаёт вместо v3.
    const mine = await a.ai.autoReview(A.client)
    expect(A.aiReview).toHaveBeenCalledTimes(1)
    expect(mine).toMatchObject({ v: 4, by: 'a' })
    await mountMonth(A, '/month?review=1')
    expect(q('[data-review-lead]')).not.toBeNull()
    expect(q('[data-review-advice]')).toBeNull()
    expect(codeKinds().length).toBeGreaterThan(0)
  })
})
