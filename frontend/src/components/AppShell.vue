<script lang="ts">
/** Вход, для которого оболочка уже освежила `/auth/me` (AI-09): повторный монтаж («назад» с `/privacy`) не зовёт снова. */
let freshFor: string | null = null
</script>

<script setup lang="ts">
import { ref, computed, provide, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterView } from 'vue-router'
import {
  PhHeart,
  PhCalendarBlank,
  PhWallet,
  PhFileArrowUp,
  PhNote,
  PhReceipt,
  PhShoppingBag,
  PhRepeat,
  PhCreditCard,
  PhCalculator,
  PhCaretLeft,
  PhPlus,
  PhMinus,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { readPlanView } from '@/lib/storage'
import { monthKey } from '@/lib/dates'
import { useScrollMemory } from './useScrollMemory'
import ShellPeople from '@/components/ShellPeople.vue'
import { provideShellHero } from '@/components/shellHero'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import AiConsentSheet from '@/components/ai/AiConsentSheet.vue'
import Tabs from '@/components/kit/Tabs.vue'

/**
 * Оболочка (DESIGN.md §2, §5; B2C-13): шапка `.topbar` — заголовок экрана 30 (системный, пивот 3) с
 * подписью, аватары участников (точка при «не сошлось» — `SyncBadge` compact) и шестерёнка — оба →
 * `/settings` (Р-1 «понятность»: нажал на лица — видишь лица в «С кем»; желания — с «Мечт»);
 * капсула вкладок «Мечты · План · Деньги» и «+»; лист «+» на `Sheet` (пачка 2 «Figma», 47:115 / 74:178, FG-23): две плитки
 * «Доход» и «Расход» и список без подписей (мечта, желание, заметка, прикидка кредита); «Расход» — вторая страница того же листа
 * (трата, выписка, платёж, долг) с «‹ Добавить»; «Хватит ли?» владелец убрал. У viewer «+» нет вовсе (ТЗ B2C-13 п. 3: лист
 * без действий правки — а добавить покупку viewer тоже не может, критик Блока 3). «Советника» нет.
 *
 * Шапка — как в макетах (возврат смоука): у вкладок справа аватары (шестерёнка — только на
 * «Мечтах», §2; на «Неделе» аватаров нет — кружки участников стоят в её строке загрузки, Р-96), у вложенных экранов слева «назад», справа — действия
 * самого экрана (`HeaderActions` переносит их в `#shell-actions`). Экраны-потоки (цель, желания,
 * настройки) — без вкладок, как в макетах g2/g4/g7.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const addOpen = ref(false)
provide('ff-shell-actions', true)
// «Мечты» с главной мечтой рисуют шапку на своей обложке (FG-21) — тогда шапки оболочки нет.
const heroHeader = provideShellHero()

/*
 * Флаг ИИ и роль — свежие с сервера при старте оболочки (хвост §4 критика Блока 1 «ИИ», AI-09): раньше `/auth/me`
 * звали только настройки и вход в семью — после перезагрузки кнопок ИИ не было, пока не откроешь настройки. Нет
 * сети — остаётся сохранённое на телефоне (`ff_ai`); 401 уводит на вход, как у синка.
 */
onMounted(() => {
  const token = authStore.token
  if (!token || authStore.isDemo || freshFor === token) return
  freshFor = token
  void authStore.fetchMe().catch(() => {})
})


/*
 * Разбор сам после своей «Пришла» (AU-13, Р-20): первая отметка зарплаты участника в месяце — повод `salary`. Стор
 * сам решает, повод ли это (аванс и недели — нет) и можно ли (согласие, сеть, лимит). Синк зовёт его после pull.
 */
const mySalaryMarks = computed(() => useAiStore().salaryMarks(monthKey()).length)
watch(mySalaryMarks, (n, was) => {
  if (n > (was ?? 0)) void useAiStore().autoReview()
})
// Флаг ИИ пришёл с `/auth/me` позже, чем подтянулся документ (первый вход после включения ИИ семье): синк уже
// отработал — разбор сам не ждёт следующего круга. Только по документу, сверенному с сервером в этом запуске
// (`pulledOnce`; `idle` при старте — лишь «нечего отправлять», документ может быть днями старым), и не по черновику.
watch(
  () => useAiStore().available,
  (on) => {
    if (on && financeStore.pulledOnce && financeStore.status === 'idle') void useAiStore().autoReview()
  },
)

/** Вкладки — корни (у «Денег» — все три квадрата, пивот 3); остальное — вложенные экраны со стрелкой «назад». */
const ROOTS = ['/', '/week', '/month', '/money', '/money/debts', '/money/history']
const isRoot = computed(() => ROOTS.includes(route.path))
/** Экраны-потоки без нижней навигации (в макетах — без вкладок): цель, желания, настройки. */
const noTabs = computed(() => {
  const p = route.path
  return p.startsWith('/goals/') || p === '/wishes' || p.startsWith('/people/') || p.startsWith('/settings') || p === '/admin'
})

/**
 * «Назад»: по истории, а открытый по ссылке экран — к своему корню. К корню — `replace` (FB-22): `push` давал
 * «Настройкам» `back` на открытые холодно «Цифры» / «Свой кружок», и «Назад» гонял их по кругу до перезагрузки.
 */
function goBack() {
  const p = route.path
  if (typeof window !== 'undefined' && window.history.state?.back) router.back()
  else void router.replace(p.startsWith('/week') ? '/week' : p === '/settings/me' || p === '/admin' ? '/settings' : '/')
}

/** Заголовок и подпись шапки по маршруту (DESIGN.md §6 «Заголовки экранов»). */
const header = computed<{ title: string; sub?: string }>(() => {
  const p = route.path
  // Подзаголовков «<месяц> · <имена>» нет (Р-116): кружки людей уже в шапке, месяц — на своём экране.
  if (p === '/') return { title: 'Мечты' }
  // «План» — одна вкладка на «Неделю» и «Месяц» (Р-89): даты недели и месяц листаются на самих экранах.
  if (p.startsWith('/week') || p === '/month') return { title: 'План' }
  // «Деньги» — один экран с тремя квадратами (пивот 3, Р-31): шапка одна на все.
  if (p === '/money/debts/faster') return { title: 'Закрыть быстрее' }
  if (p === '/money' || p.startsWith('/money/')) return { title: 'Деньги' }
  if (p === '/goals/new') return { title: 'Новая мечта' }
  // Цель — шапка без заголовка (FG-30, макеты 78:50, 78:104): имя — на обложке и в листе «···»; и у сбывшейся.
  if (p.startsWith('/goals/')) return { title: '' }
  if (p === '/wishes' || p.startsWith('/people/')) return { title: 'Желания' }
  if (p === '/settings/me') return { title: 'Свой кружок' }
  if (p === '/admin') return { title: 'Цифры' }
  if (p === '/settings') {
    // Под заголовком — только почта входа: имя — в «Свой кружок» (Р-116, макет Б17; PN-01); в демо почты нет.
    const sub = authStore.isDemo ? null : authStore.user?.email
    return sub ? { title: 'Настройки', sub } : { title: 'Настройки' }
  }
  return { title: 'Family Finance' }
})

/** Вкладка «План» открывает последний выбранный вид (Р-99, на устройстве); viewer — всегда «Месяц» (Р-104). */
const planTo = computed(() => {
  void route.path // вид запоминает переключатель и тут же меняет адрес — перечитываем на каждом переходе
  return authStore.isViewer || readPlanView() === 'month' ? '/month' : '/week'
})

const ai = useAiStore()
const tabs = computed(() => [
  { to: '/', label: 'Мечты', icon: PhHeart, active: route.path === '/' || route.path.startsWith('/goals') || route.path === '/wishes' || route.path.startsWith('/people/') },
  // Точка — новый разбор месяца не открыт на этом телефоне (бэклог «ИИ-польза», Р-4).
  { to: planTo.value, label: 'План', icon: PhCalendarBlank, active: route.path.startsWith('/week') || route.path === '/month', dot: ai.reviewUnseen },
  { to: '/money', label: 'Деньги', icon: PhWallet, active: route.path.startsWith('/money') },
])

// Прокручивается не окно, а <main>: новый экран — сверху, «назад» и вкладка — на своё место (Р-115).
const mainEl = ref<HTMLElement | null>(null)
useScrollMemory(mainEl, (p) => ROOTS.includes(p), authStore.token)

/**
 * Лист «+» (DESIGN.md §2; пачка 2 «Figma», FG-23): у viewer кнопки «+» нет — список пунктов только для участника. Адреса пунктов
 * прежние; «Доход» — плиткой (`/month?income=1`), «Расход» — страница листа со своими пунктами.
 */
const actions = [
  { to: '/goals/new', title: 'Мечта', icon: PhHeart },
  { to: '/wishes', title: 'Желание', icon: PhShoppingBag },
  // «Заметка» себе с датой (Блок 5 «Фидбек», Р-33): всплывает карточкой на «Неделе» своей даты.
  { to: '/week?note=1', title: 'Заметка', icon: PhNote },
  // Прикидка ничего не пишет (Р-11); у viewer «+» нет вовсе — «Прикинуть кредит» ему с «Долгов» (PN-17).
  { to: '/money/debts?try=1', title: 'Прикинуть кредит', icon: PhCalculator },
]
const expenses = [
  // «Трата» руками — первой (бэклог «Ручная трата», Р-1): самое частое действие дня, выписка — раз в неделю.
  { to: '/week?spend=1', title: 'Трата', icon: PhReceipt },
  { to: '/week?upload=1', title: 'Выписка', icon: PhFileArrowUp },
  { to: '/money?add=payment', title: 'Платёж или подписка', icon: PhRepeat },
  { to: '/money?add=debt', title: 'Долг', icon: PhCreditCard },
]
/** Страница листа «+»: «Добавить» или «Расход»; закрытие возвращает к «Добавить». */
const addPage = ref<'root' | 'expense'>('root')
watch(addOpen, (open) => {
  if (!open) addPage.value = 'root'
})

function navigateAndClose(to: string) {
  addOpen.value = false
  void router.push(to)
}
</script>

<template>
  <div
    class="relative mx-auto flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-canvas text-left md:my-8 md:h-[860px] md:max-w-[420px] md:rounded-[42px] md:border md:border-line-strong"
  >
    <header v-if="!heroHeader" class="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4" data-shell-header>
      <div class="flex min-w-0 items-center gap-2.5">
        <button
          v-if="!isRoot"
          type="button"
          aria-label="Назад"
          class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-glass text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
          @click="goBack"
        >
          <PhCaretLeft :size="20" />
        </button>
        <div class="min-w-0">
          <h1 v-if="header.title" class="type-h1 truncate text-ink">{{ header.title }}</h1>
          <div v-if="header.sub" class="mt-0.5 truncate type-meta">{{ header.sub }}</div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <!-- Действия вложенного экрана (карандаш цели, «+» желаний) — сюда их переносит HeaderActions. -->
        <div id="shell-actions" class="flex items-center gap-2.5 empty:hidden" />
        <!-- Бейдж синка, аватары и настройки — `ShellPeople` (тот же на обложке «Мечт», FG-21). -->
        <ShellPeople v-if="isRoot" />
      </div>
    </header>

    <!-- Капсула вкладок парит над контентом (макет pivot-3 `.tabs`): снизу запас 96 px, чтобы последняя карточка
         докручивалась из-под неё. -->
    <main ref="mainEl" :class="['flex-1 overflow-y-auto px-4 [overscroll-behavior:contain]', noTabs ? 'pb-6' : 'pb-24']">
      <!-- Смена экрана — короткое проявление (Р-45); ключ — имя маршрута: квадраты «Денег» и цели
           между собой экран не пересоздают. Шапка и капсула вкладок вне — не прыгают. -->
      <RouterView v-slot="{ Component, route: r }">
        <div :key="String(r.name ?? r.path)" class="fx-fade">
          <component :is="Component" />
        </div>
      </RouterView>
    </main>

    <!-- Тосты экранов (`kit/Toast`) — над капсулой вкладок (макет week-month.html `.toast`). -->
    <div id="shell-toast" class="absolute inset-x-4 z-20 flex flex-col gap-2 empty:hidden" :class="noTabs ? 'bottom-4' : 'bottom-[84px]'" />

    <Tabs v-if="!noTabs" :items="tabs" :plus="!authStore.isViewer" plus-label="Добавить" @plus="addOpen = true" />

    <!-- Лист «+»: плитки «Доход» / «Расход» и список без подписей; «Расход» — второй страницей того же листа (FG-23). -->
    <Sheet :open="addOpen && !authStore.isViewer" :title="addPage === 'root' ? 'Добавить' : 'Расход'" :title-hidden="addPage === 'expense'" @close="addOpen = false">
      <template v-if="addPage === 'root'">
        <div class="mb-2 grid grid-cols-2 gap-2.5" data-add-tiles>
          <button type="button" class="press flex cursor-pointer flex-col items-start gap-2 rounded-[16px] bg-ok-soft p-3.5 text-left" data-add-income @click="navigateAndClose('/month?income=1')">
            <span class="grid size-8 place-items-center rounded-full bg-ok text-surface"><PhPlus :size="16" weight="bold" /></span>
            <span class="text-[17px] font-semibold text-ok">Доход</span>
            <span class="-mt-1.5 text-[12px] text-ink-2">премия, возврат</span>
          </button>
          <button type="button" class="press flex cursor-pointer flex-col items-start gap-2 rounded-[16px] bg-destructive-soft p-3.5 text-left" data-add-expense @click="addPage = 'expense'">
            <span class="grid size-8 place-items-center rounded-full bg-destructive text-destructive-foreground"><PhMinus :size="16" weight="bold" /></span>
            <span class="text-[17px] font-semibold text-destructive">Расход</span>
            <span class="-mt-1.5 text-[12px] text-ink-2">трата, выписка, платёж</span>
          </button>
        </div>
        <div class="flex flex-col">
          <Row v-for="a in actions" :key="a.to" :title="a.title" clickable dense @click="navigateAndClose(a.to)">
            <template #icon><component :is="a.icon" :size="18" /></template>
          </Row>
        </div>
      </template>
      <template v-else>
        <!-- Заголовок страницы — в теле, рядом с крестиком: над ним тихое «‹ Добавить» (у Sheet слота над заголовком нет). -->
        <div class="-mt-[54px] mb-3 mr-12 flex min-h-[38px] flex-col justify-center">
          <button type="button" class="self-start cursor-pointer text-[13px] text-brand" data-add-back @click="addPage = 'root'">‹ Добавить</button>
          <h3 class="type-sheet text-ink" aria-hidden="true">Расход</h3>
        </div>
        <div class="flex flex-col">
          <Row v-for="a in expenses" :key="a.to" :title="a.title" clickable dense @click="navigateAndClose(a.to)">
            <template #icon><component :is="a.icon" :size="18" /></template>
          </Row>
        </div>
      </template>
    </Sheet>

    <!-- Согласие на ИИ (бэклог «ИИ», Р-9): один лист на приложение, открывает `useAiStore().ensureConsent()`. -->
    <AiConsentSheet />
  </div>
</template>
