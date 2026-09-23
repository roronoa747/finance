<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    flush?: boolean
    class?: HTMLAttributes['class']
    className?: string
  }>(),
  {
    flush: false,
  },
)
</script>

<template>
  <div
    :class="
      cn(
        'rounded-[18px] border border-line bg-surface',
        flush ? 'overflow-hidden p-0' : 'p-4',
        props.class,
        props.className,
      )
    "
  >
    <slot />
  </div>
</template>
