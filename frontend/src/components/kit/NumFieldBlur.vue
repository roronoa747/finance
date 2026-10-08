<script setup lang="ts">
import { ref, watch, type HTMLAttributes } from 'vue'
import { clean, moneyKind, numChanged, type NumKind } from '@/lib/num'
import type { Currency } from '@/types/finance'
import NumField from './NumField.vue'

const props = withDefaults(
  defineProps<{
    initial: string | number
    kind?: NumKind
    /** Валюта суммы (ML-09): не тенге — запятая и округление, см. `NumField`. */
    currency?: Currency | null
    ariaLabel?: string
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
  (e: 'commit', val: string): void
}>()

const kindOf = () => (props.currency !== undefined ? moneyKind(props.currency) : props.kind)
const text = ref(clean(String(props.initial ?? ''), kindOf()))

watch(
  () => props.initial,
  (next) => {
    text.value = clean(String(next ?? ''), kindOf())
  },
)

// Нет изменения — нет записи: коммит того же значения со свежим временем
// затирал правку с другого устройства.
function onBlur() {
  if (numChanged(text.value, props.initial, kindOf())) emit('commit', text.value)
}

// Enter только уводит фокус, коммит — в onBlur: иначе одно действие давало два.
function onEnter(e: Event) {
  ;(e.target as HTMLInputElement)?.blur()
}
</script>

<template>
  <NumField
    v-model="text"
    :kind="kind"
    :currency="currency"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :class="props.class"
    :class-name="props.className"
    @blur="onBlur"
    @keydown.enter="onEnter"
  />
</template>
