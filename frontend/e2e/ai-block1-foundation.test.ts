import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type AdminMetrics, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useAiStore } from '../src/stores/ai'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { AdminFamilies, MeResponse } from '../src/types/api'
import AppShell from '../src/components/AppShell.vue'
import Settings from '../src/views/Settings.vue'
import Admin from '../src/views/Admin.vue'
import { at, fakePrivate, fakeServer, phone, privateFor, screen, type FakePrivate, type FakeServer } from './support/family'

/**
 * Блок 1 «ИИ» (AI-02…AI-05): фейковый `/auth/me` с `ai`, фейковые личные документы и ручки админки. (а) семья без ИИ —
 * ни карточки «ИИ», ни листа согласия; (б) участник включает «Помощник» на телефоне 1 — после синка личного документа
 * телефон 2 того же человека видит «вкл», партнёр — своё согласие «не спрошено»; (в) viewer семьи с ИИ — без карточки;
 * (г) админ включает ИИ семье — уходит PUT `{on: true}`. Экраны — SSR (`screen`), браузер — стенд §6.
 */
describe('e2e / ИИ Блок 1 — фундамент: флаг семьи, согласие, админка', () => {
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
    vi.useFakeTimers({ toFake: ['Date'] })
    at('2026-10-15T07:00:00Z')
    server = fakeServer(planFamilyDoc())
    pv = fakePrivate()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Телефон человека: стор семьи с сервера, вход и `/auth/me` с флагом ИИ семьи, личный документ — свой. */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b', ai: boolean) {
    const p = await phone(server)
    setActivePinia(p.pinia)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, slot))
    const me = authAs(role, slot) as unknown as MeResponse
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...me, ai })
    await auth.fetchMe()
    const priv = privateFor(pv, `u-${slot}`) as unknown as ApiClient
    await useFinanceStore().pullPrivateDoc(priv)
    return { ...p, priv }
  }
  const card = (html: string) => html.includes('data-ai-card')
  const switchOn = (html: string) => {
    const at = html.indexOf('data-ai-card')
    return html.slice(at).match(/role="switch" aria-checked="(true|false)"/)?.[1] === 'true'
  }

  it('(а) семья без ИИ: в настройках нет карточки «ИИ», лист согласия не открывается', async () => {
    const p = await as('member', 'a', false)
    expect(useAuthStore().ai).toBe(false)
    expect(card(await screen(p.pinia, Settings, '/settings'))).toBe(false)

    setActivePinia(p.pinia)
    const ai = useAiStore()
    await expect(ai.ensureConsent()).resolves.toBe(false)
    expect(ai.sheetOpen).toBe(false)
    expect(await screen(p.pinia, AppShell, '/settings')).not.toContain('data-ai-consent')
  })

  it('(б) телефон 1 включает «Помощник» → телефон 2 того же человека после синка видит «вкл»; партнёр — не спрошено', async () => {
    const one = await as('member', 'a', true)
    let html = await screen(one.pinia, Settings, '/settings')
    expect(card(html)).toBe(true)
    expect(switchOn(html)).toBe(false)

    // Нажатие тумблера карточки — `ai.setConsent(true)`; личный документ уходит на сервер.
    setActivePinia(one.pinia)
    useAiStore().setConsent(true)
    await useFinanceStore().syncPrivate(one.priv)
    expect(pv.docs.get('u-a')?.data.aiConsent).toMatchObject({ on: true })
    expect(JSON.stringify(server.data)).not.toContain('aiConsent')

    // Телефон 2 того же человека: своё хранилище, документ — с сервера.
    storage.clear()
    const two = await as('member', 'a', true)
    html = await screen(two.pinia, Settings, '/settings')
    expect(switchOn(html)).toBe(true)
    setActivePinia(two.pinia)
    await expect(useAiStore().ensureConsent()).resolves.toBe(true)

    // Партнёр — другой человек: его согласие не спрошено, ensureConsent откроет лист.
    storage.clear()
    const partner = await as('member', 'b', true)
    html = await screen(partner.pinia, Settings, '/settings')
    expect(card(html)).toBe(true)
    expect(switchOn(html)).toBe(false)
    setActivePinia(partner.pinia)
    const ai = useAiStore()
    expect(ai.consent).toBe('unknown')
    // Оболочка с листом открыта (screen рисует строкой — onMounted листа не бывает).
    ai.sheetMounted = true
    void ai.ensureConsent()
    expect(ai.sheetOpen).toBe(true)
    const shell = await screen(partner.pinia, AppShell, '/settings')
    expect(shell).toContain('data-ai-consent')
    expect(shell).toContain('Названия продавцов')
  })

  it('(в) viewer семьи с ИИ: карточки нет, согласие не спрашивается', async () => {
    const v = await as('viewer', 'b', true)
    expect(useAuthStore().ai).toBe(true)
    expect(card(await screen(v.pinia, Settings, '/settings'))).toBe(false)
    setActivePinia(v.pinia)
    await expect(useAiStore().ensureConsent()).resolves.toBe(false)
    expect(useAiStore().sheetOpen).toBe(false)
  })

  it('(г) админ: список семей → включить ИИ семье → ушёл PUT {on: true}', async () => {
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs('member', 'a'))
    const list: AdminFamilies = {
      families: [{ id: 'h-2', created_at: '2026-10-01T00:00:00Z', emails: ['bota@example.com'], ai: false, month: '2026-10', requests: 0, cost_micros: 0 }],
      limit: 30,
      key: true,
    }
    const metrics: AdminMetrics = {
      users: 1, households: 1, households_with_upload: 0, second_upload_14d: { eligible: 0, retained: 0 },
      active_7d: 0, active_28d: 0, funnel_28d: { created: 0, uploaded: 0, goal: 0, done: 0 }, weeks: [],
    }
    const calls: { url: string; method: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null })
      return new Response(JSON.stringify({ ...list.families[0], ai: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const html = await screen(createPinia(), Admin, '/admin', undefined, [
      screenMixin({ families: structuredClone(list), metrics, state: 'ok' }, (s) => void (s.setAi as (id: string, on: boolean) => Promise<void>)('h-2', true)),
    ])
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ url: '/api/admin/families/h-2/ai', method: 'PUT', body: { on: true } })
    expect(html).toContain('bota@example.com')
    expect(html).toMatch(/data-family="h-2"[\s\S]*?role="switch" aria-checked="true"/)
  })
})
