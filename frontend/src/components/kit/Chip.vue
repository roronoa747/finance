<script setup lang="ts">
import { cn } from '@/lib/utils'

/**
 * Чип (DESIGN.md §5): капсула `--surface-3`; `on` — выбран (`--brand-soft`, `aria-pressed`);
 * `quiet` — контурный («Ещё N ▾», «Кому → что»); `sw` — цветная точка раздела (токен).
 */
withDefaults(
  defineProps<{
    on?: boolean
    quiet?: boolean
    sw?: string | null
    disabled?: boolean
  }>(),
  { on: false, quiet: false, sw: null, disabled: false },
)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <button
    type="button"
    :aria-pressed="on"
    :disabled="disabled"
    :class="
      cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-[9px] text-[14px] font-medium transition-colors cursor-pointer disabled:opacity-50 [&_svg]:size-[15px]',
        on
          ? 'border-brand bg-brand-soft text-brand'
          : quiet
            ? 'border-line-strong bg-transparent text-ink-2 hover:text-ink'
            : 'border-transparent bg-surface-3 text-ink hover:bg-surface-2',
      )
    "
    @click="emit('click')"
  >
    <i v-if="sw" class="size-2 shrink-0 rounded-full" :style="{ background: sw }" aria-hidden="true" />
    <slot />
  </button>
</template>
