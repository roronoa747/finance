<script setup lang="ts">
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
</script>

<template>
  <input
    ref="inputRef"
    type="text"
    :value="modelValue"
    :inputmode="kind === 'rate' ? 'decimal' : 'numeric'"
    :placeholder="placeholder"
    :disabled="disabled"
    data-slot="input"
    :class="
      cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 text-ink num',
        props.class,
        props.className,
      )
    "
    @input="onInput"
    @blur="emit('blur')"
  />
</template>
