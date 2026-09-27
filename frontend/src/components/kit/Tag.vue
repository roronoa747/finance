<script setup lang="ts">
import { cn } from '@/lib/utils'

/** Тег `.tag` (DESIGN.md §5): капсула 12/500, варианты `ok` / `warn` / `neutral` / `brand` / `gold`. */
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'gold' | 'brand' | 'ok' | 'warn'
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
        'inline-flex items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-1 text-[12px] font-medium [&_svg]:size-3.5',
        tone === 'gold' && 'bg-gold-soft text-gold',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'neutral' && 'bg-surface-3 text-ink-2',
      )
    "
  >
    <slot />
  </span>
</template>
