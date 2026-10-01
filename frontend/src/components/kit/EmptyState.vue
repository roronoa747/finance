<script setup lang="ts">
/** Пустое состояние (DESIGN.md §6): заголовок 22, одна фраза, действия в слоте. */
defineProps<{
  title: string
  text?: string
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-2.5 px-3 py-6 text-center text-ink-2">
    <div class="type-h2 text-ink">{{ title }}</div>
    <p v-if="text" class="text-[14px] leading-snug">{{ text }}</p>
    <div v-if="$slots.default" class="mt-1 flex flex-col items-center gap-2">
      <slot />
    </div>
  </div>
</template>
