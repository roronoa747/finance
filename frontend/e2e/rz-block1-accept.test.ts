import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { leadFor, seedOwnMonth } from '../src/test/reviewV4'
import { screenMixin } from '../src/test/screenState'
import type { MeResponse } from '../src/types/api'
import type { SyncDoc } from '../src/types/finance'
import type { ReviewFind } from '../src/lib/statements/types'
import Month from '../src/views/Month.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer, noStatements } from './support/family'

/**
 * Приёмка Блока 1 «Разбор» (стенд — Chrome 390, обе темы; здесь — тот же сценарий на фейковом сервере): согласие v3
 * спрошено один раз на человека. «Да» v2 у участника: телефон 1 — лист, закрыл без ответа — ни запроса, ни второго листа
 * до следующего повода; телефон 2 того же человека — лист, «Включить» → один запрос (v4 — бэклог «Фидбек», Р-26) и
 * `v: 3` согласия в личном документе; телефон 1 после этого — без листа и без запроса, видит свой разбор (личный документ,
 * Р-27). Партнёр с «Не надо» v2 — без листа и без запроса (v3 не переспрашивает «нет»); мой разбор ему не виден (Р-27).
 */
const leak = (by: 'a' | 'b', period: string, count: number, amount: number): ReviewFind => ({
  id: `${by}:${period}:leak:apteka plus`, by, period, kind: 'leak', name: 'APTEKA PLUS', categoryId: 'sc_health', count, amount, updatedAt: T0,
})
const familyDoc = (): SyncDoc => planFamilyDoc({ reviewFinds: [leak('a', '2026-08', 8, 12_000), leak('b', '2026-09', 7, 10_000)] })

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const K = '2026-10'

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
    aiReview = vi.fn(async (body: unknown) => leadFor(body))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Новый телефон (своё хранилище): вход, `/auth/me` с ИИ, личный документ с сервера; у `a` — свой месяц на телефоне. */
  async function as(slot: 'a' | 'b') {
    storage.clear()
    const p = await phone(server)
    const auth = useAuthStore()
    auth.setAuthData(authAs('member', slot))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs('member', slot) as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`)
    await useFinanceStore().pullPrivateDoc(priv as unknown as ApiClient)
    if (slot === 'a') await seedOwnMonth(K, 'a')
    const ai = useAiStore()
    ai.sheetMounted = true
    const aiClient = { ...priv, ...noStatements(), aiReview } as unknown as ApiClient
    return { ...p, ai, priv, aiClient }
  }
  type Phone = Awaited<ReturnType<typeof as>>
  const sheetHtml = (p: Phone) => screen(p.pinia, Month, '/month', undefined, [screenMixin({ reviewOpen: true })])

  it('«да» v2: телефон 1 закрыл лист — 0 запросов и до повода не спрашивает; телефон 2 — «Включить» → 1 запрос v4; телефон 1 — без листа и запроса, свой разбор; партнёр с «Не надо» — без листа и запроса, моего разбора не видит', async () => {
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

    // Телефон 2 того же человека: свой лист → «Включить» → один запрос v4.
    const two = await as('a')
    const run2 = two.ai.autoReview(two.aiClient)
    await vi.waitFor(() => expect(two.ai.sheetOpen).toBe(true))
    two.ai.answer(true)
    expect(await run2).toMatchObject({ v: 4, reasonKey: `month:${K}` })
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(aiReview.mock.calls[0][0]).toMatchObject({ v: 4, reason: 'month' })
    await two.store.syncPrivate(two.priv as unknown as ApiClient)
    await two.store.syncHousehold(two.client)
    expect(pv.docs.get('u-a')!.data.aiConsent).toMatchObject({ on: true, v: 3 })

    // Телефон 1 снова (личный документ подтянут): «да» v3 и свой разбор месяца — ни листа, ни запроса; разбор тот же.
    const back = await as('a')
    expect(back.ai.consent).toBe('on')
    expect(await back.ai.autoReview(back.aiClient)).toBeNull()
    expect(back.ai.sheetOpen).toBe(false)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(visible(await sheetHtml(back))).toContain('Разберём траты без раздела.')

    // Партнёр: «Не надо» v2 остаётся «Не надо» — без листа и без запроса; мой разбор — в моём личном документе, ему не виден.
    const partner = await as('b')
    expect(partner.ai.consent).toBe('off')
    expect(await partner.ai.autoReview(partner.aiClient)).toBeNull()
    expect(partner.ai.sheetOpen).toBe(false)
    expect(aiReview).toHaveBeenCalledTimes(1)
    expect(partner.store.aiReviewOf(K)).toBeNull()
    expect(visible(await sheetHtml(partner))).not.toContain('Разберём траты без раздела.')
  })
})
