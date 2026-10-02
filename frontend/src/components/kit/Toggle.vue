<script setup lang="ts">
/**
 * Переключатель «вкл/выкл» (DESIGN.md §5): `role="switch"`, дорожка `--track`, включён — бренд.
 * `tone="ok"` — включён зелёным (`--ok`, макет разбора `.tg`): на экране с брендовой главной кнопкой
 * бренд остаётся у неё одной (правило 12).
 */
withDefaults(
  defineProps<{
    modelValue: boolean
    label: string
    disabled?: boolean
    tone?: 'brand' | 'ok'
  }>(),
  { tone: 'brand' },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    class="relative h-[26px] w-11 shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50"
    :class="modelValue ? (tone === 'ok' ? 'bg-ok' : 'bg-brand') : 'bg-track'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-[3px] size-5 rounded-full bg-surface transition-[left]"
      :class="modelValue ? 'left-[21px]' : 'left-[3px]'"
      aria-hidden="true"
    />
  </button>
</template>
