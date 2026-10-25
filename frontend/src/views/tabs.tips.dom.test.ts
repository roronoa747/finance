// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { readTipsSeen } from '@/lib/storage'
import { authAs, planFamilyDoc, withOwnWeek } from '@/test/planFamily'
import type { SyncDoc } from '@/types/finance'
import Dreams from './Dreams.vue'
import Week from './Week.vue'
import Month from './Month.vue'
import Money from './Money.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Бэклог «первый» FR-06 (Р-7): на каждой главной вкладке при первом заходе — один пузырь у главного предмета; после
 * «Понятно» не возвращается; viewer — свой текст без призыва; пустой экран — без пузыря.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const TABS: { id: string; path: string; view: Component; subject: string }[] = [
  { id: 'tab-dreams', path: '/', view: Dreams, subject: 'Главная мечта' },
  { id: 'tab-week', path: '/week', view: Week, subject: '[data-week-list]' },
  { id: 'tab-month', path: '/month', view: Month, subject: '[data-sections]' },
  { id: 'tab-money', path: '/money', view: Money, subject: '[role="group"][aria-label="Деньги"]' },
]

async function open(view: Component, path: string, role: 'member' | 'viewer' = 'member', doc: SyncDoc = planFamilyDoc()) {
  app?.unmount()
  document.body.innerHTML = ''
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, role === 'viewer' ? 'b' : 'a'))
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  await nextTick()
}

const bubbles = () => [...document.querySelectorAll<HTMLElement>('[data-tip]')]
const ok = () => document.querySelector<HTMLButtonElement>('[data-tip-ok]')!

describe('FR-06: подсказки на главных вкладках', () => {
  for (const t of TABS.filter((x) => x.subject.startsWith('['))) {
    it(`${t.path}: один пузырь «${t.id}» у главного предмета; «Понятно» — нет, и после перезахода тоже`, async () => {
      // «Неделя» — со своими тратами: пустая неделя пузыря не показывает (FR-06 п. 2).
      const doc = t.id === 'tab-week' ? withOwnWeek(planFamilyDoc()) : planFamilyDoc()
      await open(t.view, t.path, 'member', doc)
      expect(bubbles().map((b) => b.dataset.tip)).toEqual([t.id])
      // Пузырь — рядом с предметом в той же обёртке: ничего не закрывает, едет с ним. «Месяц» — над разделами (под ними
      // на 390 px пузырь уходил под панель вкладок — стенд FR-06), «Неделя» — над разделами, под суммой (предмет — разделы:
      // нажатие раздела закрывает пузырь — возврат приёмки), остальные — под предметом.
      expect(bubbles()[0].previousElementSibling?.matches(t.subject), 'пузырь рядом с предметом').toBe(true)
      expect(bubbles()[0].classList.contains('order-first'), 'над предметом').toBe(t.id === 'tab-month' || t.id === 'tab-week')
      expect(bubbles()[0].textContent).not.toMatch(/выписк|PDF/i)
      if (t.id === 'tab-money') expect(bubbles()[0].textContent).toContain('Нажмите «Долги» или «История», чтобы открыть их')
      ok().click()
      await nextTick()
      expect(bubbles()).toEqual([])
      expect(readTipsSeen()).toEqual([t.id])
      await open(t.view, t.path, 'member', doc)
      expect(bubbles()).toEqual([])
    })
  }

  it('«Мечты»: пузырь у главной мечты; нажатие мечты закрывает его с отметкой', async () => {
    await open(Dreams, '/')
    expect(bubbles().map((b) => b.dataset.tip)).toEqual(['tab-dreams'])
    expect(bubbles()[0].textContent).toContain('Нажмите на мечту')
    expect(bubbles()[0].parentElement!.textContent).toContain(planFamilyDoc().goals[0].name)
    const dream = bubbles()[0].parentElement!.querySelector('section button') as HTMLButtonElement
    // Поддельные часы стоят — Vue отбросил бы клик у обёртки (метка события не позже её навешивания): сдвигаем.
    vi.setSystemTime(new Date('2026-09-12T07:00:01Z'))
    dream.click()
    await nextTick()
    expect(bubbles()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-dreams'])
  })

  it('«Неделя»: нажатие раздела открывает его лист и закрывает пузырь с отметкой; лист закрыт — пузырь не вернулся', async () => {
    await open(Week, '/week', 'member', withOwnWeek(planFamilyDoc()))
    expect(bubbles().map((b) => b.dataset.tip)).toEqual(['tab-week'])
    // Между шапкой и разделами — под полосой плана недели (FB-19) или тихой строкой «На карте» (F2-08).
    expect(bubbles()[0].parentElement!.previousElementSibling?.matches('[data-week-plan], [data-week-head], [data-week-balance]')).toBe(true)
    vi.setSystemTime(new Date('2026-09-12T07:00:01Z'))
    document.querySelector<HTMLButtonElement>('[data-week-list] .row-open')!.click()
    await nextTick()
    await nextTick()
    expect(document.querySelector('[role="dialog"]'), 'лист раздела открыт').not.toBeNull()
    expect(bubbles()).toEqual([])
    expect(readTipsSeen()).toEqual(['tab-week'])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    await nextTick()
    expect(document.querySelector('[role="dialog"]'), 'лист закрыт').toBeNull()
    expect(bubbles()).toEqual([])
  })

  it('«Понятно» одной вкладки не трогает другие: на «Месяце» после «Мечт» — свой пузырь, на «Мечтах» — нет', async () => {
    await open(Dreams, '/')
    ok().click()
    await open(Month, '/month')
    expect(bubbles().map((b) => b.dataset.tip)).toEqual(['tab-month'])
    await open(Dreams, '/')
    expect(bubbles()).toEqual([])
  })

  it('пустые «Мечты» («Новая мечта» — первый шаг) — без пузыря; мечта появилась — пузырь', async () => {
    await open(Dreams, '/', 'member', { ...planFamilyDoc(), goals: [] })
    expect(document.body.textContent).toContain('На что копим?')
    expect(bubbles()).toEqual([])
    useFinanceStore().addGoal({ name: 'Машина', need: 3_000_000, monthly: 0, hue: 'blue' })
    await nextTick()
    await nextTick()
    expect(bubbles().map((b) => b.dataset.tip)).toEqual(['tab-dreams'])
  })

  it('viewer: «Мечты», «Месяц», «Деньги» — свой текст без призыва нажать; «Понятно» есть', async () => {
    const texts: string[] = []
    for (const [view, path] of [[Dreams, '/'], [Month, '/month'], [Money, '/money']] as const) {
      await open(view, path, 'viewer')
      expect(bubbles(), path).toHaveLength(1)
      texts.push(bubbles()[0].querySelector('p')!.textContent!)
      expect(ok()).toBeTruthy()
    }
    for (const text of texts) expect(text).not.toMatch(/нажмите|раскройте|«Загрузить»/i)
    // Тот же id, что у участника: увиденное viewer'ом на этом телефоне — увидено.
    ok().click()
    expect(readTipsSeen()).toEqual(['tab-money'])
  })

  it('пустая «Неделя» (своих трат нет — ведёт брендовое «Загрузить») — без пузыря и без отметки; траты появились — пузырь', async () => {
    await open(Week, '/week', 'member', planFamilyDoc())
    expect(document.querySelector('[data-upload="lead"]')).not.toBeNull()
    expect(bubbles()).toEqual([])
    // Нажатие пустой суммы недели не съедает подсказку про разделы.
    document.querySelector<HTMLElement>('[data-week-head]')!.click()
    expect(readTipsSeen()).toEqual([])
    useFinanceStore().householdDoc.spendTotals = withOwnWeek(planFamilyDoc()).spendTotals
    await nextTick()
    await nextTick()
    expect(bubbles().map((b) => b.dataset.tip)).toEqual(['tab-week'])
    expect(bubbles()[0].textContent).toContain('Нажмите на раздел')
  })
})
