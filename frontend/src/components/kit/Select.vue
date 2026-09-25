<script setup lang="ts">
import { nextTick } from 'vue'

/**
 * Выпадающий список. Варианты — `options` или свои `<option>`/`<optgroup>` в слоте.
 * Поле показывает то, что в модели: выбор, который родитель не принял (список-
 * действие «Добавить подписку» — выбрал и сразу сбросил), в поле не остаётся.
 */
const props = defineProps<{
  modelValue: string
  options?: { value: string; label: string }[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
}>()

function onChange(e: Event) {
  const el = e.target as HTMLSelectElement
  emit('update:modelValue', el.value)
  void nextTick(() => {
    if (el.value !== props.modelValue) el.value = props.modelValue
  })
}
</script>

<template>
  <select
    :value="modelValue"
    :disabled="disabled"
    class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink disabled:opacity-50"
    @change="onChange"
  >
    <slot>
      <option v-for="o in options" :key="o.value" :value="o.value" :selected="o.value === modelValue">
        {{ o.label }}
      </option>
    </slot>
  </select>
</template>
