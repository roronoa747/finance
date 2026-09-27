<script setup lang="ts">
import { computed } from 'vue'

/**
 * Полоса прогресса `.bar` (DESIGN.md §5): дорожка `--track`, заливка бренд / `--ok` /
 * белая поверх фото (`photo`). `value` — доля 0…1, обрезается.
 */
const props = withDefaults(
  defineProps<{
    value: number
    tone?: 'brand' | 'ok' | 'photo' | 'muted'
    height?: number
  }>(),
  { tone: 'brand', height: 6 },
)

const pct = computed(() => Math.round(Math.min(1, Math.max(0, props.value || 0)) * 100))
</script>

<template>
  <div
    role="progressbar"
    :aria-valuenow="pct"
    aria-valuemin="0"
    aria-valuemax="100"
    class="w-full overflow-hidden rounded-[3px]"
    :class="tone === 'photo' ? 'bg-on-photo/30' : 'bg-track'"
    :style="{ height: `${height}px` }"
  >
    <i
      class="block h-full rounded-[3px]"
      :class="tone === 'ok' ? 'bg-ok' : tone === 'photo' ? 'bg-on-photo' : tone === 'muted' ? 'bg-s12' : 'bg-brand'"
      :style="{ width: `${pct}%` }"
    />
  </div>
</template>
