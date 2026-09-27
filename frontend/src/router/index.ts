import { createRouter, createWebHistory, createMemoryHistory, type RouteRecordRaw, type RouteLocationRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { hasBudgetData } from '@/lib/finance'
import { landingPath } from '@/router/landing'

import Access from '@/views/Access.vue'
import AppShell from '@/components/AppShell.vue'
import Dreams from '@/views/Dreams.vue'
import Budget from '@/views/Budget.vue'
import Capital from '@/views/Capital.vue'
import Money from '@/views/Money.vue'
import Settings from '@/views/Settings.vue'
import Wishes from '@/views/Wishes.vue'

// Редкие экраны — отдельными чанками (Н-9 ревью Блока 3): главный чанк без них меньше 500 kB.
// Предкэш PWA (`generateSW`) берёт все чанки — офлайн они открываются так же.
const GoalDetail = () => import('@/views/GoalDetail.vue')
const Deposit = () => import('@/views/Deposit.vue')
const Ritual = () => import('@/views/Ritual.vue')
const DebtPlan = () => import('@/views/DebtPlan.vue')
// Выписки (B2C-07): pdf.js грузится ещё позже — только когда выбрали файл.
const Statements = () => import('@/views/Statements.vue')
// Новая мечта (B2C-18): шаблоны с картинками — редкий экран, отдельным чанком.
const GoalNew = () => import('@/views/GoalNew.vue')
// Первый запуск (B2C-19): один раз на семью — отдельным чанком.
const Start = () => import('@/views/Start.vue')

/**
 * Карта маршрутов Блока 3 (DESIGN.md §2, B2C-13): вкладки «Мечты» `/` · «Неделя» `/week` ·
 * «Деньги» `/money`, второй уровень под `/money/*`, `/settings`. Старые адреса установленных
 * PWA и ссылок — редиректы с сохранением query (`/capital?credit=x` → `/money/capital?credit=x`).
 * `/ritual` без параметров — «Неделя»; с параметрами (раскладка зарплаты, остатка, освободившихся
 * денег) — `/week/salary`, где до B2C-21 живёт прежний экран.
 */
const ritualRedirect = (to: { query: Record<string, unknown> }): RouteLocationRaw =>
  Object.keys(to.query).length ? { path: '/week/salary', query: to.query as Record<string, string> } : '/week'

export const routes: RouteRecordRaw[] = [
  {
    path: '/access',
    name: 'access',
    component: Access,
    meta: { public: true },
  },
  {
    path: '/start/:step?',
    name: 'start',
    component: Start,
    meta: { requiresAuth: true },
  },
  // Мастер настройки (до Блока 3) — теперь первый запуск из выписки.
  { path: '/setup', redirect: '/start' },
  {
    path: '/',
    component: AppShell,
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'dreams', component: Dreams },
      { path: 'week', name: 'week', component: Statements },
      { path: 'week/salary', name: 'week-salary', component: Ritual },
      { path: 'money', name: 'money', component: Money },
      { path: 'money/budget', name: 'budget', component: Budget },
      { path: 'money/capital', name: 'capital', component: Capital },
      { path: 'money/capital/:id', name: 'deposit', component: Deposit },
      { path: 'money/plan', name: 'plan', component: DebtPlan },
      { path: 'goals/new', name: 'goal-new', component: GoalNew },
      // Желания по людям (B2C-18): общий список и список участника — один экран.
      { path: 'wishes', name: 'wishes', component: Wishes },
      { path: 'people/:slot', name: 'person', component: Wishes },
      { path: 'goals/:id', name: 'goal-detail', component: GoalDetail },
      { path: 'settings', name: 'settings', component: Settings },
      // Старые адреса (до Блока 3).
      { path: 'budget', redirect: '/money/budget' },
      { path: 'capital', redirect: '/money/capital' },
      { path: 'capital/:id', redirect: (to) => ({ path: `/money/capital/${String(to.params.id)}`, query: to.query }) },
      { path: 'goals', redirect: '/' },
      { path: 'ritual', redirect: ritualRedirect },
      { path: 'plan', redirect: '/money/plan' },
      { path: 'statements', redirect: '/week' },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

export function createAppRouter(history = typeof window !== 'undefined' ? createWebHistory() : createMemoryHistory()) {
  const router = createRouter({
    history,
    routes,
  })

  router.beforeEach((to, _from, next) => {
    const authStore = useAuthStore()
    const financeStore = useFinanceStore()

    const isAuthed = authStore.isAuthenticated

    // 1. Публичный маршрут /access
    if (to.path === '/access') {
      if (isAuthed) return next(landingPath(authStore, financeStore))
      return next()
    }

    // 2. Требуется авторизация
    if (!isAuthed) {
      return next({ path: '/access', query: to.query })
    }

    // 3. Первый запуск (`landingPath`): семья без данных — только `/start`; семья с данными, но не
    // настроенная (ответы посреди потока) — и `/start`, и главный; настроенной семье `/start` открыт
    // участнику без своей записи (партнёр по коду), остальным — главный. Viewer — мимо.
    const onStart = to.path === '/start' || to.path.startsWith('/start/')
    const landing = landingPath(authStore, financeStore)
    const setupCompleted = financeStore.setupDone || hasBudgetData(financeStore.householdDoc)

    if (!onStart && landing === '/start' && !setupCompleted) return next('/start')
    if (onStart && landing !== '/start') return next('/')

    next()
  })

  return router
}

export const router = createAppRouter()
export default router
