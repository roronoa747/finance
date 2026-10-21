import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse, WalletStatus } from '../src/types/api'
import type { AiAdvice, AiReview, Goal, Payment } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, screen, serverPush, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Повторная приёмка Блока 2 «Пуши банков» бэклога «Apple Pay» (2026-10-19, ветка после мёржа `origin/main` `909bb74` —
 * «Разбор» Блоки 1–3): «Месяц» — экран обеих сторон мёржа (`MonthPlan.vue`). У семьи с ИИ на iPhone (Apple Pay
 * подключён) в разборе октября совет «Открыть» подушку, а зарплата Ильяса пришла пушем: пилюля «✦ Разбор», ✦ у подушки в
 * «Цели и фонды» и точка у «Пришла» — вместе; «Пришла» кнопкой строки — отметка на счёт сентябрьской зарплаты с
 * операцией пуша, точка уходит, пилюля и ✦ остаются, ручка разбора не зовётся; viewer той же семьи — пилюля и ✦ есть,
 * ни точки, ни «Пришла», статус Apple Pay не спрашивается. Стенд то же видел браузером (390 / 360, обе темы; ответ
 * модели — заглушкой в браузере). Четверг 15 октября 2026, зарплата Ильяса — 10-го. Суммы и имена — синтетические.
 */
const K = '2026-10'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const STATUS: WalletStatus = {
  connected: true, phones: 1, tap: true, push: true,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
  push_shortcut_url: 'https://www.icloud.com/shortcuts/stub-push',
}
const SEPT_SALARY: Payment = {
  id: 'sal-a-2026-09', kind: 'salary', targetId: 'a', period: '2026-09', amount: 700_000, accountId: 'card', by: 'a',
  at: '2026-09-10T05:00:00.000Z', updatedAt: '2026-09-10T05:00:00.000Z', source: 'manual',
}
const SALARY_PUSH = { id: 'f000000000000002', date: '2026-10-14', amount: 690_000, merchant: 'Зарплата', kind: 'income', bank: 'kaspi' }
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const advice: AiAdvice = { title: 'Подушка', text: 'Подушка тонкая.', figure: null, action: { kind: 'open', target: { kind: 'goal', id: 'fund', name: fund.name } } }
const review: AiReview = {
  id: `r-${K}`, month: K, at: `${K}-01T04:00:00.000Z`, by: 'a', good: '', risk: '', steps: [], sent: null, updatedAt: T0,
  v: 3, reason: 'month', reasonKey: `month:${K}`, where: 'Кафе выросло.', work: { ops: 120, found: 1, monthly: 0 }, advices: [advice],
}

type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore>; wallet: ReturnType<typeof vi.fn>; aiReview: ReturnType<typeof vi.fn> }

/** iPhone человека семьи с ИИ (`/auth/me` — `ai: true`): документ, статус Apple Pay, операции с телефона. */
async function phone(server: FakeServer, st: FakeStatements, role: 'member' | 'viewer'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const slot = role === 'viewer' ? 'b' : 'a'
  const auth = useAuthStore()
  auth.setAuthData(authAs(role, slot))
  vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai: true })
  await auth.fetchMe()
  const wallet = vi.fn(async () => ({ ...STATUS }))
  const aiReview = vi.fn(async () => {
    throw new Error('разбор уже в документе — ручка не зовётся')
  })
  const client = {
    ...backend(server), ...statementsFor(st, `u-${slot}`, slot),
    walletStatus: wallet, aiReview,
    fxRates: vi.fn(async (code: string) => ({ code, rates: {}, partial: false })),
  } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  useApplePayStore().userAgent = IPHONE
  await useApplePayStore().load(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store, wallet, aiReview }
}

const queueOpen = () => [screenMixin({ opened: 'queue' })]
/** «Пришла» в строке зарплаты Ильяса — первая строка с `tap` (`useSalaryTap`). */
const tap = () => [screenMixin({}, (s) => (s.tap as () => void)())]
/** Номер карточки у ✦ в куске разметки от якоря до следующего такого же. */
function markIn(html: string, anchor: string, next: RegExp): string | null {
  const from = html.indexOf(anchor)
  if (from < 0) return null
  const rest = html.slice(from + anchor.length)
  const end = rest.search(next)
  return (end < 0 ? rest : rest.slice(0, end)).match(/data-advice-mark[^>]*data-advice-card="(\d)"/)?.[1] ?? null
}
const salaryOct = (p: Phone) => p.store.payments.filter((x) => !x.deletedAt && x.kind === 'salary' && x.targetId === 'a' && x.period === K)

describe('e2e / Apple Pay Блок 2 — повторная приёмка 2026-10-19: «Месяц» с «Разбором» и «Пришла» по пушу', () => {
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
    at('2026-10-15T07:00:00Z')
    st = fakeStatements()
    server = fakeServer(planFamilyDoc({ goals: [...planFamilyDoc().goals, fund], payments: [SEPT_SALARY], aiReviews: [review] }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('участник: пилюля «✦ Разбор», ✦ у подушки и точка у «Пришла» вместе; «Пришла» — на счёт прошлой с операцией пуша, ✦ остаётся', async () => {
    const A = await phone(server, st, 'member')
    expect(serverPush(st, 'u-a', SALARY_PUSH)).toBe('saved')
    setActivePinia(A.pinia)
    await useOperationsStore().pull(A.client)

    const before = await screen(A.pinia, Month, '/month', undefined, queueOpen())
    expect(before).toContain('data-review-open')
    expect(before).toContain('data-arrival-dot')
    expect(before).toContain('data-can-mark')
    expect(markIn(before, 'data-queue="fund"', /data-queue=/)).toBe('1')

    vi.spyOn(apiClient, 'upsertOperations').mockImplementation(A.client.upsertOperations)
    await screen(A.pinia, Month, '/month', undefined, tap())
    await vi.advanceTimersByTimeAsync(0)
    expect(salaryOct(A).map((p) => [p.amount, p.accountId, p.opId])).toEqual([[690_000, 'card', SALARY_PUSH.id]])

    const after = await screen(A.pinia, Month, '/month', undefined, queueOpen())
    expect(after).not.toContain('data-arrival-dot')
    expect(after).toContain('data-review-open')
    expect(markIn(after, 'data-queue="fund"', /data-queue=/)).toBe('1')
    // Разбор уже в документе: ни отметка, ни экраны ручку ИИ не зовут; статус Apple Pay — один раз за вход.
    expect(A.aiReview).not.toHaveBeenCalled()
    expect(A.wallet).toHaveBeenCalledTimes(1)
  })

  it('viewer той же семьи: пилюля и ✦ есть, ни точки, ни «Пришла»; статус Apple Pay не спрашивается', async () => {
    serverPush(st, 'u-a', SALARY_PUSH)
    const V = await phone(server, st, 'viewer')
    const html = await screen(V.pinia, Month, '/month', undefined, queueOpen())
    expect(html).toContain('data-review-open')
    expect(markIn(html, 'data-queue="fund"', /data-queue=/)).toBe('1')
    expect(html).not.toContain('data-arrival-dot')
    expect(html).not.toContain('data-can-mark')
    expect(V.wallet).not.toHaveBeenCalled()
    expect(V.aiReview).not.toHaveBeenCalled()
  })
})
