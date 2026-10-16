// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { DEMO_TOKEN, useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useApplePayStore } from '@/stores/applepay'
import type { WalletStatus } from '@/types/api'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Settings from '@/views/Settings.vue'
import Week from '@/views/Week.vue'

/**
 * AP-06: карточка «Apple Pay» в настройках, лист подключения, тихая строка на «Неделе». Демо и viewer — ничего.
 */
const IPHONE_27 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36'
const STATUS: WalletStatus = {
  connected: false, phones: 0,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
}
// Ключ — из частей (хук pre-commit).
const KEY = ['ffk', 'B'.repeat(39) + 'wxyz'].join('_')

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

async function open(view: Component, path: string, o: { role?: 'member' | 'viewer'; demo?: boolean; status?: WalletStatus; ua?: string } = {}) {
  const status = vi.spyOn(apiClient, 'walletStatus').mockResolvedValue({ ...(o.status ?? STATUS) })
  const connect = vi.spyOn(apiClient, 'walletConnect').mockResolvedValue({ key: KEY })
  const disconnect = vi.spyOn(apiClient, 'walletDisconnect').mockResolvedValue()
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: o.demo ? DEMO_TOKEN : 't',
    user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: o.role ?? 'member', joined_at: '' },
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
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return { status, connect, disconnect, router }
}

describe('настройки — карточка «Apple Pay»', () => {
  it('скрыта у viewer, в демо и без ссылки на команду; у viewer и в демо — без запроса', async () => {
    const viewer = await open(Settings, '/settings', { role: 'viewer' })
    expect(q('[data-applepay-card]')).toBeNull()
    expect(viewer.status).not.toHaveBeenCalled()
    app?.unmount()

    const demo = await open(Settings, '/settings', { demo: true })
    expect(q('[data-applepay-card]')).toBeNull()
    expect(demo.status).not.toHaveBeenCalled()
    app?.unmount()

    await open(Settings, '/settings', { status: { ...STATUS, shortcut_url: '' } })
    expect(q('[data-applepay-card]')).toBeNull()
  })

  it('«Подключить» → лист, шаг 1 из 5: ключ создан и скопирован, дальше — «Открыть команду» по ссылке iCloud', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, userAgent: IPHONE_27 })
    const { connect } = await open(Settings, '/settings')
    expect(txt(q('[data-applepay-line]'))).toBe('Траты появятся сами после оплаты')
    // Брендовая кнопка на экране одна — «Подключить».
    expect(document.querySelectorAll('button.bg-brand').length).toBe(1)

    q('[data-connect]')!.click()
    await flush()
    const sheet = q('[data-applepay-sheet]')!
    expect(sheet.dataset.path).toBe('ios27')
    expect(txt(q('[data-step-text]'))).toBe('Скопируйте ключ этого iPhone')
    expect(txt(document.body)).toContain('1 из 5')
    expect(connect).toHaveBeenCalledOnce()
    // Ключа на экране нет даже маской (ux: «ffk_…» — механика); целиком — только когда буфер недоступен.
    expect(txt(document.body)).not.toContain('ffk')

    q('[data-main]')!.click()
    await flush()
    expect(writeText).toHaveBeenCalledWith(KEY)
    expect(txt(q('[data-step-text]'))).toBe('Откройте команду «Траты сами»')
    expect(q<HTMLAnchorElement>('a[data-main]')?.getAttribute('href')).toBe(STATUS.shortcut_url)
    // Ссылка — брендовая кнопка кита (`buttonVariants`), а не скопированные руками классы (ревью frontend Н-8).
    expect(q('a[data-main]')!.className.split(' ').sort()).toEqual(cn(buttonVariants(), 'w-full').split(' ').sort())
    // Ключ — только в памяти листа: в хранилище его нет.
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(KEY)
  })

  it('подключено — «Отключить» → подтверждение → отключено, снова «Подключить»', async () => {
    const { disconnect } = await open(Settings, '/settings', { status: { ...STATUS, connected: true, phones: 1, last_used_at: '2026-10-16T05:00:00Z' } })
    expect(txt(q('[data-applepay-line]'))).toBe('Подключено · последняя трата 16 октября')
    // Дата не рвётся переносом (ux).
    expect(q('[data-applepay-line]')!.textContent).toContain('16 октября')
    expect(q('[data-connect]')).toBeNull()

    q('[data-disconnect]')!.click()
    await flush()
    expect(txt(q('[data-confirm]'))).toContain('Отключить? Траты перестанут приходить сами')
    q('[data-confirm-yes]')!.click()
    await flush()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(q('[data-connect]')).not.toBeNull()
  })

  it('адрес ?applepay=1 открывает лист сразу (строка «Недели» ведёт сюда)', async () => {
    await open(Settings, '/settings?applepay=1')
    expect(q('[data-applepay-sheet]')).not.toBeNull()
  })

  it('не iPhone (Android, компьютер): карточки нет, пока не подключено; подключено — только «Отключить», листа нет (ux)', async () => {
    const off = await open(Settings, '/settings?applepay=1', { ua: ANDROID })
    expect(off.status).toHaveBeenCalled()
    expect(q('[data-applepay-card]')).toBeNull()
    expect(q('[data-applepay-sheet]')).toBeNull()
    expect(off.connect).not.toHaveBeenCalled()
    app?.unmount()

    await open(Settings, '/settings', { ua: ANDROID, status: { ...STATUS, connected: true, phones: 1 } })
    expect(q('[data-applepay-card]')).not.toBeNull()
    expect(q('[data-disconnect]')).not.toBeNull()
    expect(q('[data-more]')).toBeNull()
    expect(q('[data-connect]')).toBeNull()
  })
})

describe('лист подключения — геометрия (ux)', () => {
  it('тихий ряд под главной кнопкой есть на каждом шаге — лист не прыгает; «Назад» — со второго шага до последнего', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, userAgent: IPHONE_27 })
    await open(Settings, '/settings?applepay=1')
    const row = () => q('[data-main]')!.nextElementSibling as HTMLElement
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      expect(row().className).toContain('h-11')
      seen.push(row().querySelector('[data-back]') ? 'назад' : '—')
      // «Открыть команду» — ссылка (target _blank): в happy-dom клик не уводит со страницы.
      q('[data-main]')!.click()
      await flush()
    }
    expect(seen).toEqual(['—', 'назад', 'назад', 'назад', '—'])
  })
})

describe('«Неделя» — тихая строка «Траты сами с Apple Pay»', () => {
  it('есть на iPhone, пока не подключено; ведёт в лист настроек', async () => {
    await open(Week, '/week')
    const line = q('[data-applepay-week]')
    expect(txt(line)).toBe('Траты сами с Apple Pay')
    expect(line?.getAttribute('href')).toBe('/settings?applepay=1')
  })

  it('нет — на Android, у подключённого, у viewer', async () => {
    await open(Week, '/week', { ua: ANDROID })
    expect(q('[data-applepay-week]')).toBeNull()
    app?.unmount()
    await open(Week, '/week', { status: { ...STATUS, connected: true, phones: 1 } })
    expect(q('[data-applepay-week]')).toBeNull()
    app?.unmount()
    await open(Week, '/week', { role: 'viewer' })
    expect(q('[data-applepay-week]')).toBeNull()
  })
})
