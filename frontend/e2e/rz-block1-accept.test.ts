import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { ReviewPayloadV3, SyncDoc } from '../src/types/finance'
import type { ReviewFind } from '../src/lib/statements/types'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Приёмка Блока 1 «Разбор» (стенд — Chrome 390, обе темы; здесь — тот же сценарий на фейковом сервере): согласие v3
 * спрошено один раз на человека. «Да» v2 у участника: телефон 1 — лист, закрыл без ответа — ни запроса, ни второго листа
 * до следующего повода; телефон 2 того же человека — лист, «Включить» → один запрос v3 и `v: 3` в личном документе;
 * телефон 1 после этого — без листа и без запроса, видит тот же разбор. Партнёр с «Не надо» v2 — без листа и без
 * запроса (v3 не переспрашивает «нет»), но разбор семьи видит.
 */
const leak = (by: 'a' | 'b', period: string, count: number, amount: number): ReviewFind => ({
  id: `${by}:${period}:leak:apteka plus`, by, period, kind: 'leak', name: 'APTEKA PLUS', categoryId: 'sc_health', count, amount, updatedAt: T0,
})
const familyDoc = (): SyncDoc => planFamilyDoc({ reviewFinds: [leak('a', '2026-08', 8, 12_000), leak('b', '2026-09', 7, 10_000)] })

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

/** Ответ модели: один совет «Открыть покупки у аптеки» с годовой суммой. */
function answerFor(body: ReviewPayloadV3) {
  const apteka = body.actions.find((a) => a.kind === 'open' && a.about === 'открыть покупки у «APTEKA PLUS»')!
  const yearly = body.facts.find((f) => f.about === 'частые траты у «APTEKA PLUS» — за год')!
  return { where: 'Аптека у дома тянет больше, чем кажется.', advices: [{ title: 'Аптека у дома', text: `За год у «APTEKA PLUS» уходит ${yearly.value}.`, figure: yearly.id, action: apteka.id }] }
}

describe('e2e / Разбор Блок 1 — приёмка: согласие v3 один раз', () => {
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
    pv.docs.set('u-a', { rev: 1, data: { aiConsent: { on: true, at: T0, v: 2 } } })
    pv.docs.set('u-b', { rev: 1, data: { aiConsent: { on: false, at: T0, v: 2 } } })
    aiReview = vi.fn(async (body: ReviewPayloadV3) => answerFor(body))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Новый телефон (своё хранилище): вход, `/auth/me` с ИИ, личный документ с сервера. */
  async function as(slot: 'a' | 'b') {
    storage.clear()
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs('member', slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs('member', slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`)
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    const ai = useAiStore()
    ai.sheetMounted = true
    const aiClient = { ...priv, aiReview } as unknown as ApiClient
    return { ...p, ai, priv, aiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sheetHtml = (p: Phone) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])

  it('«да» v2: телефон 1 закрыл лист — 0 запросов и до повода не спрашивает; телефон 2 — «Включить» → 1 запрос v3; телефон 1 и партнёр с «Не надо» — без листа и запроса, разбор тот же', async () => {
    // Телефон 1: лист согласия v3 один раз, закрыл без ответа.
    const one = await as('a')
    expect(one.ai.consent).toBe('unknown')
    const run1 = one.ai.autoReview(one.aiClient)
    await vi.waitFor(() => expect(one.ai.sheetOpen).toBe(true))
    one.ai.answer(null)
    expect(await run1).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
    // Тот же повод на этом телефоне — лист не всплывает, запроса нет; «да» v2 на сервере не тронуто.
    expect(await one.ai.autoReview(one.aiClient)).toBeNull()
    expect(one.ai.sheetOpen).toBe(false)
    expect(aiReview).not.toHaveBeenCalled()
    expect(pv.docs.get('u-a')!.data.aiConsent).toMatchObject({ on: true, v: 2 })

    // Телефон 2 того же человека: свой лист → «Включить» → один запрос v3.
    const two = await as('a')
    const run2 = two.ai.autoReview(two.aiClient)
    await vi.waitFor(() => expect(two.ai.sheetOpen).toBe(true))
    two.ai.answer(true)
    expect(await run2).toMatchObject({ v: 3, reasonKey: 'month:2026-10' })
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(aiReview.mock.calls[0][0]).toMatchObject({ v: 3, reason: 'month' })
    await two.store.syncPrivate(two.priv as unknown as ApiClient)
    await two.store.syncHousehold(two.client)
    expect(pv.docs.get('u-a')!.data.aiConsent).toMatchObject({ on: true, v: 3 })

    // Телефон 1 снова (личный документ подтянут): «да» v3 — ни листа, ни запроса; разбор — тот же.
    const back = await as('a')
    expect(back.ai.consent).toBe('on')
    expect(await back.ai.autoReview(back.aiClient)).toBeNull()
    expect(back.ai.sheetOpen).toBe(false)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(visible(await sheetHtml(back))).toContain('Аптека у дома тянет больше')

    // Партнёр: «Не надо» v2 остаётся «Не надо» — без листа и без запроса; разбор семьи — виден, «Открыть» есть.
    const partner = await as('b')
    expect(partner.ai.consent).toBe('off')
    expect(await partner.ai.autoReview(partner.aiClient)).toBeNull()
    expect(partner.ai.sheetOpen).toBe(false)
    expect(aiReview).toHaveBeenCalledTimes(1)
    const html = await sheetHtml(partner)
    expect(visible(html)).toContain('Аптека у дома тянет больше')
    expect(html).toContain('href="/money/history?cat=sc_health"')
  })
})
