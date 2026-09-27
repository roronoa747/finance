<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { monthKey, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import SyncBadge from '@/components/SyncBadge.vue'
import Avatar from '@/components/kit/Avatar.vue'
import IconBox from '@/components/kit/IconBox.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tabs from '@/components/kit/Tabs.vue'

/**
 * Оболочка (DESIGN.md §2, §5; B2C-13): шапка `.topbar` — заголовок экрана Piazzolla 30 с
 * подписью, аватары участников (точка при «не сошлось» — `SyncBadge` compact), шестерёнка →
 * `/settings`; капсула вкладок «Мечты · Неделя · Деньги» и «+»; лист «+» на `Sheet` — шесть
 * действий, у viewer только «Покупка в список желаний». «Советника» нет.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const addOpen = ref(false)

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const names = computed(() => people.value.map((p) => p.name).join(' и '))
const monthName = computed(() => MONTHS_NOM[parseMonthKey(monthKey()).month])

/** Заголовок и подпись шапки по маршруту (DESIGN.md §6 «Заголовки экранов»). */
const header = computed<{ title: string; sub?: string }>(() => {
  const p = route.path
  if (p === '/') return { title: 'Мечты', sub: `${monthName.value} · ${names.value}` }
  if (p === '/week/salary') return { title: 'Разложим' }
  if (p.startsWith('/week')) return { title: 'Неделя' }
  if (p === '/money') return { title: 'Деньги', sub: `${monthName.value} · ${names.value}` }
  if (p.startsWith('/money/budget')) return { title: 'Бюджет' }
  if (p === '/money/capital') return { title: 'Капитал', sub: 'счета и долги семьи' }
  if (p.startsWith('/money/capital/')) return { title: 'Вклад' }
  if (p.startsWith('/money/plan')) return { title: 'План' }
  if (p === '/goals/new') return { title: 'Новая мечта' }
  if (p.startsWith('/goals/')) return { title: 'Цель' }
  if (p === '/wishes') return { title: 'Желания', sub: 'не мечты — покупки поменьше' }
  if (p === '/settings') return { title: 'Настройки' }
  return { title: 'Family Finance' }
})

const tabs = computed(() => [
  { to: '/', label: 'Мечты', icon: PhHeart, active: route.path === '/' || route.path.startsWith('/goals') || route.path === '/wishes' },
  { to: '/week', label: 'Неделя', icon: PhCalendarBlank, active: route.path.startsWith('/week') },
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

/** Лист «+» (DESIGN.md §2): порядок действий — как в макете; viewer — только желания. */
const actions = computed(() => {
  const edit = !authStore.isViewer
  return [
    edit && { to: '/week?upload=1', title: 'Загрузить выписку', note: 'Kaspi или Freedom — траты недели по разделам', icon: PhFileArrowUp },
    edit && { to: '/goals/new', title: 'Новая мечта', note: 'фото, сумма и срок', icon: PhHeart },
    { to: '/wishes', title: 'Покупка в список желаний', note: 'себе, партнёру или сюрприз', icon: PhShoppingBag },
    edit && { to: '/money/capital?income=1', title: 'Внеплановый доход', note: 'премия, подарок, возврат', icon: PhCoins },
    edit && { to: '/money/capital?add=payment', title: 'Обязательство или подписка', note: 'аренда, связь, страховка', icon: PhRepeat },
    edit && { to: '/money/capital?add=debt', title: 'Кредит или рассрочка', note: 'долг, платёж, график', icon: PhCreditCard },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a))
})

function navigateAndClose(to: string) {
  addOpen.value = false
  void router.push(to)
}
</script>

<template>
  <div
    class="mx-auto flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-canvas text-left md:my-8 md:h-[860px] md:max-w-[420px] md:rounded-[42px] md:border md:border-line-strong"
  >
    <header class="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
      <div class="min-w-0">
        <h1 class="type-h1 truncate text-ink">{{ header.title }}</h1>
        <div v-if="header.sub" class="mt-0.5 truncate type-meta">{{ header.sub }}</div>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <SyncBadge compact />
        <!-- Аватары: до B2C-18 без действия; точка при «не сошлось» — внутри SyncBadge compact. -->
        <div v-if="people.length" class="flex" aria-hidden="true">
          <Avatar v-for="(p, i) in people" :key="p.id" :id="p.id" :name="p.name" :class="i ? '-ml-2' : ''" />
        </div>
        <RouterLink to="/settings" aria-label="Настройки" class="rounded-[12px]">
          <IconBox><PhGearSix :size="20" /></IconBox>
        </RouterLink>
      </div>
    </header>

    <main ref="mainEl" class="flex-1 overflow-y-auto px-4 pb-6 [overscroll-behavior:contain]">
      <RouterView />
    </main>

    <Tabs :items="tabs" plus-label="Добавить" @plus="addOpen = true" />

    <Sheet :open="addOpen" title="Добавить" @close="addOpen = false">
      <div class="flex flex-col">
        <Row v-for="a in actions" :key="a.to" :title="a.title" :note="a.note" clickable dense @click="navigateAndClose(a.to)">
          <template #icon><component :is="a.icon" :size="18" /></template>
        </Row>
      </div>
    </Sheet>
  </div>
</template>
