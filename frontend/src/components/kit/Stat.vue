<script setup lang="ts">
import { type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

/** Малая цифра с подписью — внутренняя карточка (радиус `--r-inner`); деньги — Golos Text 600. */
defineProps<{
  label: string
  value: string
  color?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div :class="cn('rounded-inner border border-card-border bg-surface px-3.5 py-3', $props.class)">
    <div class="text-[12px] text-ink-3">{{ label }}</div>
    <div class="mt-0.5 text-[19px] font-semibold tracking-[-0.01em] num" :style="{ color }">
      {{ value }}
    </div>
  </div>
</template>
