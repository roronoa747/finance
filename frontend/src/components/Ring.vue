<script setup lang="ts">
import { computed } from 'vue'
import { hueColor, type HueKey } from '@/lib/palette'

const props = withDefaults(
  defineProps<{
    progress: number
    plan?: number
    size?: number
    hue: HueKey
    dark?: boolean
  }>(),
  {
    plan: 0,
    size: 44,
    dark: false,
  },
)

const R = 34
const C = 2 * Math.PI * R

const strokeColor = computed(() => hueColor(props.hue, props.dark))
const filled = computed(() => (Math.min(props.progress, 1) * C).toFixed(1))
const over = computed(() =>
  props.progress > 1 ? (Math.min(props.progress - 1, 0.25) * C).toFixed(1) : 0,
)
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 80 80" class="block shrink-0">
    <circle cx="40" cy="40" :r="R" stroke-width="7" fill="none" stroke="var(--track)" />
    <circle
      cx="40"
      cy="40"
      :r="R"
      stroke-width="7"
      fill="none"
      stroke-linecap="round"
      :stroke="strokeColor"
      :stroke-dasharray="`${filled} ${C.toFixed(1)}`"
      transform="rotate(-90 40 40)"
      style="transition: stroke-dasharray 0.5s ease"
    />
    <circle
      v-if="Number(over) > 0"
      cx="40"
      cy="40"
      :r="R"
      stroke-width="3"
      fill="none"
      stroke-linecap="round"
      stroke="var(--gold)"
      :stroke-dasharray="`${over} ${C.toFixed(1)}`"
      transform="rotate(-90 40 40)"
    />
    <circle
      v-if="plan > 0"
      cx="40"
      cy="40"
      :r="R"
      stroke-width="7"
      fill="none"
      stroke="var(--ink-3)"
      :stroke-dasharray="`1.6 ${(C - 1.6).toFixed(1)}`"
      :stroke-dashoffset="-plan * C"
      transform="rotate(-90 40 40)"
    />
  </svg>
</template>
