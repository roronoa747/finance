// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useApplePayStore } from '@/stores/applepay'
import type { WalletStatus } from '@/types/api'
import Settings from '@/views/Settings.vue'

/**
 * AP-11: вторая команда «Пуши банков» в листе подключения — тихая «Ещё — пуши банков» после шагов касания (тот же
 * ключ) и «Пуши банков» в карточке подключённого iPhone. Только iOS 27 и только со ссылкой `push_shortcut_url`.
 */
const IPHONE_27 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const IPHONE_26 = IPHONE_27.replace('Version/27.0', 'Version/26.1')
const PUSH_URL = 'https://www.icloud.com/shortcuts/stub-push'
const STATUS: WalletStatus = {
  connected: false, phones: 0,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
  push_shortcut_url: PUSH_URL,
}
// Ключ — из частей (хук pre-commit).
const KEY = ['ffk', 'C'.repeat(39) + 'push'].join('_')

let app: App | null = null
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(path: string, o: { status?: WalletStatus; ua?: string } = {}) {
  vi.spyOn(apiClient, 'walletStatus').mockResolvedValue({ ...(o.status ?? STATUS) })
  const connect = vi.spyOn(apiClient, 'walletConnect').mockResolvedValue({ key: KEY })
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, userAgent: o.ua ?? IPHONE_27 })
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [{ id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' }]
  useApplePayStore().userAgent = o.ua ?? IPHONE_27
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Settings)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return { connect, writeText }
}

const main = async () => {
  q('[data-main]')!.click()
  await flush()
}

describe('лист подключения — вторая команда «Пуши банков»', () => {
  it('после шагов касания — тихая «Ещё — пуши банков»: шесть шагов с тем же ключом и ссылкой второй команды', async () => {
    const { connect, writeText } = await open('/settings?applepay=1')
    for (let i = 0; i < 4; i++) await main() // ключ → команда → «Добавить» → тумблер → «Готово»
    expect(txt(q('[data-step-text]'))).toBe('Готово — оплатите что-нибудь телефоном')
    // Брендовая — одна («Готово»); пуши — тихой кнопкой под ней (правило 12).
    const more = q('[data-more-push]')!
    expect(txt(more)).toBe('Ещё — пуши банков')
    expect(more.className).not.toContain('bg-brand')

    more.click()
    await flush()
    expect(q('[data-applepay-sheet]')!.dataset.flow).toBe('push')
    expect(txt(document.body)).toContain('1 из 6')
    await main()
    // Тот же ключ: второй раз сервер не спрашивали, в буфер — тот же.
    expect(connect).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenLastCalledWith(KEY)
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(txt(q('[data-step-text]'))).toBe('Откройте команду «Пуши банков»')
    expect(q<HTMLAnchorElement>('a[data-main]')!.getAttribute('href')).toBe(PUSH_URL)
    const texts: string[] = []
    for (let i = 0; i < 4; i++) {
      await main()
      texts.push(txt(q('[data-step-text]')))
    }
    expect(texts).toEqual([
      'Нажмите «Добавить» и вставьте ключ',
      'Выберите Kaspi, Freedom и Halyk',
      'Включите автоматизацию тумблером',
      'Готово — покупки и переводы из пушей придут сами',
    ])
    // На финале пушей второй раз «Ещё — пуши» не предлагается.
    expect(q('[data-more-push]')).toBeNull()
  })

  it('без ссылки второй команды и на iOS 26 — ни «Ещё — пуши банков», ни кнопки в карточке', async () => {
    await open('/settings?applepay=1', { status: { ...STATUS, push_shortcut_url: '' } })
    for (let i = 0; i < 4; i++) await main()
    expect(txt(q('[data-step-text]'))).toBe('Готово — оплатите что-нибудь телефоном')
    expect(q('[data-more-push]')).toBeNull()
    app?.unmount()

    await open('/settings', { ua: IPHONE_26, status: { ...STATUS, connected: true, phones: 1 } })
    expect(q('[data-applepay-card]')).not.toBeNull()
    expect(q('[data-push]')).toBeNull()
  })

  it('карточка подключённого iPhone — тихая «Пуши банков» открывает лист сразу на шагах пушей', async () => {
    const { connect } = await open('/settings', { status: { ...STATUS, connected: true, phones: 1 } })
    const push = q('[data-push]')!
    expect(txt(push)).toBe('Пуши банков')
    push.click()
    await flush()
    expect(q('[data-applepay-sheet]')!.dataset.flow).toBe('push')
    expect(txt(document.body)).toContain('1 из 6')
    expect(connect).toHaveBeenCalledOnce()
  })
})
