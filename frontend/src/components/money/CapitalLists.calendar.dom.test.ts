// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import CapitalLists from './CapitalLists.vue'

/** PN-28: «В календарь» у «Платежей» — файл .ics через общий `shareFile`; viewer тоже; после — подсказка 4 с. */
const shareFile = vi.hoisted(() => vi.fn(async (_blob: Blob, _opts: { title: string; fileName: string }) => 'downloaded' as 'downloaded' | 'shared' | 'cancelled'))
vi.mock('@/lib/share', () => ({ shareFile }))

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  shareFile.mockClear()
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount(role: 'member' | 'viewer') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  useFinanceStore().setHouseholdDoc(planFamilyDoc(), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(CapitalLists) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
}

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve()
  await nextTick()
}

describe('PN-28: «В календарь»', () => {
  it.each(['member', 'viewer'] as const)('%s: кнопка зовёт shareFile с text/calendar и именем файла; подсказка гаснет через 4 с', async (role) => {
    await mount(role)
    const btn = document.querySelector<HTMLButtonElement>('[data-calendar]')!
    expect(btn.textContent).toContain('В календарь')
    btn.click()
    await flush()
    expect(shareFile).toHaveBeenCalledTimes(1)
    const [blob, opts] = shareFile.mock.calls[0]
    expect(blob.type).toBe('text/calendar')
    expect(opts).toEqual({ title: 'Платежи · Family Finance', fileName: 'family-finance.ics' })
    const text = await blob.text()
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('UID:ff-rent@family-finance')
    expect(text).toContain('SUMMARY:Зарплата · Ильяс')
    expect(document.querySelector('[data-calendar-note]')?.textContent).toBe('Открыть в календаре — «Добавить все»')
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(document.querySelector('[data-calendar-note]')).toBeNull()
  })

  it('отмена системного листа — без подсказки', async () => {
    shareFile.mockResolvedValueOnce('cancelled')
    await mount('member')
    document.querySelector<HTMLButtonElement>('[data-calendar]')!.click()
    await flush()
    expect(shareFile).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-calendar-note]')).toBeNull()
  })
})
