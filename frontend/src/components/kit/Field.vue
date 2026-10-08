<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { injectForm, provideFieldError } from './useFormCheck'

/**
 * Подпись над полем. Поле ввода — внутри `<label>`: тап по подписи ставит в него
 * курсор. Группа кнопок (`group`) — не в `<label>`: иначе подпись становится именем
 * первой кнопки, и тап по ней эту кнопку нажимает.
 *
 * Ошибка (Р-114): `name` — имя поля в правилах `useFormCheck` формы, `error` — своя строка.
 * Под полем одна строка «что не так», поле ввода внутри получает `aria-invalid`.
 */
const props = defineProps<{
  label?: string
  group?: boolean
  name?: string
  error?: string
}>()

const form = injectForm()
const id = useId()
const root = ref<HTMLElement | null>(null)
const error = computed(() => props.error || (props.name ? form?.errorOf(props.name) : undefined))
provideFieldError(computed(() => ({ error: error.value, id })))

watch(root, (el) => {
  if (form && props.name) form.register(props.name, el)
})
onBeforeUnmount(() => {
  if (form && props.name) form.register(props.name, null)
})
</script>

<template>
  <div v-if="group" ref="root" role="group" :aria-label="label" :aria-describedby="error ? id : undefined" class="mb-3.5 flex flex-col gap-1.5 text-left">
    <span v-if="label" class="text-[12.5px] font-medium text-ink-3">{{ label }}</span>
    <slot />
    <span v-if="error" :id="id" role="alert" class="text-[12.5px] font-medium text-destructive">{{ error }}</span>
  </div>
  <label v-else ref="root" class="mb-3.5 flex flex-col gap-1.5 text-left">
    <span v-if="label" class="text-[12.5px] font-medium text-ink-3">{{ label }}</span>
    <slot />
    <span v-if="error" :id="id" role="alert" class="text-[12.5px] font-medium text-destructive">{{ error }}</span>
  </label>
</template>
