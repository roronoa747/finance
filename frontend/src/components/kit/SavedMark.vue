<script setup lang="ts">
import { cn } from '@/lib/utils'

defineProps<{
  on: boolean
}>()
</script>

<template>
  <span
    aria-live="polite"
    :class="
      cn(
        'text-[12px] font-normal text-brand transition-opacity duration-200',
        on ? 'opacity-100' : 'opacity-0',
      )
    "
  >
    Сохранено
  </span>
</template>
