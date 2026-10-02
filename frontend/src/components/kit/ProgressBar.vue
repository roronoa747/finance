<script setup lang="ts">
import { computed } from 'vue'
import { useGrow } from '@/lib/motion'

/**
 * Полоса прогресса `.bar` (DESIGN.md §5): дорожка `--track`, заливка бренд / `--ok` /
 * белая поверх фото (`photo`) / `--ink` (`ink` — тонкая полоса строки цели, макет `.tbar`).
 * `value` — доля 0…1, обрезается. При появлении заполняется от нуля (Р-45, `useGrow`).
 */
const props = withDefaults(
  defineProps<{
    value: number
    tone?: 'brand' | 'ok' | 'photo' | 'muted' | 'ink'
    height?: number
  }>(),
  { tone: 'brand', height: 6 },
)

const pct = computed(() => Math.round(Math.min(1, Math.max(0, props.value || 0)) * 100))
const grown = useGrow()
const FILL: Record<string, string> = { ok: 'bg-ok', photo: 'bg-on-photo', muted: 'bg-s12', ink: 'bg-ink', brand: 'bg-brand' }
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
      class="block h-full rounded-[3px] transition-[width] duration-(--motion-fill) ease-(--ease-out)"
      :class="FILL[tone]"
      :style="{ width: `${grown ? pct : 0}%` }"
    />
  </div>
</template>
