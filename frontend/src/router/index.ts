import { createRouter, createWebHistory, createMemoryHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { hasBudgetData } from '@/lib/finance'

import Access from '@/views/Access.vue'
import Setup from '@/views/Setup.vue'
import AppShell from '@/components/AppShell.vue'
import Overview from '@/views/Overview.vue'
import PlaceholderView from '@/views/PlaceholderView.vue'

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
        component: PlaceholderView,
      },
      {
        path: 'goals',
        name: 'goals',
        component: PlaceholderView,
      },
      {
        path: 'capital',
        name: 'capital',
        component: PlaceholderView,
      },
      {
        path: 'ritual',
        name: 'ritual',
        component: PlaceholderView,
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
