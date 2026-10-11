// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { templateById, templateImageUrl } from '@/lib/goalTemplates'
import type { Goal } from '@/types/finance'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * PN-14 (Р-13, макет done.html): мечта на 100 % спрашивает «Купили?» — «Сбылось» (бренд) и «Ещё нет»; «Сбылось» пишет
 * `doneAt` и открывает момент «за N месяцев»; сбывшаяся — «Сбылось в <месяц>», без «Пополнить» и «Подробнее», в меню
 * «Вернуть в мечты»; фонд на 100 % — прежняя строка «Собрано»; viewer — без кнопок.
 */
let app: App | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T08:00:00Z'))
})
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.useRealTimers()
})

// «Отпуск» накоплен целиком: 3 000 000 из 3 000 000, взносы с августа 2025 → «за 14 месяцев».
const full = (extra: Partial<Goal> = {}) => (g: Goal): Goal =>
  g.id === 'trip'
    ? {
        ...g, seed: 2_900_000, have: 3_000_000,
        movements: [{ id: 'm1', date: '2025-08-15T05:00:00.000Z', amount: 100_000, by: 'a' }],
        ...extra,
      }
    : g

async function open(opts: { role?: 'member' | 'viewer'; id?: string; goals?: (g: Goal) => Goal } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(opts.role ?? 'member', 'a'))
  const finance = useFinanceStore()
  const doc = planFamilyDoc()
  doc.goals = doc.goals.map(opts.goals ?? full())
  finance.setHouseholdDoc(doc, 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/goals/${opts.id ?? 'trip'}`)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GoalDetail)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
const text = () => document.body.textContent ?? ''
const q = (sel: string) => document.querySelector(sel)

describe('PN-14: «Купили?» на 100 %', () => {
  it('«Накоплено!», «Купили?», «Сбылось» и «Ещё нет»; «Пополнить» нет', async () => {
    await open()
    expect(q('[data-goal-ask]')?.textContent).toContain('Накоплено!')
    expect(text()).toContain('Купили?')
    expect(q('[data-goal-done]')).not.toBeNull()
    expect(q('[data-goal-not-yet]')).not.toBeNull()
    expect(button('Пополнить')).toBeUndefined()
  })

  it('«Ещё нет» прячет вопрос — карточка срока с «Пополнить»', async () => {
    await open()
    ;(q('[data-goal-not-yet]') as HTMLButtonElement).click()
    await nextTick()
    expect(q('[data-goal-ask]')).toBeNull()
    expect(button('Пополнить')).toBeDefined()
  })

  it('«Сбылось» → doneAt, момент «за 14 месяцев»; экран — «Сбылось в октябре 2026», без «Пополнить» и «Подробнее»', async () => {
    const finance = await open()
    ;(q('[data-goal-done]') as HTMLButtonElement).click()
    await nextTick()
    expect(finance.goals.find((g) => g.id === 'trip')!.doneAt).toBe('2026-10-10T08:00:00.000Z')
    expect(q('[data-done-sheet]')).not.toBeNull()
    expect(q('[data-done-term]')?.textContent?.trim()).toBe('за 14 месяцев')
    ;(q('[data-done-ok]') as HTMLButtonElement).click()
    await nextTick()
    expect(q('[data-done-sheet]')).toBeNull()
    expect(q('[data-goal-done-at]')?.textContent?.trim()).toBe('Сбылось в октябре 2026')
    expect(text()).toContain('за 14 месяцев')
    expect(button('Пополнить')).toBeUndefined()
    expect(text()).not.toContain('Подробнее')
    expect(q('[data-goal-ask]')).toBeNull()
  })

  it('момент — фото карточки сторис: без своего фото — шаблон с CDN в 1080 (критик Блока 4)', async () => {
    await open({ goals: full({ template: 'travel', photoId: null }) })
    ;(q('[data-goal-done]') as HTMLButtonElement).click()
    await nextTick()
    expect(q('[data-done-sheet] img')?.getAttribute('src')).toBe(templateImageUrl(templateById('travel')!, 1080))
  })

  it('«Поделиться» в моменте — карточка для сторис, момент закрыт', async () => {
    await open()
    ;(q('[data-goal-done]') as HTMLButtonElement).click()
    await nextTick()
    ;(q('[data-done-share]') as HTMLButtonElement).click()
    await nextTick()
    expect(q('[data-done-sheet]')).toBeNull()
    expect(text()).toContain('Карточка для сторис')
  })

  it('фонд на 100 % — «Собрано», без вопроса и без «Сбылось» в меню', async () => {
    await open({ id: 'cushion', goals: (g) => (g.id === 'cushion' ? { ...g, fund: 'cushion', seed: 50_000_000, have: 50_000_000 } : g) })
    expect(q('[data-goal-ask]')).toBeNull()
    expect(text()).toContain('Собрано')
    ;(document.querySelector('[aria-label="Меню цели"]') as HTMLButtonElement).click()
    await nextTick()
    expect(q('[data-goal-done-menu]')).toBeNull()
  })
})

describe('PN-14: меню «···»', () => {
  it('у мечты не на 100 % есть «Сбылось» → doneAt и момент', async () => {
    const finance = await open({ id: 'car', goals: (g) => g })
    ;(document.querySelector('[aria-label="Меню цели"]') as HTMLButtonElement).click()
    await nextTick()
    ;(q('[data-goal-done-menu]') as HTMLButtonElement).click()
    await nextTick()
    expect(finance.goals.find((g) => g.id === 'car')!.doneAt).toBeTruthy()
    expect(q('[data-done-sheet]')).not.toBeNull()
  })

  it('у сбывшейся — «Вернуть в мечты»: doneAt null, снова «Купили?»', async () => {
    const finance = await open({ goals: full({ doneAt: '2026-10-01T08:00:00.000Z' }) })
    ;(document.querySelector('[aria-label="Меню цели"]') as HTMLButtonElement).click()
    await nextTick()
    expect(q('[data-goal-done-menu]')).toBeNull()
    expect(button('Поставить на паузу')).toBeUndefined()
    ;(q('[data-goal-undo]') as HTMLButtonElement).click()
    await nextTick()
    expect(finance.goals.find((g) => g.id === 'trip')!.doneAt).toBeNull()
    expect(q('[data-goal-ask]')).not.toBeNull()
  })
})

describe('PN-14: viewer', () => {
  it('на 100 % — «Накоплено» без кнопок; у сбывшейся — нет меню', async () => {
    await open({ role: 'viewer' })
    expect(q('[data-goal-ask]')?.textContent?.trim()).toBe('Накоплено')
    expect(q('[data-goal-done]')).toBeNull()
    app?.unmount()
    document.body.innerHTML = ''
    await open({ role: 'viewer', goals: full({ doneAt: '2026-10-01T08:00:00.000Z' }) })
    expect(q('[data-goal-done-at]')?.textContent?.trim()).toBe('Сбылось в октябре 2026')
    expect(document.querySelector('[aria-label="Меню цели"]')).toBeNull()
  })
})
