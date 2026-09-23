<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    title: string
    tone?: 'warn' | 'good'
    class?: HTMLAttributes['class']
    className?: string
  }>(),
  {
    tone: 'warn',
  },
)
</script>

<template>
  <div
    :class="
      cn(
        'flex gap-3 rounded-[14px] border p-3 px-3.5 text-left',
        tone === 'good'
          ? 'border-brand bg-brand-soft text-ink-2'
          : 'border-warn-line bg-warn-soft text-ink-2',
        props.class,
        props.className,
      )
    "
  >
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      :class="['mt-px shrink-0', tone === 'good' ? 'text-brand' : 'text-warn']"
    >
      <path v-if="tone === 'good'" d="M5 12l5 5L20 7" />
      <template v-else>
        <path d="M12 8v5M12 17h.01" />
        <circle cx="12" cy="12" r="9" />
      </template>
    </svg>
    <div class="min-w-0">
      <b class="block text-[13px] font-semibold text-ink">{{ title }}</b>
      <span class="text-[12.5px] leading-snug text-ink-2">
        <slot />
      </span>
    </div>
  </div>
</template>
