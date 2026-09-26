import { createRouter, createWebHistory, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { hasBudgetData } from '@/lib/finance'

import Access from '@/views/Access.vue'
import Setup from '@/views/Setup.vue'
import AppShell from '@/components/AppShell.vue'
import Overview from '@/views/Overview.vue'
import Budget from '@/views/Budget.vue'
import Capital from '@/views/Capital.vue'
import Goals from '@/views/Goals.vue'

// Редкие экраны — отдельными чанками (Н-9 ревью Блока 3): главный чанк без них меньше 500 kB.
// Предкэш PWA (`generateSW`) берёт все чанки — офлайн они открываются так же.
const GoalDetail = () => import('@/views/GoalDetail.vue')
const Deposit = () => import('@/views/Deposit.vue')
const Ritual = () => import('@/views/Ritual.vue')
const DebtPlan = () => import('@/views/DebtPlan.vue')
// Выписки (B2C-07): pdf.js грузится ещё позже — только когда выбрали файл.
const Statements = () => import('@/views/Statements.vue')

export const routes: RouteRecordRaw[] = [
  {
    path: '/access',
    name: 'access',
    component: Access,
    meta: { public: true },
  },
  {
    path: '/setup',
    name: 'setup',
    component: Setup,
    meta: { requiresAuth: true },
  },
  {
    path: '/',
    component: AppShell,
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'overview',
        component: Overview,
      },
      {
        path: 'budget',
        name: 'budget',
        component: Budget,
      },
      {
        path: 'goals',
        name: 'goals',
        component: Goals,
      },
      {
        path: 'goals/:id',
        name: 'goal-detail',
        component: GoalDetail,
      },
      {
        path: 'capital',
        name: 'capital',
        component: Capital,
      },
      {
        path: 'capital/:id',
        name: 'deposit',
        component: Deposit,
      },
      {
        path: 'ritual',
        name: 'ritual',
        component: Ritual,
      },
      {
        path: 'plan',
        name: 'plan',
        component: DebtPlan,
      },
      {
        path: 'statements',
        name: 'statements',
        component: Statements,
      },
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
      if (isAuthed) {
        const isReady = financeStore.setupDone || hasBudgetData(financeStore.householdDoc)
        return next(isReady ? '/' : '/setup')
      }
      return next()
    }

    // 2. Требуется авторизация
    if (!isAuthed) {
      return next({ path: '/access', query: to.query })
    }

    // 3. Если авторизован, проверяем прохождение настройки
    const setupCompleted = financeStore.setupDone || hasBudgetData(financeStore.householdDoc)

    if (to.path !== '/setup' && !setupCompleted) {
      return next('/setup')
    }
    if (to.path === '/setup' && setupCompleted) {
      return next('/')
    }

    next()
  })

  return router
}

export const router = createAppRouter()
export default router
