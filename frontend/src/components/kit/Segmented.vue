<script setup lang="ts" generic="T extends string">
defineProps<{
  modelValue: T
  options: { value: T; label: string }[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: T): void
}>()
</script>

<template>
  <div class="flex gap-[3px] rounded-xl bg-surface-3 p-[3px]">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :aria-pressed="opt.value === modelValue"
      :class="[
        'flex-1 rounded-[9px] px-2 py-2 text-[13.5px] transition-colors cursor-pointer text-center font-medium',
        opt.value === modelValue
          ? 'bg-surface font-semibold text-ink shadow-xs'
          : 'text-ink-2 hover:text-ink',
      ]"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
