import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, ApiError, type ApiClient } from '../src/api/client'
import { DEMO_REVIEW, startDemo } from '../src/lib/demo'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Блок 2 «ИИ» (AI-07…AI-10): разбор месяца на двух телефонах против фейкового сервера документа и фейковой ручки
 * `/api/ai/review`. (а) участник запускает разбор → партнёр после синка видит тот же текст без своего запроса; в
 * исходящем теле нет имён, заметок, желаний и личного документа; (б) viewer читает, не запускает; (в) лимит — «ИИ
 * вернётся 1 ноября»; (г) демо — заготовка «Пример» без запросов. Экраны — SSR (`screen`), браузер — стенд §6.
 */
/** Разбор v1, сохранённый в документе до v2 (читается как раньше). */
const stored = {
  good: 'Платежи и траты покрыты.',
  risk: 'Кредитка под 40% — самый дорогой долг.',
  steps: [
    { text: 'Посмотрим долги.', screen: '/money/debts' },
    { text: 'Обсудим план трат вдвоём.', screen: null },
  ],
}
/** Ответ ручки — v3 (бэклог «Разбор», RZ-05): совет на первое действие семьи (`a1` — досрочно). */
const answer = { where: stored.good, advices: [{ title: 'Долги', text: stored.risk, figure: null, action: 'a1' }] }

/** Семья с тем, что не должно уйти: имена, заметки, причина версии, желание; личный документ — отдельно. */
function familyDoc(): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    people: doc.people.map((p) => (p.id === 'a' ? { ...p, salaryVersions: [{ from: '2026-01', amount: 700_000, reason: 'секрет-повышение' } as never] } : p)),
    obligations: doc.obligations.map((o) => ({ ...o, note: 'секрет-хозяйка Галина' })),
    wishlist: [{ id: 'w1', name: 'Тайное кольцо', price: 900_000, by: 'a', list: 'a', bought: false, addedOn: T0, updatedAt: T0 }],
  })
}

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
/** Текст листа разбора — от его диалога (SSR рисует лист на месте, без Teleport); пусто — лист закрыт. */
const sheet = (html: string) => {
  const i = html.search(/data-review-(example|good|where|state)/)
  if (i < 0) return ''
  const d = html.lastIndexOf('role="dialog"', i)
  return visible(html.slice(d < 0 ? i : d))
}

describe('e2e / ИИ Блок 2 — разбор месяца', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let pv: FakePrivate

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    // Фоновый синк стора уходит в настоящий клиент — «нет сети»; телефоны синкаются явно своим клиентом.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    vi.useFakeTimers({ toFake: ['Date'] })
    at('2026-10-12T07:00:00Z')
    server = fakeServer(familyDoc())
    pv = fakePrivate()
    pv.docs.set('u-a', { rev: 1, data: { accounts: [{ id: 'own', name: 'секрет-счёт Депозит', updatedAt: T0 }], merchantRules: [{ id: 'r', match: 'секрет-продавец', to: 'sc_food', updatedAt: T0 }] } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Телефон человека: документ семьи с сервера, вход и `/auth/me` с ИИ, личный документ — свой. */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', ai = true) {
    const p = await phone(server)
    setActivePinia(p.pinia)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, slot) as unknown as MeResponse), ai })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`) as unknown as ApiClient
    await useFinanceStore().pullPrivateDoc(priv)
    return { ...p, priv }
  }
  type Phone = Awaited<ReturnType<typeof as>>

  /** Нажатие кнопки у остатка (`MonthPlan.openReview`) и ожидание исхода. */
  async function tapReview(p: Phone) {
    await screen(p.pinia, Month, '/month', undefined, [screenMixin({}, (s) => void (s.openReview as () => Promise<void>)())])
    setActivePinia(p.pinia)
    await vi.waitFor(() => expect(useAiStore().reviewState).not.toBe('thinking'))
  }
  const opened = (p: Phone) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])

  it('(а) телефон 1 разбирает месяц → партнёр после синка видит тот же текст, своих запросов — 0; ушла только сводка', async () => {
    const review = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    const one = await as('member', 'a')
    useAiStore().setConsent(true)
    await tapReview(one)
    expect(review).toHaveBeenCalledTimes(1)
    expect(one.store.householdDoc.aiReviews).toHaveLength(1)

    // Исходящее тело: факты разбора v3 (AU-11, RZ-03) — ни имён, ни заметок, ни причины версии, ни желаний, ни личного документа.
    const body = JSON.stringify(review.mock.calls[0][0])
    for (const bad of ['Ильяс', 'Аруна', 'секрет', 'Галина', 'кольцо', 'Депозит']) expect(body, bad).not.toContain(bad)
    expect(body).toContain('"facts"')

    let html = sheet(await opened(one))
    expect(html).toContain(answer.where)
    expect(html).toContain(answer.advices[0].text)

    setActivePinia(one.pinia)
    await one.store.syncHousehold(one.client)
    expect(JSON.stringify(server.data.aiReviews)).toContain(answer.advices[0].text)

    // Партнёр — другой телефон: тот же разбор из документа, без запроса.
    storage.clear()
    review.mockClear()
    const two = await as('member', 'b')
    html = sheet(await opened(two))
    expect(html).toContain(answer.where)
    expect(html).toContain(answer.advices[0].text)
    // Открытие сохранённого — без запроса (кнопка у остатка открывает лист с ним).
    await tapReview(two)
    expect(review).not.toHaveBeenCalled()
  })

  it('(б) viewer: видит сохранённый разбор, кнопки запуска и «Обновить» нет, запросов нет', async () => {
    const review = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    // Разбор семьи — суточной давности: участнику «Обновить» было бы видно.
    server.data.aiReviews = [{ id: 'r0', month: '2026-10', at: '2026-10-10T07:00:00.000Z', by: 'a', ...stored, sent: null, updatedAt: T0 }]
    const v = await as('viewer', 'b')
    expect(useAiStore().available).toBe(false)
    const html = await opened(v)
    expect(html).toContain('data-review-open')
    expect(sheet(html)).toContain(answer.where)
    expect(html).not.toContain('data-review-refresh')
    await tapReview(v)
    expect(review).not.toHaveBeenCalled()

    // Без сохранённого разбора у viewer кнопки нет.
    server.data.aiReviews = []
    storage.clear()
    const v2 = await as('viewer', 'b')
    expect(await screen(v2.pinia, Month, '/month')).not.toContain('data-review-open')
  })

  it('(в) лимит семьи (429 ai_limit) — «ИИ вернётся 1 ноября», в документе ничего', async () => {
    vi.spyOn(apiClient, 'aiReview').mockRejectedValue(new ApiError('ai_limit', 429, { error: 'ai_limit' }))
    const one = await as('member', 'a')
    useAiStore().setConsent(true)
    await tapReview(one)
    expect(useAiStore().reviewState).toBe('limit')
    expect(one.store.householdDoc.aiReviews ?? []).toHaveLength(0)
    expect(sheet(await opened(one))).toContain('ИИ вернётся 1 ноября')
  })

  it('(г) демо: «Разобрать» → заготовка «Пример» со сводкой демо, без запросов и без записи в документ', async () => {
    const review = vi.spyOn(apiClient, 'aiReview')
    const pinia = createPinia()
    setActivePinia(pinia)
    expect(startDemo()).toBe(true)
    await nextTick()
    await nextTick()
    const html = await screen(pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])
    const text = sheet(html)
    expect(text).toContain('Пример')
    expect(text).toContain(visible(DEMO_REVIEW.good))
    expect(html).not.toContain('data-review-refresh')
    setActivePinia(pinia)
    expect(useFinanceStore().householdDoc.aiReviews ?? []).toHaveLength(0)
    expect(review).not.toHaveBeenCalled()
  })
})
