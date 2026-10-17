// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import AppShell from '@/components/AppShell.vue'
import PlanSwitch from '@/components/plan/PlanSwitch.vue'
import Tabs from '@/components/kit/Tabs.vue'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiReview } from '@/types/finance'
import { PhHeart } from '@phosphor-icons/vue'

/**
 * AU-13 (бэклог «ИИ-польза», Р-4): новый разбор месяца не открыт на этом телефоне — точка на вкладке «План» и на сегменте
 * «Месяц»; открыли разбор — точки ушли. Viewer — точка тоже (видит сохранённый). Исключение к Р-116 (владелец 2026-10-16).
 */
let app: App | null = null
const KEY = '2026-09'

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
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const review: AiReview = {
  id: 'r1', month: KEY, at: '2026-09-01T03:00:00.000Z', by: 'b', good: 'Хорошо.', risk: 'Риск.', steps: [], sent: null,
  v: 2, reason: 'month', reasonKey: `month:${KEY}`, step: { text: 'Шаг', candidate: null }, updatedAt: T0,
}

const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mount(role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData(authAs(role))
  auth.ai = true
  useFinanceStore().setHouseholdDoc(planFamilyDoc({ aiReviews: [review] }), 1)
  const week = defineComponent({ setup: () => () => h('div', [h(PlanSwitch, { view: 'week', dot: useAiStore().reviewUnseen }), 'week']) })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: AppShell, children: [{ path: '', component: { render: () => h('div', 'Мечты') } }, { path: 'week', component: week }, { path: 'month', component: week }] }],
  })
  await router.push('/week')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
}

describe('AU-13: точка «новый разбор» на «Плане» и «Месяце»', () => {
  it('не открыт — точка у вкладки «План» и у сегмента «Месяц»; открыли — ушли', async () => {
    await mount()
    const plan = [...document.querySelectorAll('nav a')].find((a) => a.textContent?.includes('План'))!
    expect(plan.querySelector('[data-tab-dot]')).not.toBeNull()
    expect(plan.textContent).toContain('новый разбор')
    expect(document.querySelectorAll('[data-tab-dot]')).toHaveLength(1)
    const month = document.querySelector('[data-plan-view="month"]')!
    expect(month.querySelector('[data-plan-dot]')).not.toBeNull()
    expect(document.querySelector('[data-plan-view="week"] [data-plan-dot]')).toBeNull()

    useAiStore().markReviewSeen('r1')
    await flush()
    expect(document.querySelector('[data-tab-dot]')).toBeNull()
    expect(document.querySelector('[data-plan-dot]')).toBeNull()
  })

  it('разбор сам из оболочки: своя первая «Пришла» — зовёт, отметка партнёра — нет', async () => {
    await mount()
    const auto = vi.spyOn(useAiStore(), 'autoReview').mockResolvedValue(null)
    useFinanceStore().markSalary('b')
    await flush()
    expect(auto).not.toHaveBeenCalled()
    useFinanceStore().markSalary('a')
    await flush()
    expect(auto).toHaveBeenCalledTimes(1)
  })

  it('флаг ИИ пришёл позже: по документу прошлого запуска — нет, после сверки с сервером — да (84c2ab2)', async () => {
    await mount()
    const auth = useAuthStore()
    const finance = useFinanceStore()
    const auto = vi.spyOn(useAiStore(), 'autoReview').mockResolvedValue(null)
    auth.ai = false
    await flush()
    finance.status = 'idle'
    finance.pulledOnce = false
    auth.ai = true
    await flush()
    expect(auto).not.toHaveBeenCalled()
    auth.ai = false
    await flush()
    finance.pulledOnce = true
    auth.ai = true
    await flush()
    expect(auto).toHaveBeenCalledTimes(1)
  })

  it('viewer — точка на вкладке тоже', async () => {
    await mount('viewer')
    expect(document.querySelector('[data-tab-dot]')).not.toBeNull()
  })

  it('Tabs без `dot` — без точки', async () => {
    setActivePinia(createPinia())
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
    await router.push('/')
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(Tabs, { items: [{ to: '/', label: 'Мечты', icon: PhHeart, active: true }] }) })
    app.use(router)
    app.mount(root)
    await flush()
    expect(document.querySelector('[data-tab-dot]')).toBeNull()
  })
})
