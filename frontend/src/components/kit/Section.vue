<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="mt-2.5 mb-1 flex items-baseline justify-between px-0.5">
    <h2 class="font-display text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
      {{ title }}
    </h2>
    <div>
      <slot name="action" />
    </div>
  </div>
</template>
