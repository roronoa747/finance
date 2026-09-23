<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
    size?: 'sm' | 'default' | 'lg' | 'icon'
    disabled?: boolean
    type?: 'button' | 'submit' | 'reset'
    className?: string
  }>(),
  {
    variant: 'default',
    size: 'default',
    disabled: false,
    type: 'button',
    className: '',
  },
)

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()

const baseClasses =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium transition-all outline-none cursor-pointer disabled:pointer-events-none disabled:opacity-50 select-none'

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'secondary':
      return 'bg-surface-3 text-ink hover:bg-surface-2 active:translate-y-px'
    case 'outline':
      return 'border border-line bg-surface text-ink hover:bg-surface-2 active:translate-y-px'
    case 'ghost':
      return 'text-ink-2 hover:bg-surface-3 hover:text-ink active:translate-y-px'
    case 'destructive':
      return 'bg-destructive text-destructive-foreground hover:opacity-90 active:translate-y-px'
    case 'default':
    default:
      return 'bg-brand text-brand-ink hover:opacity-90 active:translate-y-px shadow-xs'
  }
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'h-8 px-3 text-[13px] rounded-lg'
    case 'lg':
      return 'h-11 px-6 text-[15px]'
    case 'icon':
      return 'size-9 p-0'
    case 'default':
    default:
      return 'h-10 px-4 py-2 text-[14px]'
  }
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="[baseClasses, variantClasses, sizeClasses, className]"
    @click="(ev) => emit('click', ev)"
  >
    <slot />
  </button>
</template>
