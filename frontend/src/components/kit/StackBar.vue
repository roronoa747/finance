<script setup lang="ts">
/**
 * Стопка разделов `.stack` (DESIGN.md §5): высота 10, зазор 2, радиус 2. `share` — доля
 * 0…1, `color` — токен (`var(--s3)`, `spendColor`), не литерал.
 */
defineProps<{
  segments: { key: string; share: number; color: string }[]
}>()
</script>

<template>
  <div class="flex h-[10px] w-full gap-[2px]" aria-hidden="true">
    <i
      v-for="s in segments"
      :key="s.key"
      class="block h-full rounded-[2px]"
      :style="{ width: `${Math.max(0, Math.min(1, s.share)) * 100}%`, background: s.color }"
    />
  </div>
</template>
