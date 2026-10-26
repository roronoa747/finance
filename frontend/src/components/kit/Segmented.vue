<script setup lang="ts" generic="T extends string">
/** Переключатель (DESIGN.md §5): плашка `--surface-3` 36 px, радиус 14 / 12 (пачка 2 «Figma», FG-19), активный — `--surface`, без тени. */
defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: T): void
}>()
</script>

<template>
  <div class="flex gap-[3px] rounded-[14px] bg-surface-3 p-[3px]">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :aria-pressed="opt.value === modelValue"
      :class="[
        'h-[30px] flex-1 rounded-[12px] px-2 text-center text-[14px] font-medium transition-colors cursor-pointer',
        opt.value === modelValue ? 'bg-surface text-ink' : 'text-ink-2 hover:text-ink',
      ]"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
