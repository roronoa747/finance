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
    const ai = member()
    const first = ai.ensureConsent()
    const second = ai.ensureConsent()
    expect(ai.sheetOpen).toBe(true)
    ai.answer(true)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.consent).toBe('on')
  })

  it('«Не надо» → false и off (больше не спрашиваем)', async () => {
    const ai = member()
    const p = ai.ensureConsent()
    ai.answer(false)
    await expect(p).resolves.toBe(false)
    expect(ai.consent).toBe('off')
  })

  it('свайп (закрыли) → false без записи: спросим в следующий раз', async () => {
    const ai = member()
    const p = ai.ensureConsent()
    ai.answer(null)
    await expect(p).resolves.toBe(false)
    expect(ai.consent).toBe('unknown')
    expect('aiConsent' in useFinanceStore().privateDoc).toBe(false)
    void ai.ensureConsent()
    expect(ai.sheetOpen).toBe(true)
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
