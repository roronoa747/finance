<script setup lang="ts">
/**
 * Строка списка с мини-фото (макет dreams-week.html `.it`): фото 48 со скруглением 14 (нет фото —
 * плашка `tone`, токен или цвет оттенка цели), название 16/600 в одну строку, под ним слот (полоса
 * цели или «сумма · чьё»), справа слот `end`. `clickable` — вся строка кнопка (цель); иначе действие
 * — в `end` (желание: «Открыть»). `index` — очередь появления (`fx-in`, `--i`).
 */
withDefaults(
  defineProps<{
    title: string
    src?: string | null
    tone?: string | null
    clickable?: boolean
    index?: number
  }>(),
  { src: null, tone: null, clickable: false, index: 0 },
)

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="fx-in flex w-full items-center gap-3 border-t border-line py-[11px] text-left first:border-t-0"
    :class="clickable && 'press cursor-pointer'"
    :style="{ '--i': index }"
    @click="clickable && emit('click', $event)"
  >
    <span class="block size-12 shrink-0 overflow-hidden rounded-[14px] bg-surface-3" :style="!src && tone ? { background: tone } : undefined">
      <img v-if="src" :src="src" alt="" class="size-full object-cover" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-[5px]">
      <span class="truncate text-[16px] font-semibold text-ink">{{ title }}</span>
      <slot />
    </span>
    <slot name="end" />
  </component>
</template>
