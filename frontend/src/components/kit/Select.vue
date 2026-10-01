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
    class="w-full rounded-inner border border-transparent bg-surface-2 px-3.5 py-3 text-[15px] text-ink outline-none focus-visible:border-brand disabled:opacity-50"
    @change="onChange"
  >
    <slot>
      <option v-for="o in options" :key="o.value" :value="o.value" :selected="o.value === modelValue">
        {{ o.label }}
      </option>
    </slot>
  </select>
</template>
