<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { writePlanView, type PlanView } from '@/lib/storage'
import SegmentGroup from '@/components/kit/SegmentGroup.vue'

/**
 * Переключатель вкладки «План» — «Неделя | Месяц» (Р-89; макет week-month.html `.seg`): один на оба экрана.
 * Выбор запоминается на устройстве (Р-99) — вкладка «План» открывает последний; переход — `router.replace`:
 * «назад» ведёт на прошлую вкладку, а не перебирает виды. Действие зовёт точка у своего раздела в «Месяце» (Р-116,
 * Б17); исключения — `dot`: новый разбор месяца не открыт (бэклог «ИИ-польза», Р-4, решение владельца 2026-10-16) и
 * «Установить план» по неделям ждёт в строке «Траты» (Блок 5 «Фидбек», Р-36). `month` — месяц, где ждёт действие, если
 * не текущий (своя зарплата прошлого месяца не отложена): «Месяц» откроет его.
 * Вид и ползунок — `kit/SegmentGroup` (К-11, FG-09), тот же, что у `MoneySquares` (ревью frontend Б15, Н-8).
 */
const props = defineProps<{ view: PlanView; month?: string | null; dot?: boolean }>()
const router = useRouter()

const OPTIONS: { value: PlanView; label: string; to: string }[] = [
  { value: 'week', label: 'Неделя', to: '/week' },
  { value: 'month', label: 'Месяц', to: '/month' },
]
const items = computed(() => OPTIONS.map((o) => ({ key: o.value, label: o.label, dot: !!props.dot && o.value === 'month', attrs: { 'data-plan-view': o.value } })))

function pick(key: string) {
  const o = OPTIONS.find((x) => x.value === key)
  if (!o || o.value === props.view) return
  writePlanView(o.value)
  void router.replace(o.value === 'month' && props.month ? { path: o.to, query: { month: props.month } } : o.to)
}
</script>

<template>
  <SegmentGroup :items="items" :active="view" label="План" @pick="pick" />
</template>
