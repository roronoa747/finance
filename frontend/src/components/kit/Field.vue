<script setup lang="ts">
/**
 * Подпись над полем. Поле ввода — внутри `<label>`: тап по подписи ставит в него
 * курсор. Группа кнопок (`group`) — не в `<label>`: иначе подпись становится именем
 * первой кнопки, и тап по ней эту кнопку нажимает.
 */
defineProps<{
  label: string
  group?: boolean
}>()
</script>

<template>
  <div v-if="group" role="group" :aria-label="label" class="mb-3.5 flex flex-col gap-1.5 text-left">
    <span class="text-[12.5px] font-medium text-ink-3">{{ label }}</span>
    <slot />
  </div>
  <label v-else class="mb-3.5 flex flex-col gap-1.5 text-left">
    <span class="text-[12.5px] font-medium text-ink-3">{{ label }}</span>
    <slot />
  </label>
</template>
