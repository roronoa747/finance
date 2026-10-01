<script setup lang="ts">
/** Подпись секции (DESIGN.md §4): 13/600, верхний регистр, трекинг 0.02em, `--ink-3`. */
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="mt-3 mb-1 flex items-baseline justify-between px-1">
    <h2 class="type-section">
      {{ title }}
    </h2>
    <div>
      <slot name="action" />
    </div>
  </div>
</template>
