import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { apiClient, type AdminMetrics, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { AdminFamilies, MeResponse, WalletStatus } from '../src/types/api'
import Settings from '../src/views/Settings.vue'
import Admin from '../src/views/Admin.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

/**
 * Повторная приёмка Блока 2 «Пуши банков» бэклога «Apple Pay» (2026-10-18, ветка после мёржа `origin/main` `9a982ef` —
 * ИИ Блоки 2–3): ИИ с `main` и Apple Pay живут на одних экранах, мёрж ни одного не потерял. (а) iPhone участника
 * семьи с ИИ — в настройках обе карточки: «Apple Pay» (подключено, «Пуши банков») и «ИИ»; (б) viewer той же семьи —
 * ни одной, статус Apple Pay не спрашивается; (в) «Цифры» владельца — семьи с ИИ и расходом «из $2» и строка «Пуши за
 * 7 дней» на одном экране. Стенд то же видел браузером (390 px, обе темы). Почты и числа — синтетические.
 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const STATUS: WalletStatus = {
  connected: true, phones: 1,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
  push_shortcut_url: 'https://www.icloud.com/shortcuts/stub-push',
}

describe('e2e / Apple Pay Блок 2 — повторная приёмка: ИИ и Apple Pay после мёржа main', () => {
  const storage = new Map<string, string>()
  let server: FakeServer

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
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** iPhone человека семьи с ИИ: вход, `/auth/me` с `ai: true`, статус Apple Pay — с подключённым телефоном. */
  async function iphone(role: 'member' | 'viewer') {
    const p = await phone(server)
    setActivePinia(p.pinia)
    const auth = useAuthStore()
    auth.setAuthData(authAs(role, 'a'))
    vi.spyOn(apiClient, 'me').mockResolvedValueOnce({ ...(authAs(role, 'a') as unknown as MeResponse), ai: true })
    await auth.fetchMe()
    const wallet = vi.fn(async () => ({ ...STATUS }))
    const ap = useApplePayStore()
    ap.userAgent = IPHONE
    await ap.load({ walletStatus: wallet } as unknown as ApiClient)
    return { ...p, wallet }
  }

  it('(а) участник семьи с ИИ на iPhone: карточки «Apple Pay» (с «Пуши банков») и «ИИ» — обе в настройках', async () => {
    const p = await iphone('member')
    expect(p.wallet).toHaveBeenCalledTimes(1)
    const html = await screen(p.pinia, Settings, '/settings')
    expect(html).toContain('data-applepay-card')
    expect(html).toMatch(/data-applepay-card[^>]*data-connected="true"/)
    expect(html).toContain('data-push')
    expect(html).toContain('data-ai-card')
    // Порядок мёржа: Apple Pay — над «ИИ» (обе стороны дописали соседние строки, ни одна не потерялась).
    expect(html.indexOf('data-applepay-card')).toBeLessThan(html.indexOf('data-ai-card'))
  })

  it('(б) viewer той же семьи: ни «Apple Pay», ни «ИИ», статус телефона не спрашивается', async () => {
    const v = await iphone('viewer')
    expect(v.wallet).not.toHaveBeenCalled()
    const html = await screen(v.pinia, Settings, '/settings')
    expect(html).not.toContain('data-applepay-card')
    expect(html).not.toContain('data-ai-card')
  })

  it('(в) «Цифры»: семьи с ИИ и расходом «из $2» и «Пуши за 7 дней» — на одном экране', async () => {
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs('member', 'a'))
    const families: AdminFamilies = {
      families: [{ id: 'h-2', created_at: '2026-10-01T00:00:00Z', emails: ['bota@example.com'], ai: true, month: '2026-10', requests: 7, cost_micros: 1_500_000, last_active_at: null }],
      limit_micros: 2_000_000,
      key: true,
    }
    const metrics: AdminMetrics = {
      users: 1, households: 1, households_with_upload: 0, second_upload_14d: { eligible: 0, retained: 0 },
      active_7d: 0, active_28d: 0, funnel_28d: { created: 0, uploaded: 0, goal: 0, done: 0 }, weeks: [],
      push_stats: [{ bank: 'kaspi', d7: { parsed: 4, ignored: 1, unknown: 2 }, d30: { parsed: 9, ignored: 2, unknown: 3 } }],
    }
    const html = await screen(createPinia(), Admin, '/admin', undefined, [screenMixin({ families, metrics, state: 'ok' })])
    expect(html).toContain('data-families')
    expect(html).toContain('bota@example.com')
    expect(html).toMatch(/из \$2/)
    expect(html).toContain('data-push-stats')
    expect(html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ')).toContain('разобрано 4 · не разобрано 2')
  })
})
