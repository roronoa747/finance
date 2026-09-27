<script setup lang="ts">
import { cn } from '@/lib/utils'

/** Иконка-бокс 38×38 на `--surface-2` (DESIGN.md §4): в строках списков и шапке. */
withDefaults(defineProps<{ tone?: 'neutral' | 'destructive' | 'brand'; class?: string }>(), { tone: 'neutral' })
</script>

<template>
  <span
    :class="
      cn(
        'grid size-[38px] shrink-0 place-items-center rounded-[12px] [&_svg]:size-5',
        tone === 'destructive' && 'bg-destructive-soft text-destructive',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'neutral' && 'bg-surface-2 text-ink-2',
        $props.class,
      )
    "
  >
    <slot />
  </span>
</template>
