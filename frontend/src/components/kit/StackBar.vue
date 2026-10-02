<script setup lang="ts">
import { useGrow } from '@/lib/motion'

/**
 * Стопка разделов `.stack` (DESIGN.md §5): высота 10, зазор 2, радиус 2. `share` — доля
 * 0…1, `color` — токен (`var(--s3)`, `spendColor`), не литерал. При появлении доли растут
 * от нуля (Р-45, `useGrow`).
 */
defineProps<{
  segments: { key: string; share: number; color: string }[]
}>()

const grown = useGrow()
</script>

<template>
  <div class="flex h-[10px] w-full gap-[2px]" aria-hidden="true">
    <i
      v-for="s in segments"
      :key="s.key"
      class="block h-full rounded-[2px] transition-[width] duration-(--motion-fill) ease-(--ease-out)"
      :style="{ width: `${grown ? Math.max(0, Math.min(1, s.share)) * 100 : 0}%`, background: s.color }"
    />
  </div>
</template>
