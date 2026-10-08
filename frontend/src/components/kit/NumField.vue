<script setup lang="ts">
import { useFieldInvalid } from '@/components/kit/useFormCheck'
import { ref, nextTick, type HTMLAttributes } from 'vue'
import { clean, caretAt, sigBefore, type NumKind } from '@/lib/num'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    modelValue: string
    kind?: NumKind
    placeholder?: string
    disabled?: boolean
    class?: HTMLAttributes['class']
    className?: string
  }>(),
  {
    kind: 'money',
    placeholder: '',
    disabled: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'blur'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function onInput(e: Event) {
  const el = e.target as HTMLInputElement
  const raw = el.value
  const cursor = el.selectionStart ?? raw.length
  const upto = raw.slice(0, cursor)
  const sig = sigBefore(upto)

  const next = clean(raw, props.kind, props.modelValue)
  const nextCaret = caretAt(next, sig)

  // Набрали букву — модель та же, и Vue поле не перерисует: мусор убираем сами.
  if (el.value !== next) el.value = next
  emit('update:modelValue', next)

  void nextTick(() => {
    if (inputRef.value && document.activeElement === inputRef.value) {
      inputRef.value.setSelectionRange(nextCaret, nextCaret)
    }
  })
}

// Поле внутри `kit/Field` с ошибкой — неверное (рамка `--destructive`, строка под полем).
const invalid = useFieldInvalid()
</script>

<template>
  <input
    ref="inputRef"
    type="text"
    :value="modelValue"
    :inputmode="kind === 'rate' ? 'decimal' : 'numeric'"
    :placeholder="placeholder"
    :disabled="disabled"
    v-bind="invalid"
    data-slot="input"
    :class="
      cn(
        'flex h-12 w-full min-w-0 rounded-inner border border-transparent bg-surface-2 px-3.5 py-1 text-[16px] text-ink transition-[color,background-color,border-color] outline-none selection:bg-brand selection:text-brand-ink placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-brand focus-visible:bg-surface aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive num',
        props.class,
        props.className,
      )
    "
    @input="onInput"
    @blur="emit('blur')"
  />
</template>
