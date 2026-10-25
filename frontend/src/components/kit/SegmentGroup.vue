<script lang="ts">
/**
 * Откуда ехать ползунку: последнее нажатие по группе (`label`). Экран при смене адреса пересоздаётся
 * (`AppShell` — `RouterView` с ключом), и новая группа монтируется уже с новой активной — без этой памяти переезда
 * не видно. Старше `FROM_MS` — не в счёт (вернулись на экран вкладкой, а не нажатием сегмента).
 */
const lastPick = new Map<string, { from: string; at: number }>()
const FROM_MS = 1500
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

/**
 * Сегмент-переключатель экранов (К-11, FG-09, вариант составителя): «Неделя | Месяц» (`PlanSwitch`) и «Капитал · Долги ·
 * История» (`MoneySquares`) — один вид и один механизм. Под активной кнопкой — плашка-ползунок, она переезжает под
 * нажатую (`transform`, `--motion-base`); «Уменьшить движение» — встаёт сразу (общее правило `style.css`). Навигация не
 * ждёт анимации: `pick` уходит сразу. Группа кнопок с `aria-current` — это переход по адресу, не вкладки на месте.
 */
const props = defineProps<{
  items: { key: string; label: string; dot?: boolean; attrs?: Record<string, string> }[]
  active: string
  label: string
}>()
const emit = defineEmits<{ (e: 'pick', key: string): void }>()

const index = (key: string) => Math.max(0, props.items.findIndex((i) => i.key === key))
const recent = lastPick.get(props.label)
const from = recent && Date.now() - recent.at < FROM_MS && recent.from !== props.active ? recent.from : null
lastPick.delete(props.label)
const pos = ref(index(from ?? props.active))
onMounted(() => {
  // Два кадра: первый рисует ползунок на прежнем месте, во втором он едет (иначе переход схлопнется в один кадр).
  if (from !== null) requestAnimationFrame(() => requestAnimationFrame(() => (pos.value = index(props.active))))
})
watch(
  () => props.active,
  (a) => (pos.value = index(a)),
)
const slider = computed(() => ({ width: `calc((100% - 8px) / ${props.items.length})`, transform: `translateX(${pos.value * 100}%)` }))

function pick(key: string) {
  if (key === props.active) return
  lastPick.set(props.label, { from: props.active, at: Date.now() })
  emit('pick', key)
}
</script>

<template>
  <div class="relative flex rounded-[14px] bg-surface-2 p-1" role="group" :aria-label="label">
    <span
      class="pointer-events-none absolute inset-y-1 left-1 rounded-[10px] bg-surface transition-transform duration-(--motion-base) ease-(--ease-out)"
      :style="slider"
      aria-hidden="true"
      data-segment-slider
    />
    <button
      v-for="i in items"
      :key="i.key"
      type="button"
      v-bind="i.attrs"
      :aria-current="i.key === active ? 'page' : undefined"
      class="press relative z-10 min-w-0 flex-1 cursor-pointer truncate rounded-[10px] p-[9px] text-center text-[14.5px] font-semibold"
      :class="i.key === active ? 'text-ink' : 'text-ink-2'"
      @click="pick(i.key)"
    >
      {{ i.label }}<template v-if="i.dot"><span class="ml-1.5 inline-block size-2 rounded-full bg-brand align-middle" data-plan-dot aria-hidden="true" /><span class="sr-only">, есть что сделать</span></template>
    </button>
  </div>
</template>
