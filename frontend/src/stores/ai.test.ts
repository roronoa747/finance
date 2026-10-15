import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore, DEMO_TOKEN } from './auth'
import { useFinanceStore } from './finance'
import { useAiStore } from './ai'
import { authAs } from '@/test/planFamily'

/**
 * AI-05 (бэклог «ИИ», Р-7, Р-9, Р-10): ИИ виден только участнику семьи с флагом (не viewer, не демо); согласие —
 * в личном документе; `ensureConsent` спрашивает листом один раз, «Не надо» помнит, свайп — нет.
 */
describe('stores/ai — доступность и согласие', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    setActivePinia(createPinia())
  })

  /** Сервер отдаёт личный документ `data` (AI-09: `ensureConsent` сначала подтягивает его); запись — эхом, как Go. */
  function online(data: Record<string, unknown> = {}) {
    let rev = 1
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') data = (JSON.parse(String(init.body)) as { data: Record<string, unknown> }).data
      if (init?.method === 'POST') rev++
      return new Response(JSON.stringify({ rev, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchFn)
    return fetchFn
  }

  // Лист согласия смонтирован, как в оболочке (`AiConsentSheet`).
  function member(ai = true) {
    const auth = useAuthStore()
    auth.setAuthData(authAs('member'))
    auth.ai = ai
    const store = useAiStore()
    store.sheetMounted = true
    return store
  }

  it('available — только участнику семьи с ИИ: не без флага, не viewer, не в демо', () => {
    expect(member(false).available).toBe(false)
    expect(member(true).available).toBe(true)

    const auth = useAuthStore()
    auth.setAuthData(authAs('viewer', 'b'))
    auth.ai = true
    expect(useAiStore().available).toBe(false)

    auth.setAuthData({ ...authAs('member'), token: DEMO_TOKEN })
    auth.ai = true
    expect(useAiStore().available).toBe(false)
  })

  it('consent читается из privateDoc.aiConsent; setConsent пишет туда же с временем', () => {
    const ai = member()
    expect(ai.consent).toBe('unknown')
    ai.setConsent(true)
    const c = useFinanceStore().privateDoc.aiConsent as { on: boolean; at: string }
    expect(c.on).toBe(true)
    expect(Number.isNaN(Date.parse(c.at))).toBe(false)
    expect(ai.consent).toBe('on')
    ai.setConsent(false)
    expect(ai.consent).toBe('off')
    // Согласие — личное: в общий документ оно не попадает.
    expect('aiConsent' in useFinanceStore().householdDoc).toBe(false)
  })

  it('ensureConsent: on → true без листа; off → false без листа', async () => {
    const ai = member()
    ai.setConsent(true)
    await expect(ai.ensureConsent()).resolves.toBe(true)
    expect(ai.sheetOpen).toBe(false)
    ai.setConsent(false)
    await expect(ai.ensureConsent()).resolves.toBe(false)
    expect(ai.sheetOpen).toBe(false)
  })

  it('не спрошено → лист; «Включить» → true и on; повторный вызов ждёт тот же ответ', async () => {
    online()
    const ai = member()
    const first = ai.ensureConsent()
    const second = ai.ensureConsent()
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(true)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.consent).toBe('on')
  })

  it('«Не надо» → false и off (больше не спрашиваем)', async () => {
    online()
    const ai = member()
    const p = ai.ensureConsent()
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(false)
    await expect(p).resolves.toBe(false)
    expect(ai.consent).toBe('off')
  })

  it('свайп (закрыли) → false без записи: спросим в следующий раз', async () => {
    online()
    const ai = member()
    const p = ai.ensureConsent()
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(null)
    await expect(p).resolves.toBe(false)
    expect(ai.consent).toBe('unknown')
    expect('aiConsent' in useFinanceStore().privateDoc).toBe(false)
    void ai.ensureConsent()
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
  })

  // Хвост §4 ревью frontend Блока 1 (Н-4), AI-09: новый телефон до синка не спрашивает второй раз.
  it('не спрошено здесь, а на сервере «да» (другой телефон человека) → true без листа', async () => {
    const fetchFn = online({ aiConsent: { on: true, at: '2026-10-15T08:00:00.000Z' } })
    const ai = member()
    await expect(ai.ensureConsent()).resolves.toBe(true)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.consent).toBe('on')
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('/sync/private')
  })

  it('не спрошено и нет сети → false без листа, consentFailed; «Не надо» отсюда не перепишет чужое «да»', async () => {
    const ai = member()
    await expect(ai.ensureConsent()).resolves.toBe(false)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.consentFailed).toBe(true)
    expect('aiConsent' in useFinanceStore().privateDoc).toBe(false)
  })

  it('листа нет (экран вне оболочки) — false сразу, а не вечное ожидание', async () => {
    const ai = member()
    ai.sheetMounted = false
    await expect(ai.ensureConsent()).resolves.toBe(false)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.consent).toBe('unknown')
  })

  it('без доступа — false и листа нет', async () => {
    const ai = member(false)
    await expect(ai.ensureConsent()).resolves.toBe(false)
    expect(ai.sheetOpen).toBe(false)
  })
})
