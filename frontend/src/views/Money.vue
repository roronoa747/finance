<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PhCaretLeft, PhCaretRight } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { addMonths, monthKey, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import { planSave } from '@/lib/finance'
import { useFinanceStore } from '@/stores/finance'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import MoneySquares from '@/components/money/MoneySquares.vue'
import MonthPlan from '@/components/money/MonthPlan.vue'
import MonthPast from '@/components/money/MonthPast.vue'
import PaydaySummary from '@/components/money/PaydaySummary.vue'
import IncomeWidget from '@/components/money/IncomeWidget.vue'
import LivingWidget from '@/components/money/LivingWidget.vue'
import DebtsWidget from '@/components/money/DebtsWidget.vue'
import CapitalLists from '@/components/money/CapitalLists.vue'
import PlanSquare from '@/components/money/PlanSquare.vue'
import HistorySquare from '@/components/money/HistorySquare.vue'

/**
 * «Деньги» (Блок 14, Р-78): сверху — «План месяца» (`MonthPlan`, макет month-plan.html «Лесенка»), прошлые месяцы —
 * сводкой (`MonthPast`, ‹ к прошлому месяцу). Прежнее — ниже, за свёрнутым «Подробнее» (правило 12): квадраты
 * Капитал · План · История (`/money`, `/money/plan`, `/money/history` — адрес квадрата открывает «Подробнее»),
 * «До зарплаты», виджеты Доход · Траты · Долги, «Счета» и «Платежи». `?month=YYYY-MM` — сводка того месяца
 * (ссылки «Истории», карточка «Пришла зарплата» за другой месяц): месяц, где своя зарплата пришла, не отложена и есть что отложить (`planSave`, Н-1), —
 * планом с «Отложить по плану», иначе прошлый — сводкой. Ничего не считается здесь.
 */
const route = useRoute()
const authStore = useAuthStore()
const ops = useOperationsStore()
const finance = useFinanceStore()

const square = computed(() => (route.params.square === 'debts' || route.params.square === 'history' ? route.params.square : 'capital'))
const key = computed(() => monthKey())

/* ---------- месяц: этот — план, прошлые — сводкой ---------- */
const PAST_MONTHS = 12
const askedOf = (m: unknown) =>
  typeof m === 'string' && /^\d{4}-\d{2}$/.test(m) && m <= addMonths(key.value, 1) && m >= addMonths(key.value, -PAST_MONTHS) ? m : null
const shown = ref(askedOf(route.query.month) ?? key.value)
// Ссылка «Истории» (`/money?month=`) открывается в том же экране — экран не пересоздаётся, месяц берём из адреса и
// сворачиваем «Подробнее» (его открыл адрес `/money/history`); `?month=` пропал (вкладка «Деньги») — текущий месяц
// (ревью frontend Б14, Н-3).
watch(
  () => route.query.month,
  (m) => {
    const asked = askedOf(m)
    if (asked) {
      shown.value = asked
      more.value = false
    } else if (m === undefined) shown.value = key.value
  },
)
const isNow = computed(() => shown.value >= key.value)
const canBack = computed(() => shown.value > addMonths(key.value, -PAST_MONTHS))
// Своя зарплата месяца пришла и не отложена — план этого месяца с главным действием, а не сводка (Р-78).
const unsaved = computed(() => {
  if (isNow.value || !authStore.slot || authStore.isViewer) return false
  return !!planSave(finance.monthPlanOf(shown.value), authStore.slot)
})
const monthName = computed(() => MONTHS_NOM[parseMonthKey(shown.value).month])

/* ---------- «Подробнее» — свёрнуто; адрес квадрата открывает ---------- */
const more = ref(square.value !== 'capital')
watch(square, (v) => {
  if (v !== 'capital') more.value = true
})
function onToggle(e: Event) {
  more.value = (e.target as HTMLDetailsElement).open
}

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!-- Месяц: ‹ к прошлым (сводка), › — назад к этому -->
    <div class="relative flex items-center justify-center gap-3.5 text-[15px] font-semibold text-ink" data-month-nav>
      <button type="button" class="press grid size-8 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canBack" aria-label="Прошлый месяц" @click="shown = addMonths(shown, -1)">
        <PhCaretLeft :size="18" />
      </button>
      <span>{{ monthName }}</span>
      <button type="button" class="press grid size-8 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="shown >= key" aria-label="Следующий месяц" @click="shown = addMonths(shown, 1)">
        <PhCaretRight :size="18" />
      </button>
      <span v-if="authStore.isViewer" class="absolute right-0 rounded-pill bg-surface-2 px-2 py-[3px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-ink-3">просмотр</span>
    </div>

    <MonthPlan v-if="isNow || unsaved" :key="shown" :month-key="shown" />
    <MonthPast v-else :month-key="shown" />

    <!-- Прежнее — за «Подробнее», свёрнуто (правило 12) -->
    <details :open="more" data-more @toggle="onToggle">
      <summary :class="cn(buttonVariants({ variant: 'ghost' }), 'flex w-full list-none [&::-webkit-details-marker]:hidden')">Подробнее</summary>
      <div class="mt-2 flex flex-col gap-3">
        <!-- Сводка «До зарплаты» — над квадратами, как прежде (у Капитала); «Пришла» в ней тихая: главное — у плана -->
        <PaydaySummary v-if="square === 'capital'" quiet />
        <MoneySquares />

        <template v-if="square === 'capital'">
          <IncomeWidget />
          <LivingWidget />
          <DebtsWidget />

          <CapitalLists />
        </template>

        <PlanSquare v-else-if="square === 'debts'" />
        <HistorySquare v-else />
      </div>
    </details>
  </div>
</template>
