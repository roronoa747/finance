<script setup lang="ts">
defineProps<{
  label: string
  value: string
}>()
</script>

<template>
  <div>
    <div class="text-[13px] text-ink-2">{{ label }}</div>
    <div class="mb-3.5 font-display text-[38px] font-semibold leading-[1.1] tracking-[-0.03em] num text-ink">
      {{ value }}
    </div>
  </div>
</template>
