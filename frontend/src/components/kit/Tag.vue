<script setup lang="ts">
import { cn } from '@/lib/utils'

withDefaults(
  defineProps<{
    tone?: 'neutral' | 'gold' | 'brand'
  }>(),
  {
    tone: 'neutral',
  },
)
</script>

<template>
  <span
    :class="
      cn(
        'whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'gold' && 'bg-gold-soft text-gold',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'neutral' && 'bg-surface-3 text-ink-2',
      )
    "
  >
    <slot />
  </span>
</template>
