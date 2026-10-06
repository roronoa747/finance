<script setup lang="ts">
import { useRouter } from 'vue-router'
import { writePlanView, type PlanView } from '@/lib/storage'

/**
 * Переключатель вкладки «План» — «Неделя | Месяц» (Р-89; макет week-month.html `.seg`): один на оба экрана.
 * Выбор запоминается на устройстве (Р-99) — вкладка «План» открывает последний; переход — `router.replace`:
 * «назад» ведёт на прошлую вкладку, а не перебирает виды. `dot` — точка на «Месяце»: там ждёт действие (Р-97);
 * `month` — месяц, где оно ждёт, если это не текущий (своя зарплата прошлого месяца не отложена): «Месяц» откроет его.
 * Это переход по адресу, не вкладки на месте: группа кнопок с `aria-current`, как `MoneySquares` (ревью frontend Б15, Н-8).
 */
const props = defineProps<{ view: PlanView; dot?: boolean; month?: string | null }>()
const router = useRouter()

const OPTIONS: { value: PlanView; label: string; to: string }[] = [
  { value: 'week', label: 'Неделя', to: '/week' },
  { value: 'month', label: 'Месяц', to: '/month' },
]

function pick(o: (typeof OPTIONS)[number]) {
  if (o.value === props.view) return
  writePlanView(o.value)
  void router.replace(o.value === 'month' && props.month ? { path: o.to, query: { month: props.month } } : o.to)
}
</script>

<template>
  <div class="flex gap-1 rounded-[14px] bg-surface-2 p-1" role="group" aria-label="План">
    <button
      v-for="o in OPTIONS"
      :key="o.value"
      type="button"
      :aria-current="o.value === view ? 'page' : undefined"
      :data-plan-view="o.value"
      class="press relative flex-1 cursor-pointer rounded-[10px] p-[9px] text-center text-[14.5px] font-semibold"
      :class="o.value === view ? 'bg-surface text-ink' : 'text-ink-3'"
      @click="pick(o)"
    >
      {{ o.label }}
      <template v-if="dot && o.value === 'month' && view !== 'month'">
        <span class="ml-1.5 inline-block size-2 rounded-full bg-brand align-middle" data-plan-dot aria-hidden="true" /><span class="sr-only">, есть что сделать</span>
      </template>
    </button>
  </div>
</template>
