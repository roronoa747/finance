<script setup lang="ts">
import { computed } from 'vue'
import { money } from '@/lib/money'

export interface Segment {
  key: string
  value: number
  color: string
  label?: string
}

const props = withDefaults(
  defineProps<{
    segments: Segment[]
    thick?: boolean
    showLegend?: boolean
  }>(),
  {
    thick: false,
    showLegend: false,
  },
)

const total = computed(() => {
  return props.segments.reduce((acc, s) => acc + Math.max(0, s.value), 0) || 1
})
</script>

<template>
  <div class="flex flex-col gap-2.5 w-full text-left">
    <!-- Visual Segmented Bar -->
    <div
      role="img"
      :class="[
        'flex overflow-hidden bg-track transition-all',
        thick ? 'h-4 rounded-xl' : 'h-2.5 rounded-lg',
      ]"
      :aria-label="segments.map((s) => `${s.label || s.key}: ${money(s.value)}`).join(', ')"
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

    <!-- Optional Legend -->
    <div v-if="showLegend" class="mt-1 flex flex-col gap-2">
      <div
        v-for="s in segments"
        :key="s.key"
        class="flex items-center gap-2 text-[13px]"
      >
        <i class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: s.color }" />
        <span class="text-ink-2">{{ s.label || s.key }}</span>
        <span class="ml-auto font-medium num text-ink">{{ money(s.value) }}</span>
      </div>
    </div>
  </div>
</template>
