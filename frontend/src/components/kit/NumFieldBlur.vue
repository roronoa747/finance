<script setup lang="ts">
import { ref, watch, type HTMLAttributes } from 'vue'
import { clean, type NumKind } from '@/lib/num'
import NumField from './NumField.vue'

const props = withDefaults(
  defineProps<{
    initial: string | number
    kind?: NumKind
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

const text = ref(clean(String(props.initial ?? ''), props.kind))

watch(
  () => props.initial,
  (next) => {
    text.value = clean(String(next ?? ''), props.kind)
  },
)

function onBlur() {
  emit('commit', text.value)
}

function onEnter(e: Event) {
  emit('commit', text.value)
  ;(e.target as HTMLInputElement)?.blur()
}
</script>

<template>
  <NumField
    v-model="text"
    :kind="kind"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :class="props.class"
    :class-name="props.className"
    @blur="onBlur"
    @keydown.enter="onEnter"
  />
</template>
