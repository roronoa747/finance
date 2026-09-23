<script setup lang="ts">
defineProps<{
  label: string
}>()
</script>

<template>
  <label class="mb-3.5 flex flex-col gap-1.5 text-left">
    <span class="text-[12.5px] font-medium text-ink-3">{{ label }}</span>
    <slot />
  </label>
</template>
