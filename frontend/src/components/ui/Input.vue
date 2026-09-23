<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string | number
    type?: string
    placeholder?: string
    disabled?: boolean
    autocomplete?: string
    autocapitalize?: string
    inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'
    className?: string
  }>(),
  {
    modelValue: '',
    type: 'text',
    placeholder: '',
    disabled: false,
    autocomplete: 'off',
    autocapitalize: 'off',
    inputmode: 'text',
    className: '',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'keydown', event: KeyboardEvent): void
  (e: 'blur', event: FocusEvent): void
}>()
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :autocomplete="autocomplete"
    :autocapitalize="autocapitalize"
    :inputmode="inputmode"
    :class="[
      'h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-2 text-[14.5px] text-ink outline-none transition-all placeholder:text-ink-3 disabled:pointer-events-none disabled:opacity-50 focus:border-brand focus:ring-1 focus:ring-brand shadow-xs',
      className,
    ]"
    @input="(e) => emit('update:modelValue', (e.target as HTMLInputElement).value)"
    @keydown="(e) => emit('keydown', e)"
    @blur="(e) => emit('blur', e)"
  />
</template>
