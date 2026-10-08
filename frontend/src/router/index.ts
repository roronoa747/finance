import { createRouter, createWebHistory, createMemoryHistory, type RouteRecordRaw, type RouteLocationRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { hasBudgetData } from '@/lib/finance'
import { landingPath } from '@/router/landing'
import { readDemoPending } from '@/lib/storage'

import Access from '@/views/Access.vue'
import Root from '@/views/Root.vue'
import Dreams from '@/views/Dreams.vue'
import Settings from '@/views/Settings.vue'
import Wishes from '@/views/Wishes.vue'

// Редкие экраны — отдельными чанками (Н-9 ревью Блока 3): главный чанк без них меньше 500 kB.
// Предкэш PWA (`generateSW`) берёт все чанки — офлайн они открываются так же.
const GoalDetail = () => import('@/views/GoalDetail.vue')
// «Деньги» (пивот 3, Р-31): один экран — квадраты Капитал · Долги · История — одним чанком.
const Money = () => import('@/views/Money.vue')
// «План · Месяц» (Блок 15, Р-89): план месяца семьи — своим чанком.
const Month = () => import('@/views/Month.vue')
// Выписки (B2C-07): pdf.js грузится ещё позже — только когда выбрали файл.
const Week = () => import('@/views/Week.vue')
// Новая мечта (B2C-18): шаблоны с картинками — редкий экран, отдельным чанком.
const GoalNew = () => import('@/views/GoalNew.vue')
// Первый запуск (B2C-19): один раз на семью — отдельным чанком.
const Start = () => import('@/views/Start.vue')
const MyCircle = () => import('@/views/MyCircle.vue')
// «С кем» (B2C-25): один раз после первого входа — отдельным чанком.
const Who = () => import('@/views/Who.vue')
// Политика конфиденциальности (B2C-26): публичная, лёгким чанком.
const Privacy = () => import('@/views/Privacy.vue')
const DebtFaster = () => import('@/views/DebtFaster.vue')

/**
 * Карта маршрутов (DESIGN.md §2, B2C-13; Блок 15, Р-89, Р-103): вкладки «Мечты» `/` · «План» — `/week`
 * («Неделя») и `/month` («Месяц») · «Деньги» `/money`, `/settings`. «Деньги» — один экран (пивот 3, Р-31):
 * квадраты Капитал `/money`, Долги `/money/debts`, История `/money/history`. Старые адреса установленных PWA и
 * ссылок — редиректы с сохранением query (`/money/capital?credit=x` → `/money?credit=x`; счёт и вклад
 * `/money/capital/:id` → `/money?account=:id`; `/money/plan` и `/plan` → `/money/debts`;
 * `/money?month=…` → `/month?month=…`).
 * Раскладка, ритуал, разбор кольцом и «Ваш порядок» — «План · Месяц» (Р-78, Р-103): из параметров остаётся
 * только месяц (`month`), отдельного экрана раскладки нет.
 */
const monthQuery = (q: Record<string, unknown>) => (typeof q.month === 'string' ? { month: q.month } : {})
const toPlan = (to: { query: Record<string, unknown> }): RouteLocationRaw => ({ path: '/month', query: monthQuery(to.query) })

/**
 * Бюджет и Капитал до пивота 3 — квадрат «Капитал» с теми же ключами окон; закладка калькулятора
 * «Копить или гасить» (`?advice=strategy`) — квадрат «Долги», где он теперь живёт (B2C-43, Р-91).
 */
const capitalRedirect = (to: { query: Record<string, unknown> }): RouteLocationRaw => {
  const { advice, ...query } = to.query as Record<string, string>
  return advice === 'strategy' ? { path: '/money/debts', query } : { path: '/money', query }
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
  { path: '/privacy', name: 'privacy', component: Privacy, meta: { public: true } },
  // «С кем ведём?» (B2C-25, Р-13): только вошедшему без семьи.
  {
    path: '/who',
    name: 'who',
    component: Who,
    meta: { requiresAuth: true },
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
    // Вошедшему — оболочка приложения, анониму на «/» — лэндинг (B2C-27, `Root.vue`).
    path: '/',
    component: Root,
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'dreams', component: Dreams },
      // «План» (Р-89): «Неделя» — только свои траты, viewer уходит в «Месяц» (Р-104).
      { path: 'week', name: 'week', component: Week, meta: { memberOnly: true, viewerTo: '/month' } },
      { path: 'month', name: 'month', component: Month },
      // Раскладка, разбор и «Ваш порядок» — старые закладки и ссылки PWA: план месяца (Р-78, Р-103).
      { path: 'week/salary', redirect: toPlan },
      { path: 'week/order', redirect: toPlan },
      { path: 'week/breakdown', redirect: toPlan },
      // Квадрат — по адресу; переключение — `router.replace` (назад — на прошлую вкладку).
      // Закладка месяца плана (`/money?month=`, Блок 14) — «План · Месяц» (Р-103).
      {
        path: 'money/:square(debts|history)?',
        name: 'money',
        component: Money,
        beforeEnter: (to) => (typeof to.query.month === 'string' ? { path: '/month', query: monthQuery(to.query) } : true),
      },
      // «Как закрыть быстрее» — свой экран со стрелкой «назад» (Б17, макет): открывается сверху, «назад» — на «Долги».
      { path: 'money/debts/faster', name: 'debt-faster', component: DebtFaster },
      // Квадрат «План» переименован в «Долги» (Р-91).
      { path: 'money/plan', redirect: (to) => ({ path: '/money/debts', query: to.query }) },
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
      { path: 'plan', redirect: '/money/debts' },
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

    // 1а. Остальные публичные (политика) — всем, со входом и без.
    if (to.meta.public) return next()

    // 2. Требуется авторизация; аноним на «/» — лэндинг (B2C-27).
    if (!isAuthed) {
      if (to.path === '/') return next()
      return next({ path: '/access', query: to.query })
    }

    // 2а. Без семьи (вошёл через Google, «с кем» не пройдено): только «с кем» и настройки — там
    // выход и удаление аккаунта. С семьёй «с кем» больше не нужен.
    if (!authStore.isDemo && !authStore.hasHousehold) {
      if (to.path === '/who' || to.path === '/settings') return next()
      return next('/who')
    }
    // Вопрос «взять демо?» не отвечен (B2C-27): он живёт на «с кем», закрытие приложения его не снимает.
    if (!authStore.isDemo && readDemoPending() && financeStore.isDemo) {
      if (to.path === '/who' || to.path === '/settings') return next()
      return next('/who')
    }
    if (to.path === '/who') return next(landingPath(authStore, financeStore))

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
