<script setup lang="ts">
import { useFieldInvalid } from '@/components/kit/useFormCheck'
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    defaultValue?: string | number
    modelValue?: string | number
    class?: HTMLAttributes['class']
    className?: string
    type?: string
    placeholder?: string
    disabled?: boolean
    autocomplete?: string
    autocapitalize?: string
    inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'
  }>(),
  {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
  },
)

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string): void
  (e: 'keydown', event: KeyboardEvent): void
  (e: 'blur', event: FocusEvent): void
}>()

// Поле внутри `kit/Field` с ошибкой — неверное (рамка `--destructive`, строка под полем).
const invalid = useFieldInvalid()
</script>

<template>
  <input
    :type="type"
    :value="modelValue !== undefined ? modelValue : defaultValue"
    :placeholder="placeholder"
    :disabled="disabled"
    v-bind="invalid"
    :autocomplete="autocomplete"
    :autocapitalize="autocapitalize"
    :inputmode="inputmode"
    data-slot="input"
    :class="
      cn(
        // Поле (DESIGN.md §5): `--surface-2`, радиус `--r-inner`, рамка появляется в фокусе; 16 px — iOS не приближает.
        'flex h-12 w-full min-w-0 rounded-inner border border-transparent bg-surface-2 px-3.5 py-1 text-[16px] text-ink transition-[color,background-color,border-color] outline-none selection:bg-brand selection:text-brand-ink placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-brand focus-visible:bg-surface aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
        props.class,
        props.className,
      )
    "
    @input="emits('update:modelValue', ($event.target as HTMLInputElement).value)"
    @keydown="(e) => emits('keydown', e)"
    @blur="(e) => emits('blur', e)"
  />
</template>
