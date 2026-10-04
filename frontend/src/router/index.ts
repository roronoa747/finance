import { createRouter, createWebHistory, createMemoryHistory, type RouteRecordRaw, type RouteLocationRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { hasBudgetData } from '@/lib/finance'
import { landingPath } from '@/router/landing'

import Access from '@/views/Access.vue'
import AppShell from '@/components/AppShell.vue'
import Dreams from '@/views/Dreams.vue'
import Settings from '@/views/Settings.vue'
import Wishes from '@/views/Wishes.vue'

// Редкие экраны — отдельными чанками (Н-9 ревью Блока 3): главный чанк без них меньше 500 kB.
// Предкэш PWA (`generateSW`) берёт все чанки — офлайн они открываются так же.
const GoalDetail = () => import('@/views/GoalDetail.vue')
// «Деньги» (пивот 3, Р-31): один экран — сводка и квадраты Капитал · План · История — одним чанком.
const Money = () => import('@/views/Money.vue')
// Выписки (B2C-07): pdf.js грузится ещё позже — только когда выбрали файл.
const Statements = () => import('@/views/Statements.vue')
// Новая мечта (B2C-18): шаблоны с картинками — редкий экран, отдельным чанком.
const GoalNew = () => import('@/views/GoalNew.vue')
// Первый запуск (B2C-19): один раз на семью — отдельным чанком.
const Start = () => import('@/views/Start.vue')
const MyCircle = () => import('@/views/MyCircle.vue')

/**
 * Карта маршрутов Блока 3 (DESIGN.md §2, B2C-13): вкладки «Мечты» `/` · «Неделя» `/week` ·
 * «Деньги» `/money`, `/settings`. «Деньги» — один экран (пивот 3, Р-31): квадраты Капитал `/money`,
 * План `/money/plan`, История `/money/history`. Старые адреса установленных PWA и ссылок —
 * редиректы с сохранением query (`/money/capital?credit=x` → `/money?credit=x`; счёт и вклад
 * `/money/capital/:id` → `/money?account=:id`).
 * Раскладка, ритуал, разбор кольцом и «Ваш порядок» с любыми параметрами — план месяца «Денег» без них (Блок 14,
 * Р-78): отдельного экрана раскладки больше нет.
 */
const toPlan = (): RouteLocationRaw => ({ path: '/money', query: {} })

/**
 * Бюджет и Капитал до пивота 3 — квадрат «Капитал» с теми же ключами окон; закладка калькулятора
 * «Копить или гасить» (`?advice=strategy`) — квадрат «План», где он теперь живёт (B2C-43).
 */
const capitalRedirect = (to: { query: Record<string, unknown> }): RouteLocationRaw => {
  const { advice, ...query } = to.query as Record<string, string>
  return advice === 'strategy' ? { path: '/money/plan', query } : { path: '/money', query }
}

/** Экран счёта или вклада — лист счёта в «Деньгах» (пивот 3). */
const accountRedirect = (to: { params: Record<string, unknown>; query: Record<string, unknown> }): RouteLocationRaw => ({
  path: '/money',
  query: { ...(to.query as Record<string, string>), account: String(to.params.id) },
})

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
      // Раскладка, разбор и «Ваш порядок» — старые закладки и ссылки PWA: план месяца (Р-78).
      { path: 'week/salary', redirect: toPlan },
      { path: 'week/order', redirect: toPlan },
      { path: 'week/breakdown', redirect: toPlan },
      // Квадрат — по адресу; переключение — `router.replace` (назад — на прошлую вкладку).
      { path: 'money/:square(plan|history)?', name: 'money', component: Money },
      // Бюджет и Капитал до пивота 3 — теперь квадрат «Капитал»; окна — те же ключи query.
      { path: 'money/budget', redirect: (to) => ({ path: '/money', query: to.query }) },
      { path: 'money/capital', redirect: capitalRedirect },
      { path: 'money/capital/:id', redirect: accountRedirect },
      { path: 'goals/new', name: 'goal-new', component: GoalNew, meta: { memberOnly: true } },
      // Желания по людям (B2C-18): общий список и список участника — один экран.
      { path: 'wishes', name: 'wishes', component: Wishes },
      { path: 'people/:slot', name: 'person', component: Wishes },
      { path: 'goals/:id', name: 'goal-detail', component: GoalDetail },
      // Карточка сторис (DESIGN.md §2, B2C-20) — лист на экране цели.
      { path: 'share/:goalId', redirect: (to) => ({ path: `/goals/${String(to.params.goalId)}`, query: { share: '1' } }) },
      { path: 'settings', name: 'settings', component: Settings },
      // «Свой кружок» (Р-61) — только свой участник; viewer не правит.
      { path: 'settings/me', name: 'my-circle', component: MyCircle, meta: { memberOnly: true } },
      // Старые адреса (до Блока 3).
      { path: 'budget', redirect: '/money' },
      { path: 'capital', redirect: capitalRedirect },
      { path: 'capital/:id', redirect: accountRedirect },
      { path: 'goals', redirect: '/' },
      { path: 'ritual', redirect: toPlan },
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

    // 3. Экраны-формы (новая мечта, свой кружок) — только участнику; `viewerTo` — куда вместо них.
    if (to.meta.memberOnly && authStore.isViewer) {
      return next(typeof to.meta.viewerTo === 'string' ? { path: to.meta.viewerTo, query: to.query } : '/')
    }

    // 4. Первый запуск (`landingPath`): семья без данных — только `/start`; семья с данными, но не
    // настроенная (ответы посреди потока) — и `/start`, и главный; настроенной семье `/start` открыт
    // участнику без своей записи (партнёр по коду) и участнику посреди своего запуска (доход уже
    // записан, `onboardedAt` ещё нет — перезагрузка на вопросах их не теряет), остальным — главный.
    // Viewer — мимо.
    const onStart = to.path === '/start' || to.path.startsWith('/start/')
    const landing = landingPath(authStore, financeStore)
    const setupCompleted = financeStore.setupDone || hasBudgetData(financeStore.householdDoc)
    const me = financeStore.people.find((p) => p.id === authStore.slot)
    const joining = financeStore.setupDone && !authStore.isViewer && !!me && !me.onboardedAt

    if (!onStart && landing === '/start' && !setupCompleted) return next('/start')
    if (onStart && landing !== '/start' && !joining) return next('/')

    next()
  })

  return router
}

export const router = createAppRouter()
export default router
