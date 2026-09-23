<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string
    sub?: string
    trend?: string
    trendPositive?: boolean
    accent?: string
  }>(),
  {
    sub: undefined,
    trend: undefined,
    trendPositive: undefined,
    accent: undefined,
  },
)
</script>

<template>
  <div
    class="flex flex-col justify-between rounded-2xl border border-line bg-surface p-3.5 shadow-xs text-left"
    :style="accent ? { borderLeftColor: accent, borderLeftWidth: '3px' } : undefined"
  >
    <span class="text-[12px] font-medium text-ink-3 leading-tight">{{ label }}</span>
    <div class="mt-1.5 flex items-baseline justify-between gap-2">
      <span class="font-display text-[20px] font-semibold tracking-[-0.02em] num text-ink">
        {{ value }}
      </span>
      <span
        v-if="trend"
        :class="[
          'text-[11.5px] font-medium num',
          trendPositive === true
            ? 'text-brand'
            : trendPositive === false
              ? 'text-warn'
              : 'text-ink-3',
        ]"
      >
        {{ trend }}
      </span>
    </div>
    <span v-if="sub" class="mt-1 text-[11.5px] text-ink-3 leading-snug">
      {{ sub }}
    </span>
  </div>
</template>
