<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { money, plain } from '@/lib/money'
import { addMonths, monthKey, monthFrom, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import { amountAt, breakdownPath, freedChange, freedQuestion, liveObligations } from '@/lib/finance'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button.vue'
import { buttonVariants } from '@/components/ui/button'
import Card from '@/components/kit/Card.vue'
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
 * «До зарплаты», «Освободится», виджеты Доход · Траты · Долги, «Счета» и «Платежи». Ничего не считается здесь.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()
const ops = useOperationsStore()

const square = computed(() => (route.params.square === 'plan' || route.params.square === 'history' ? route.params.square : 'capital'))
const key = computed(() => monthKey())

/* ---------- месяц: этот — план, прошлые — сводкой ---------- */
const PAST_MONTHS = 12
const shown = ref(key.value)
const isNow = computed(() => shown.value === key.value)
const canBack = computed(() => shown.value > addMonths(key.value, -PAST_MONTHS))
const monthName = computed(() => MONTHS_NOM[parseMonthKey(shown.value).month])

/* ---------- «Подробнее» — свёрнуто; адрес квадрата открывает ---------- */
const more = ref(square.value !== 'capital')
watch(square, (v) => {
  if (v !== 'capital') more.value = true
})
function onToggle(e: Event) {
  more.value = (e.target as HTMLDetailsElement).open
}

// Событие «освободится N ₸»: у годового — доля в месяц и разница за год (`freedChange`).
const freed = computed(() => freedChange(liveObligations(financeStore.obligations), key.value, fx.book))

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
      <button type="button" class="press grid size-8 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="isNow" aria-label="Следующий месяц" @click="shown = addMonths(shown, 1)">
        <PhCaretRight :size="18" />
      </button>
      <span v-if="authStore.isViewer" class="absolute right-0 rounded-pill bg-surface-2 px-2 py-[3px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-ink-3">просмотр</span>
    </div>

    <MonthPlan v-if="isNow" :month-key="shown" />
    <MonthPast v-else :month-key="shown" />

    <!-- Прежнее — за «Подробнее», свёрнуто (правило 12) -->
    <details :open="more" data-more @toggle="onToggle">
      <summary :class="cn(buttonVariants({ variant: 'ghost' }), 'flex w-full list-none [&::-webkit-details-marker]:hidden')">Подробнее</summary>
      <div class="mt-2 flex flex-col gap-3">
        <!-- Сводка «До зарплаты» — над квадратами, как прежде (у Капитала) -->
        <PaydaySummary v-if="square === 'capital'" :quiet="!!freed" />
        <MoneySquares />

        <template v-if="square === 'capital'">
          <!-- Событие высвобождения средств -->
          <Card v-if="freed" class="border-brand">
            <div class="type-section text-brand">С {{ monthFrom(freed.change.from, false) }}</div>
            <h3 class="mt-1 type-h2 text-ink">{{ freedQuestion(freed) }}</h3>
            <p class="mb-3.5 mt-1 text-[13px] text-ink-2 num">
              {{ freed.o.name }}: {{ plain(amountAt(freed.o, key, fx.book)) }} → {{ plain(amountAt(freed.o, freed.change.from, fx.book)) }} ₸ · {{ money(freed.yearly) }} за год
            </p>
            <Button v-if="!authStore.isViewer" class="w-full" @click="router.push(breakdownPath({ from: 'freed' }))">Распределить</Button>
          </Card>

          <IncomeWidget />
          <LivingWidget />
          <DebtsWidget />

          <CapitalLists />
        </template>

        <PlanSquare v-else-if="square === 'plan'" />
        <HistorySquare v-else />
      </div>
    </details>
  </div>
</template>
