// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { Goal, SyncDoc } from '@/types/finance'
import GoalDetail from './GoalDetail.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/** Подушка (понятность Р-12): экран фонда «Подушка» — PN-19 (тост «уже есть»), PN-20 (нужно · есть · хватит на N). */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const pot = (p: Partial<Goal> = {}): Goal => ({
  id: 'pot', name: 'Подушка', need: 0, seed: 0, have: 0, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], template: 'cushion', fund: 'cushion', updatedAt: T0, ...p,
})

async function open(path: string, goals: Goal[] = [pot()], extra: Partial<SyncDoc> = {}, role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc({ goals, goalOrder: null, ...extra }), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GoalDetail)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  for (let i = 0; i < 3; i++) await nextTick()
  return finance
}

const page = () => (document.body.textContent ?? '').replace(/\s+/g, ' ')

describe('PN-19: «Новая мечта → Подушка», а подушка уже есть', () => {
  it('`?fund=exists` — тост «Подушка уже есть»; без адреса — тоста нет', async () => {
    await open('/goals/pot?fund=exists')
    expect(document.querySelector('[data-closer]')?.textContent).toBe('Подушка уже есть')
    app?.unmount()
    document.body.innerHTML = ''
    await open('/goals/pot')
    expect(document.querySelector('[data-closer]')).toBeNull()
    expect(page()).not.toContain('Подушка уже есть')
  })
})
