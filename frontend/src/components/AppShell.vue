<script setup lang="ts">
import { ref, computed, watch, provide } from 'vue'
import { useRoute, useRouter, RouterLink, RouterView } from 'vue-router'
import {
  PhHeart,
  PhCalendarBlank,
  PhWallet,
  PhGearSix,
  PhFileArrowUp,
  PhShoppingBag,
  PhCoins,
  PhRepeat,
  PhCreditCard,
  PhCaretLeft,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { monthKey, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import { readPlanView } from '@/lib/storage'
import { liveGoals } from '@/lib/finance'
import SyncBadge from '@/components/SyncBadge.vue'
import Avatar from '@/components/kit/Avatar.vue'
import IconBox from '@/components/kit/IconBox.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tabs from '@/components/kit/Tabs.vue'

/**
 * Оболочка (DESIGN.md §2, §5; B2C-13): шапка `.topbar` — заголовок экрана 30 (системный, пивот 3) с
 * подписью, аватары участников (точка при «не сошлось» — `SyncBadge` compact), шестерёнка →
 * `/settings`; капсула вкладок «Мечты · План · Деньги» и «+»; лист «+» на `Sheet` — шесть
 * действий; у viewer «+» нет вовсе (ТЗ B2C-13 п. 3: лист без действий правки — а добавить
 * покупку viewer тоже не может, критик Блока 3). «Советника» нет.
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

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const names = computed(() => people.value.map((p) => p.name).join(' и '))
const monthName = computed(() => MONTHS_NOM[parseMonthKey(monthKey()).month])

/** Вкладки — корни (у «Денег» — все три квадрата, пивот 3); остальное — вложенные экраны со стрелкой «назад». */
const ROOTS = ['/', '/week', '/month', '/money', '/money/debts', '/money/history']
const isRoot = computed(() => ROOTS.includes(route.path))
/** Экраны-потоки без нижней навигации (в макетах — без вкладок): цель, желания, настройки. */
const noTabs = computed(() => {
  const p = route.path
  return p.startsWith('/goals/') || p === '/wishes' || p.startsWith('/people/') || p.startsWith('/settings')
})

/** «Назад»: по истории, а открытый по ссылке экран — к своему корню. */
function goBack() {
  const p = route.path
  if (typeof window !== 'undefined' && window.history.state?.back) router.back()
  else void router.push(p.startsWith('/week') ? '/week' : p === '/settings/me' ? '/settings' : '/')
}

/** Заголовок и подпись шапки по маршруту (DESIGN.md §6 «Заголовки экранов»). */
const header = computed<{ title: string; sub?: string }>(() => {
  const p = route.path
  if (p === '/') return { title: 'Мечты', sub: `${monthName.value} · ${names.value}` }
  // «План» — одна вкладка на «Неделю» и «Месяц» (Р-89): даты недели и месяц листаются на самих экранах.
  if (p.startsWith('/week') || p === '/month') return { title: 'План', sub: names.value }
  // «Деньги» — один экран с тремя квадратами (пивот 3, Р-31): шапка одна на все.
  if (p === '/money' || p.startsWith('/money/')) return { title: 'Деньги', sub: `${monthName.value} · ${names.value}` }
  if (p === '/goals/new') return { title: 'Новая мечта' }
  if (p.startsWith('/goals/')) {
    // Имя цели заголовком (g4 «Экран цели»): «главная мечта · Ильяс и Дана».
    const goal = liveGoals(financeStore.goals).find((g) => g.id === route.params.id)
    const main = financeStore.heroGoal?.id === goal?.id
    // Фонд («Запас», «Подушка», Р-82) — не мечта (ревью frontend Б14, Н-2).
    const fund = financeStore.queue.find((x) => x.id === goal?.id)?.kind === 'fund'
    return goal ? { title: goal.name, sub: `${fund ? 'фонд' : main ? 'главная мечта' : 'мечта'} · ${names.value}` } : { title: 'Цель' }
  }
  if (p === '/wishes' || p.startsWith('/people/')) return { title: 'Желания', sub: 'не мечты — покупки поменьше' }
  if (p === '/settings/me') return { title: 'Свой кружок' }
  if (p === '/settings') {
    // g7: «Ильяс · ilyas@…» — имя в семье и почта входа.
    const me = people.value.find((x) => x.id === authStore.slot)?.name
    const sub = [me, authStore.user?.email].filter(Boolean).join(' · ')
    return sub ? { title: 'Настройки', sub } : { title: 'Настройки' }
  }
  return { title: 'Family Finance' }
})

/** Вкладка «План» открывает последний выбранный вид (Р-99, на устройстве); viewer — всегда «Месяц» (Р-104). */
const planTo = computed(() => {
  void route.path // вид запоминает переключатель и тут же меняет адрес — перечитываем на каждом переходе
  return authStore.isViewer || readPlanView() === 'month' ? '/month' : '/week'
})

const tabs = computed(() => [
  { to: '/', label: 'Мечты', icon: PhHeart, active: route.path === '/' || route.path.startsWith('/goals') || route.path === '/wishes' || route.path.startsWith('/people/') },
  { to: planTo.value, label: 'План', icon: PhCalendarBlank, active: route.path.startsWith('/week') || route.path === '/month' },
  { to: '/money', label: 'Деньги', icon: PhWallet, active: route.path.startsWith('/money') },
])

// Прокручивается не окно, а <main>: новый экран открывается сверху, а не на прокрутке
// прошлого (после «Выбрать этот план» шаг месяца был за верхом экрана). По path, не
// fullPath: Капитал открывает окна параметром адреса (Б-15) — список не прыгает.
const mainEl = ref<HTMLElement | null>(null)
watch(
  () => route.path,
  () => {
    if (mainEl.value) mainEl.value.scrollTop = 0
  },
  { flush: 'post' },
)

/** Лист «+» (DESIGN.md §2): порядок действий — как в макете; у viewer кнопки «+» нет. */
const actions = computed(() => {
  const edit = !authStore.isViewer
  return [
    edit && { to: '/week?upload=1', title: 'Загрузить выписку', note: 'Kaspi или Freedom — траты недели по разделам', icon: PhFileArrowUp },
    edit && { to: '/goals/new', title: 'Новая мечта', note: 'фото, сумма и срок', icon: PhHeart },
    edit && { to: '/wishes', title: 'Покупка в список желаний', note: 'себе, партнёру или сюрприз', icon: PhShoppingBag },
    edit && { to: '/month?income=1', title: 'Внеплановый доход', note: 'премия, подарок, возврат', icon: PhCoins },
    edit && { to: '/money?add=payment', title: 'Обязательство или подписка', note: 'аренда, связь, страховка', icon: PhRepeat },
    edit && { to: '/money?add=debt', title: 'Кредит или рассрочка', note: 'долг, платёж, график', icon: PhCreditCard },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a))
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
    <header class="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
      <div class="flex min-w-0 items-center gap-2.5">
        <button
          v-if="!isRoot"
          type="button"
          aria-label="Назад"
          class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
          @click="goBack"
        >
          <PhCaretLeft :size="20" />
        </button>
        <div class="min-w-0">
          <h1 class="type-h1 truncate text-ink">{{ header.title }}</h1>
          <div v-if="header.sub" class="mt-0.5 truncate type-meta">{{ header.sub }}</div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <!-- Действия вложенного экрана (карандаш цели, «+» желаний) — сюда их переносит HeaderActions. -->
        <div id="shell-actions" class="flex items-center gap-2.5 empty:hidden" />
        <template v-if="isRoot">
          <!-- Место под бейдж зарезервировано: в покое он пуст, но аватары не прыгают на каждой записи. -->
          <div class="size-[38px] shrink-0"><SyncBadge compact /></div>
          <!-- Аватары ведут на список желаний участника (B2C-18); на «Неделе» их нет (g2). -->
          <div v-if="people.length && route.path !== '/week'" class="flex">
            <RouterLink v-for="(p, i) in people" :key="p.id" :to="`/people/${p.id}`" :aria-label="`Желания · ${p.name}`" class="rounded-full" :class="i ? '-ml-2' : ''">
              <Avatar :id="p.id" :name="p.name" />
            </RouterLink>
          </div>
          <!-- Настройки — иконка в шапке главного (DESIGN.md §2). -->
          <RouterLink v-if="route.path === '/'" to="/settings" aria-label="Настройки" class="rounded-[12px]">
            <IconBox><PhGearSix :size="20" /></IconBox>
          </RouterLink>
        </template>
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

    <Sheet :open="addOpen" title="Добавить" @close="addOpen = false">
      <div class="flex flex-col">
        <Row v-for="a in actions" :key="a.to" :title="a.title" :note="a.note" clickable dense @click="navigateAndClose(a.to)">
          <template #icon><component :is="a.icon" :size="18" /></template>
        </Row>
      </div>
    </Sheet>
  </div>
</template>
