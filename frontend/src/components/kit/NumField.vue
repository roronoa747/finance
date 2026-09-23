<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { clean, caretAt, sigBefore, type NumKind } from '@/lib/num'

const props = withDefaults(
  defineProps<{
    modelValue: string
    kind?: NumKind
    placeholder?: string
    disabled?: boolean
    className?: string
  }>(),
  {
    kind: 'money',
    placeholder: '',
    disabled: false,
    className: '',
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
    :class="[
      'h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-2 text-[15px] text-ink outline-none transition-all placeholder:text-ink-3 disabled:pointer-events-none disabled:opacity-50 focus:border-brand focus:ring-1 focus:ring-brand shadow-xs num',
      className,
    ]"
    @input="onInput"
    @blur="emit('blur')"
  />
</template>
