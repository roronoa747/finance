<script setup lang="ts">
import { computed } from 'vue'
import { money } from '@/lib/money'

export interface Seg {
  key: string
  value: number
  color: string
  label?: string
}

const props = withDefaults(
  defineProps<{
    segments: Seg[]
    thick?: boolean
  }>(),
  {
    thick: false,
  },
)

const total = computed(() => {
  return props.segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1
})
</script>

<template>
  <div
    :class="[
      'flex overflow-hidden rounded-md bg-track',
      thick ? 'h-4 rounded-lg' : 'h-3',
    ]"
    role="img"
    :aria-label="segments.map((s) => `${s.label ?? s.key}: ${money(s.value)}`).join(', ')"
  >
    <span
      v-for="(s, i) in segments"
      :key="s.key"
      class="block h-full transition-all duration-300"
      :style="{
        width: `${(Math.max(0, s.value) / total) * 100}%`,
        background: s.color,
        boxShadow: i > 0 ? 'inset 2px 0 0 var(--surface)' : undefined,
      }"
    />
  </div>
</template>
