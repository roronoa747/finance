<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter, RouterLink, RouterView } from 'vue-router'
import {
  PhHouse,
  PhChartBar,
  PhPlus,
  PhTarget,
  PhVault,
  PhPaintBrush,
  PhSparkle,
  PhUserPlus,
  PhTrendUp,
  PhShoppingBag,
  PhReceipt,
  PhCreditCard,
  PhX,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { monthTitle, monthKey } from '@/lib/dates'
import SyncBadge from '@/components/SyncBadge.vue'
import AppearancePanel from '@/components/AppearancePanel.vue'
import Row from '@/components/kit/Row.vue'

const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()

const addOpen = ref(false)
const themeOpen = ref(false)

const people = computed(() => financeStore.people)
const memberCount = computed(() => people.value.length)

const title = computed(() => {
  const p = route.path
  if (p === '/') return monthTitle(monthKey())
  if (p.startsWith('/budget')) return 'Бюджет'
  // Список — по точному пути, экран одной записи — своё имя (React `AppShell.tsx:36-38`).
  if (p === '/goals') return 'Цели и покупки'
  if (p.startsWith('/goals/')) return 'Цель'
  if (p === '/capital') return 'Капитал'
  if (p.startsWith('/capital/')) return 'Вклад'
  if (p.startsWith('/ritual')) return 'Ритуал'
  if (p.startsWith('/plan')) return 'План'
  return 'Family Finance'
})

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

function navigateAndClose(to: string) {
  addOpen.value = false
  void router.push(to)
}
function onSparkleClick() {
  if (typeof window !== 'undefined') {
    window.alert('ИИ-советник появится в продуктовом обновлении после подключения аналитики.')
  }
}
</script>

<template>
  <div
    class="mx-auto flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-canvas md:my-8 md:h-[860px] md:max-w-[420px] md:rounded-[42px] md:border md:border-line-strong md:shadow-2xl text-left"
  >
    <!-- Top Header -->
    <header class="flex shrink-0 items-center gap-3 bg-canvas px-4 pb-3 pt-4 border-b border-line/40">
      <!-- Avatars -->
      <div class="flex items-center">
        <template v-if="people.length">
          <span
            v-for="(p, i) in people"
            :key="p.id"
            class="grid size-7 place-items-center rounded-full border-2 border-canvas text-[12px] font-semibold text-dot-ink shadow-xs"
            :style="{ background: `var(--p${p.id})`, marginLeft: i ? '-9px' : '0' }"
            :title="p.name"
          >
            {{ p.name.slice(0, 1) }}
          </span>
        </template>
        <span
          v-else
          class="grid size-7 place-items-center rounded-full border-2 border-canvas bg-brand text-[12px] font-semibold text-brand-ink"
        >
          FF
        </span>
      </div>

      <!-- Title & SyncBadge -->
      <div class="mr-auto min-w-0">
        <div class="truncate font-display text-[16px] font-semibold leading-tight text-ink">
          {{ title }}
        </div>
        <SyncBadge />
      </div>

      <!-- Header actions -->
      <button
        type="button"
        aria-label="Оформление"
        class="grid size-[34px] place-items-center rounded-xl text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
        @click="themeOpen = true"
      >
        <PhPaintBrush :size="18" />
      </button>

      <button
        type="button"
        aria-label="Советник"
        class="grid size-[34px] place-items-center rounded-xl text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors cursor-pointer"
        @click="onSparkleClick"
      >
        <PhSparkle :size="18" />
      </button>
    </header>

    <!-- Main Content Area -->
    <main ref="mainEl" class="flex-1 overflow-y-auto px-4 pb-6 [overscroll-behavior:contain]">
      <RouterView />
    </main>

    <!-- Bottom Navigation Bar -->
    <nav class="grid shrink-0 grid-cols-5 border-t border-line bg-surface px-1 py-1.5 shadow-xs select-none">
      <!-- Tab: Обзор -->
      <RouterLink
        to="/"
        class="flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors cursor-pointer"
        :class="route.path === '/' ? 'text-brand font-semibold' : 'text-ink-3 hover:text-ink'"
      >
        <PhHouse :size="20" :weight="route.path === '/' ? 'fill' : 'regular'" />
        <span class="text-[10.5px]">Обзор</span>
      </RouterLink>

      <!-- Tab: Бюджет -->
      <RouterLink
        to="/budget"
        class="flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors cursor-pointer"
        :class="route.path.startsWith('/budget') ? 'text-brand font-semibold' : 'text-ink-3 hover:text-ink'"
      >
        <PhChartBar :size="20" :weight="route.path.startsWith('/budget') ? 'fill' : 'regular'" />
        <span class="text-[10.5px]">Бюджет</span>
      </RouterLink>

      <!-- Center Plus Button -->
      <div class="flex items-center justify-center">
        <button
          type="button"
          aria-label="Добавить"
          class="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink transition-transform active:scale-95 shadow-xs cursor-pointer"
          @click="addOpen = true"
        >
          <PhPlus :size="19" weight="bold" />
        </button>
      </div>

      <!-- Tab: Цели -->
      <RouterLink
        to="/goals"
        class="flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors cursor-pointer"
        :class="route.path.startsWith('/goals') ? 'text-brand font-semibold' : 'text-ink-3 hover:text-ink'"
      >
        <PhTarget :size="20" :weight="route.path.startsWith('/goals') ? 'fill' : 'regular'" />
        <span class="text-[10.5px]">Цели</span>
      </RouterLink>

      <!-- Tab: Капитал -->
      <RouterLink
        to="/capital"
        class="flex flex-col items-center justify-center gap-0.5 px-0.5 transition-colors cursor-pointer"
        :class="route.path.startsWith('/capital') ? 'text-brand font-semibold' : 'text-ink-3 hover:text-ink'"
      >
        <PhVault :size="20" :weight="route.path.startsWith('/capital') ? 'fill' : 'regular'" />
        <span class="text-[10.5px]">Капитал</span>
      </RouterLink>
    </nav>

    <!-- Quick Add Drawer / Modal -->
    <div
      v-if="addOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-xs transition-opacity"
      @click.self="addOpen = false"
    >
      <div class="w-full max-w-[440px] rounded-t-3xl border border-line bg-surface p-4 pb-8 shadow-2xl">
        <div class="mb-3 flex items-center justify-between px-1">
          <h3 class="font-display text-[17px] font-semibold text-ink">Добавить</h3>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="addOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <div class="flex flex-col divide-y divide-line">
          <Row
            v-if="memberCount < 2"
            title="Пригласить партнёра"
            note="код для второго участника"
            clickable
            @click="navigateAndClose('/')"
          >
            <template #icon><PhUserPlus :size="16" class="text-brand" /></template>
          </Row>

          <Row
            title="Внеплановый доход"
            note="премия, подарок, возврат"
            clickable
            @click="navigateAndClose('/capital?income=1')"
          >
            <template #icon><PhTrendUp :size="16" class="text-brand" /></template>
          </Row>

          <Row
            title="Пополнить цель"
            note="взнос в накопления"
            clickable
            @click="navigateAndClose('/goals')"
          >
            <template #icon><PhTarget :size="16" class="text-brand" /></template>
          </Row>

          <Row
            title="Покупка в дом"
            note="в семейный список желаний"
            clickable
            @click="navigateAndClose('/goals?tab=wish')"
          >
            <template #icon><PhShoppingBag :size="16" class="text-brand" /></template>
          </Row>

          <Row
            title="Подписка или обязательство"
            note="связь, страховка, абонемент"
            clickable
            @click="navigateAndClose('/capital?add=payment')"
          >
            <template #icon><PhReceipt :size="16" class="text-brand" /></template>
          </Row>

          <Row
            title="Кредит или рассрочка"
            note="долг, рассрочка, график"
            clickable
            @click="navigateAndClose('/capital?add=debt')"
          >
            <template #icon><PhCreditCard :size="16" class="text-brand" /></template>
          </Row>
        </div>
      </div>
    </div>

    <!-- Appearance Drawer / Modal -->
    <div
      v-if="themeOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-xs transition-opacity"
      @click.self="themeOpen = false"
    >
      <div class="w-full max-w-[440px] max-h-[85dvh] overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-8 shadow-2xl">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Оформление</h3>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="themeOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>
        <AppearancePanel />
      </div>
    </div>
  </div>
</template>
