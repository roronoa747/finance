<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Primitive, type PrimitiveProps } from 'radix-vue'
import { cn } from '@/lib/utils'
import { type ButtonVariants, buttonVariants } from './button'

interface Props {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  as?: PrimitiveProps['as']
  asChild?: boolean
  class?: HTMLAttributes['class']
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  asChild: false,
  type: 'button',
  variant: 'default',
  size: 'default',
})

const emit = defineEmits<{
  (e: 'click', event: MouseEvent): void
}>()
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :type="as === 'button' ? type : undefined"
    :disabled="disabled"
    :class="cn(buttonVariants({ variant, size }), props.class, props.className)"
    @click="(ev: MouseEvent) => emit('click', ev)"
  >
    <slot />
  </Primitive>
</template>
