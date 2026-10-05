<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { PhCaretLeft, PhCaretRight } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { useFinanceStore } from '@/stores/finance'
import { addMonths, monthKey, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import { planSave, salaryAsk } from '@/lib/finance'
import MonthPlan from '@/components/money/MonthPlan.vue'
import MonthPast from '@/components/money/MonthPast.vue'
import PlanSwitch from '@/components/plan/PlanSwitch.vue'

/**
 * «План · Месяц» (Блок 15, Р-89, Р-90): план месяца семьи (`MonthPlan`), прошлые месяцы — сводкой (`MonthPast`,
 * ‹ к прошлому). `?month=YYYY-MM` — тот месяц (ссылки «Истории», старые закладки `/money?month=`): месяц, где своя
 * зарплата пришла, не отложена и есть что отложить (`planSave`), — планом, иначе прошлый — сводкой. Viewer —
 * без переключателя «Неделя | Месяц» (Р-104). Ничего не считается здесь.
 */
const route = useRoute()
const authStore = useAuthStore()
const ops = useOperationsStore()
const finance = useFinanceStore()

const key = computed(() => monthKey())

/* ---------- месяц: этот — план, прошлые — сводкой ---------- */
const PAST_MONTHS = 12
const askedOf = (m: unknown) =>
  typeof m === 'string' && /^\d{4}-\d{2}$/.test(m) && m <= addMonths(key.value, 1) && m >= addMonths(key.value, -PAST_MONTHS) ? m : null
const shown = ref(askedOf(route.query.month) ?? key.value)
// Ссылка «Истории» при открытом «Месяце» экран не пересоздаёт — месяц берём из адреса; `?month=` пропал
// (вкладка «План») — текущий месяц.
watch(
  () => route.query.month,
  (m) => {
    const asked = askedOf(m)
    if (asked) shown.value = asked
    else if (m === undefined) shown.value = key.value
  },
)
const isNow = computed(() => shown.value >= key.value)
const canBack = computed(() => shown.value > addMonths(key.value, -PAST_MONTHS))
// Вперёд — до этого месяца; на следующий — только когда уже ждём его зарплату (день 1–3-го: «Пришла» за пару дней до месяца).
const canForward = computed(() => {
  if (shown.value < key.value) return true
  if (shown.value > key.value || authStore.isViewer) return false
  return salaryAsk(finance.planInput(key.value).state, authStore.slot)?.key === addMonths(key.value, 1)
})
// Своя зарплата месяца пришла и не отложена — план этого месяца с отметками, а не сводка (Р-78).
const unsaved = computed(() => {
  if (isNow.value || !authStore.slot || authStore.isViewer) return false
  return !!planSave(finance.monthPlanOf(shown.value), authStore.slot)
})
const monthName = computed(() => MONTHS_NOM[parseMonthKey(shown.value).month])
// Своя зарплата прошлого месяца пришла и не отложена (`planCall`) — точка у «‹».
const pastCall = computed(() => {
  const call = finance.planCall()
  return !!call && call < shown.value
})

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <PlanSwitch v-if="!authStore.isViewer" view="month" />

    <!-- Месяц: ‹ к прошлым (сводка), › — назад к этому -->
    <div class="relative flex items-center justify-center gap-3.5 text-[15px] font-semibold text-ink" data-month-nav>
      <button type="button" class="press relative grid size-8 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canBack" aria-label="Прошлый месяц" @click="shown = addMonths(shown, -1)">
        <PhCaretLeft :size="18" />
        <!-- Своя зарплата прошлого месяца пришла и не отложена — точка зовёт назад (Р-97) -->
        <template v-if="pastCall">
          <span class="absolute right-0.5 top-0.5 size-2 rounded-full bg-brand" data-past-dot aria-hidden="true" /><span class="sr-only">, есть что сделать</span>
        </template>
      </button>
      <span>{{ monthName }}</span>
      <button type="button" class="press grid size-8 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canForward" aria-label="Следующий месяц" @click="shown = addMonths(shown, 1)">
        <PhCaretRight :size="18" />
      </button>
      <span v-if="authStore.isViewer" class="absolute right-0 rounded-pill bg-surface-2 px-2 py-[3px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-ink-3">просмотр</span>
    </div>

    <MonthPlan v-if="isNow || unsaved" :key="shown" :month-key="shown" />
    <MonthPast v-else :month-key="shown" />
  </div>
</template>
