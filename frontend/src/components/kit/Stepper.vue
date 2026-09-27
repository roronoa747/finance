<script setup lang="ts">
import ProgressBar from './ProgressBar.vue'

/** Полоса шага первого запуска «N из K» (DESIGN.md §5). */
defineProps<{
  n: number
  k: number
}>()
</script>

<template>
  <div class="flex items-center gap-2.5 text-[13px] text-ink-3">
    <ProgressBar :value="k ? n / k : 0" :height="4" class="flex-1" />
    <span class="num shrink-0">{{ n }} из {{ k }}</span>
  </div>
</template>
