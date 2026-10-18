// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { useFinanceStore } from '@/stores/finance'
import { authAs } from '@/test/planFamily'
import Settings from '@/views/Settings.vue'
import AiConsentSheet from './AiConsentSheet.vue'

/**
 * AI-05 (бэклог «ИИ», Р-9, правило 12): карточка «ИИ» в настройках — только участнику семьи с ИИ, тумблер — своё
 * согласие в личном документе; лист согласия — три пункта «что уходит», ссылка на политику, «Включить» / «Не надо».
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  // Сервер знает только личный документ (AI-09: `ensureConsent` сначала подтягивает его; запись — эхом, как Go);
  // прочее — «нет сети».
  let priv: { rev: number; data: Record<string, unknown> } = { rev: 1, data: {} }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/sync/private')) throw new Error('офлайн')
      if (init?.method === 'POST') priv = { rev: priv.rev + 1, data: (JSON.parse(String(init.body)) as { data: Record<string, unknown> }).data }
      return new Response(JSON.stringify(priv), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  setActivePinia(createPinia())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mount(comp: Component, path: string): Promise<HTMLElement> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  app = createApp(comp)
  app.use(router)
  app.mount(el)
  await settle()
  return el
}

function signIn(role: 'member' | 'viewer', ai: boolean) {
  const auth = useAuthStore()
  auth.setAuthData(authAs(role, role === 'viewer' ? 'b' : 'a'))
  auth.ai = ai
}

describe('AI-05: карточка «ИИ» в настройках', () => {
  it('нет у семьи без ИИ и у viewer', async () => {
    signIn('member', false)
    let el = await mount(Settings, '/settings')
    expect(el.querySelector('[data-ai-card]')).toBeNull()
    app!.unmount()

    setActivePinia(createPinia())
    signIn('viewer', true)
    el = await mount(Settings, '/settings')
    expect(el.querySelector('[data-ai-card]')).toBeNull()
  })

  it('участнику семьи с ИИ — тумблер «Помощник» пишет aiConsent в личный документ, без листа', async () => {
    signIn('member', true)
    const el = await mount(Settings, '/settings')
    const card = el.querySelector('[data-ai-card]')!
    expect(card.textContent).toContain('Claude · без ваших имён')
    // Подсказка — одной фразой, кто получает и что (слова утвердил владелец на /ux, 2026-10-15; названия статей уходят
    // как есть — «без ваших имён», владелец 2026-10-16, ревью frontend Блока 2 Н-3).
    card.querySelector<HTMLButtonElement>('button[aria-label="Что уходит"]')!.click()
    await settle()
    expect(document.body.textContent).toContain(
      'Claude от Anthropic получает цифры месяца и названия статей без ваших имён, продавцов и суммы частых трат и списаний, скриншот товара, фото чека и фразу о мечте. Разбор приходит сам — 1-го и после зарплаты. На ваших данных не обучается.',
    )
    const sw = card.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(sw.getAttribute('aria-checked')).toBe('false')

    sw.click()
    await settle()
    expect((useFinanceStore().privateDoc.aiConsent as { on: boolean }).on).toBe(true)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(useAiStore().sheetOpen).toBe(false)

    sw.click()
    await settle()
    expect((useFinanceStore().privateDoc.aiConsent as { on: boolean }).on).toBe(false)
  })
})

describe('AI-05: лист согласия', () => {
  it('пять пунктов (v3), «когда» — строкой под ними (Х-16), Anthropic, «Подробнее» → /privacy; «Включить» — согласие, лист закрыт', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const ai = useAiStore()
    const answer = ai.ensureConsent()
    await settle()

    const items = [...document.querySelectorAll('[data-ai-consent] li')].map((li) => li.textContent!.trim())
    expect(document.querySelector('[data-ai-to]')!.textContent).toBe('Claude от Anthropic получит:')
    expect(items).toEqual([
      'Цифры месяца и названия статей без ваших имён',
      'Продавцы и суммы частых трат и списаний',
      'Скриншот товара',
      'Фото чека',
      'Фраза о мечте',
    ])
    expect(document.querySelector('[data-ai-auto]')!.textContent).toBe('Разбор приходит сам — 1-го и после зарплаты.')
    expect(document.body.textContent).toContain('На ваших данных не обучается.')
    expect(document.querySelector('[data-ai-privacy]')!.getAttribute('href')).toBe('/privacy')

    document.querySelector<HTMLButtonElement>('[data-ai-yes]')!.click()
    await expect(answer).resolves.toBe(true)
    await settle()
    expect(ai.consent).toBe('on')
    expect(document.querySelector('[data-ai-consent]')).toBeNull()
  })

  it('«Не надо» — нет и запомнено', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const ai = useAiStore()
    const answer = ai.ensureConsent()
    await settle()
    document.querySelector<HTMLButtonElement>('[data-ai-no]')!.click()
    await expect(answer).resolves.toBe(false)
    expect(ai.consent).toBe('off')
  })

  it('крестик, «Подробнее», уход с экрана — на этот раз нет, вопрос остаётся', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const ai = useAiStore()

    let answer = ai.ensureConsent()
    await settle()
    document.querySelector<HTMLButtonElement>('[aria-label="Закрыть"]')!.click()
    await expect(answer).resolves.toBe(false)

    answer = ai.ensureConsent()
    await settle()
    document.querySelector<HTMLAnchorElement>('[data-ai-privacy]')!.click()
    await expect(answer).resolves.toBe(false)

    answer = ai.ensureConsent()
    await settle()
    expect(ai.sheetOpen).toBe(true)
    app!.unmount()
    app = null
    await expect(answer).resolves.toBe(false)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.sheetMounted).toBe(false)
    expect(ai.consent).toBe('unknown')
    expect('aiConsent' in useFinanceStore().privateDoc).toBe(false)
  })

  // AU-10 (бэклог «ИИ-польза», Р-12, Р-22): список вырос — «да» прежней версии спрашивается ещё раз ровно один раз.
  it('«да» v1 → лист ещё раз → «Включить» пишет v: 3 → второй раз листа нет', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const finance = useFinanceStore()
    finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: true, at: '2026-10-01T00:00:00Z' }))
    const ai = useAiStore()
    expect(ai.consent).toBe('unknown')

    const first = ai.ensureConsent()
    await settle()
    expect(ai.sheetOpen).toBe(true)
    expect(document.querySelectorAll('[data-ai-consent] li')).toHaveLength(5)
    document.querySelector<HTMLButtonElement>('[data-ai-yes]')!.click()
    await expect(first).resolves.toBe(true)
    expect(finance.privateDoc.aiConsent).toMatchObject({ on: true, v: 3 })

    await expect(ai.ensureConsent()).resolves.toBe(true)
    await settle()
    expect(ai.sheetOpen).toBe(false)
  })

  it('«Не надо» v1 остаётся «нет» без листа; «да» v3 — без листа', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const finance = useFinanceStore()
    const ai = useAiStore()
    finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: false, at: '2026-10-01T00:00:00Z' }))
    expect(ai.consent).toBe('off')
    await expect(ai.ensureConsent()).resolves.toBe(false)
    await settle()
    expect(ai.sheetOpen).toBe(false)

    finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: true, at: '2026-10-02T00:00:00Z', v: 3 }))
    expect(ai.consent).toBe('on')
    await expect(ai.ensureConsent()).resolves.toBe(true)
    await settle()
    expect(ai.sheetOpen).toBe(false)
  })

  // RZ-03 (бэклог «Разбор», Р-21): состав изменился — «да» v2 спрашивается ещё раз; «Не надо» v2 остаётся «нет».
  it('«да» v2 → «не спрошено» (лист ещё раз); «Не надо» v2 → «нет»; «да» v3 → «да»', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const finance = useFinanceStore()
    const ai = useAiStore()
    finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: true, at: '2026-10-02T00:00:00Z', v: 2 }))
    expect(ai.consent).toBe('unknown')
    finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: false, at: '2026-10-02T00:00:00Z', v: 2 }))
    expect(ai.consent).toBe('off')
    finance.mutatePrivateDoc((d) => void (d.aiConsent = { on: true, at: '2026-10-02T00:00:00Z', v: 3 }))
    expect(ai.consent).toBe('on')
  })

  it('настройки: выключить — «нет» с v: 3; подсказка называет новые пункты и «приходит сам»', async () => {
    signIn('member', true)
    const el = await mount(Settings, '/settings')
    useAiStore().setConsent(true)
    await settle()
    el.querySelector<HTMLButtonElement>('[data-ai-card] [role="switch"]')!.click()
    await settle()
    expect(useFinanceStore().privateDoc.aiConsent).toMatchObject({ on: false, v: 3 })
    el.querySelector<HTMLButtonElement>('[data-ai-card] button[aria-label="Что уходит"]')!.click()
    await settle()
    const hint = el.querySelector('[data-ai-card]')!.textContent!
    expect(hint).toContain('фото чека и фразу о мечте.')
    expect(hint).toContain('Разбор приходит сам — 1-го и после зарплаты.')
  })

  it('поверх листа экрана: согласие спрашивают и изнутри листа', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    void useAiStore().ensureConsent()
    await settle()
    const layer = document.querySelector('[data-ai-consent]')!.closest<HTMLElement>('[style*="z-index"]')!
    // Листы экранов — 50, вложенные («Оплатил», «Обменял») — 60.
    expect(Number(layer.style.zIndex)).toBeGreaterThan(60)
  })
})
