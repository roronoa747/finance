<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    tone?: 'warn' | 'good'
  }>(),
  {
    tone: 'warn',
  },
)
</script>

<template>
  <div
    :class="[
      'flex gap-3 rounded-2xl border p-3.5 text-left',
      tone === 'good'
        ? 'border-brand bg-brand-soft text-ink-2'
        : 'border-warn-line bg-warn-soft text-ink-2',
    ]"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      :class="['mt-0.5 shrink-0', tone === 'good' ? 'text-brand' : 'text-warn']"
    >
      <path v-if="tone === 'good'" d="M5 12l5 5L20 7" />
      <template v-else>
        <path d="M12 8v5M12 17h.01" />
        <circle cx="12" cy="12" r="9" />
      </template>
    </svg>
    <div class="min-w-0">
      <b class="block text-[13px] font-semibold text-ink">{{ title }}</b>
      <span class="text-[12.5px] leading-relaxed text-ink-2">
        <slot />
      </span>
    </div>
  </div>
</template>
