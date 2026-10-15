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
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
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
    expect(card.textContent).toContain('Без имён · Anthropic')
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
  it('три пункта, Anthropic, «Подробнее» → /privacy; «Включить» — согласие, лист закрыт', async () => {
    signIn('member', true)
    await mount(AiConsentSheet, '/settings')
    const ai = useAiStore()
    const answer = ai.ensureConsent()
    await settle()

    const items = [...document.querySelectorAll('[data-ai-consent] li')].map((li) => li.textContent!.trim())
    expect(items).toEqual(['Цифры месяца — без имён', 'Названия продавцов', 'Скриншот товара'])
    expect(document.body.textContent).toContain('Уходит в Anthropic (Claude). Не обучается на ваших данных.')
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
