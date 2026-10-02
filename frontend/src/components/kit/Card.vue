<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

/**
 * Карточка (DESIGN.md §5): радиус 24, рамка `--card-border` (в тёмной теме — прозрачная,
 * тон вместо линии), без тени. Отступ 20; `tight` — 16 (списки внутри); `flush` — без
 * отступов (таблицы, строки со своими полями).
 */
const props = withDefaults(
  defineProps<{
    flush?: boolean
    tight?: boolean
    class?: HTMLAttributes['class']
    className?: string
  }>(),
  {
    flush: false,
    tight: false,
  },
)
</script>

<template>
  <div
    :class="
      cn(
        'fx-in rounded-card border border-card-border bg-surface',
        flush ? 'overflow-hidden p-0' : tight ? 'p-4' : 'p-5',
        props.class,
        props.className,
      )
    "
  >
    <slot />
  </div>
</template>
