import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { Goal, Payment, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import Week from '../src/views/Week.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Приёмка Блока 3 «ИИ-польза» (2026-10-17): сценарий стенда, которого не было в наборе. 1-е число, разбор месяца пришёл
 * сам — точка на «Плане» и сегменте «Месяц». Своя валютная зарплата прошлого месяца пришла и не разложена (`planCall`
 * = прошлый месяц, Р-97) — «Месяц» с «Недели» ведёт в прошлый месяц (`?month=`), где ✦ нет: разбор этого месяца там не
 * открыть, точка не гаснет. На стенде — та же картина (1 и 17 ноября: «Месяц» → октябрь, разбор ноября — только через
 * «›»): не только 1-го, а весь месяц, пока своя зарплата прошлого месяца не разложена.
 * (б) — расхождение приёмки, закрыто возвратом AU-33: пока точка нового разбора есть, «Месяц» ведёт в этот месяц.
 */
/** Ответ ручки v3 (RZ-05): совет «Сделать» на первое действие семьи (`a1`). */
const ANSWER = { where: 'Копим на «Машину».', advices: [{ title: 'Отложим в подушку', text: 'Подушки мало.', figure: null as string | null, action: 'a1' }] }
const fund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
/** Сентябрьская зарплата a пришла в евро («Пришла», ручная валютная) и не разложена — `salaryToAllocate` → сентябрь. */
const septSalary: Payment = {
  id: 'pay-sep', kind: 'salary', targetId: 'a', period: '2026-09', amount: 700_000, foreign: 1_400, currency: 'EUR', by: 'a',
  accountId: null, at: '2026-09-10T05:00:00.000Z', updatedAt: '2026-09-10T05:00:00.000Z',
} as Payment
const familyDoc = (): SyncDoc => {
  const d = planFamilyDoc({ goals: [...planFamilyDoc().goals, fund] })
  return { ...d, payments: [...(d.payments ?? []), septSalary] }
}

describe('e2e / приёмка ИИ-польза Блок 3 — 1-е число и «Месяц» с точкой', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let pv: FakePrivate
  let aiReview: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    vi.useFakeTimers({ toFake: ['Date'] })
    // 1 октября, 09:00 по Алматы — первый вход в месяце.
    at('2026-10-01T04:00:00Z')
    server = fakeServer(familyDoc())
    pv = fakePrivate()
    pv.docs.set('u-a', { rev: 1, data: { aiConsent: { on: true, at: T0, v: 3 } } })
    aiReview = vi.fn(async (_body: unknown) => ANSWER)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function member({ waitReview = true } = {}) {
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs('member', 'a'))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs('member', 'a') as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, 'u-a')
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    const ai = useAiStore()
    ai.sheetMounted = true
    const run = ai.autoReview({ ...priv, aiReview } as unknown as ApiClient)
    if (waitReview) await run
    return { ...p, ai }
  }

  /** Куда ведёт сегмент «Месяц» на «Неделе» и есть ли на нём точка (`PlanSwitch`: `month` → `?month=`). */
  async function segment(pinia: Awaited<ReturnType<typeof member>>['pinia']) {
    const seen: { month?: string | null; dot?: boolean } = {}
    await screen(pinia, Week, '/week', undefined, [
      screenMixin({}, (s) => {
        void s.OPTIONS
        const props = s.props as { month?: string | null; dot?: boolean }
        seen.month = props.month ?? null
        seen.dot = !!props.dot
      }),
    ])
    return seen
  }

  it('(а) 1-е число: разбор пришёл сам, точка у сегмента «Месяц»; «Месяц» с «Недели» зовёт в прошлый месяц (planCall)', async () => {
    const one = await member()
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(one.ai.reviewUnseen).toBe(true)
    expect(one.store.planCall()).toBe('2026-09')
    const seg = await segment(one.pinia)
    expect(seg.dot).toBe(true)
    // Этот месяц — ✦ с точкой: разбор открывается здесь.
    expect(await screen(one.pinia, Month, '/month')).toContain('data-review-dot')
  })

  it('(б) сегмент «Месяц» с точкой ведёт туда, где разбор виден (✦)', async () => {
    const one = await member()
    const seg = await segment(one.pinia)
    expect(seg.dot).toBe(true)
    const html = await screen(one.pinia, Month, seg.month ? `/month?month=${seg.month}` : '/month')
    expect(html).toContain('data-review-open')
  })

  it('(в) открыл разбор — точка ушла, «Месяц» снова зовёт в прошлый месяц (planCall)', async () => {
    const one = await member()
    expect((await segment(one.pinia)).month).toBeNull()
    one.ai.markReviewSeen(one.store.aiReviewOf('2026-10')!.id)
    const seg = await segment(one.pinia)
    expect(seg.dot).toBe(false)
    expect(seg.month).toBe('2026-09')
  })

  /**
   * Повторная приёмка (2026-10-17), п. 2 возврата AU-33 на стенде: телефон закрыли, пока ответ Claude не пришёл
   * (5–11 с, до 55 с с повтором). Ответ оплачен, но в документ не попал. Перезапуск в тот же день — без нового
   * запроса (попытка записана до запроса), назавтра — повод снова.
   */
  it('(г) закрыли телефон посреди запроса — в тот же день перезапуск не платит, назавтра — снова', async () => {
    aiReview = vi.fn(() => new Promise<typeof ANSWER>(() => {}))
    const one = await member({ waitReview: false })
    await vi.waitFor(() => expect(aiReview).toHaveBeenCalledTimes(1))
    expect(one.store.aiReviewOf('2026-10')).toBeFalsy()

    aiReview = vi.fn(async (_body: unknown) => ANSWER)
    at('2026-10-01T13:00:00Z')
    const again = await member()
    expect(aiReview).not.toHaveBeenCalled()
    expect(again.store.aiReviewOf('2026-10')).toBeFalsy()

    at('2026-10-02T05:00:00Z')
    const tomorrow = await member()
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(tomorrow.store.aiReviewOf('2026-10')).toBeTruthy()
  })
})
