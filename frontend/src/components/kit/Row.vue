<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  title: string
  note?: string
  value?: string | number
  sub?: string
  accent?: string
  clickable?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', ev: MouseEvent): void
}>()

const from = ref<{ x: number; y: number } | null>(null)
const dragged = ref(false)

function onPointerDown(e: PointerEvent) {
  from.value = { x: e.clientX, y: e.clientY }
  dragged.value = false
}

function onPointerMove(e: PointerEvent) {
  if (from.value && Math.hypot(e.clientX - from.value.x, e.clientY - from.value.y) > 8) {
    dragged.value = true
  }
}

function handleClick(e: MouseEvent) {
  if (!dragged.value) {
    emit('click', e)
  }
}
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 transition-colors"
    :class="clickable ? 'hover:bg-surface-2 active:bg-surface-3 cursor-pointer' : ''"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @click="handleClick"
  >
    <div
      v-if="$slots.icon"
      class="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-surface-3"
      :style="accent ? { color: accent, background: 'transparent', border: '1px solid var(--line)' } : undefined"
    >
      <slot name="icon" />
    </div>

    <span class="min-w-0 flex-1">
      <span class="block truncate text-[14.5px] font-medium text-ink">{{ title }}</span>
      <span v-if="note" class="block text-[12.5px] text-ink-3">{{ note }}</span>
    </span>

    <span v-if="value !== undefined || sub || $slots.value" class="shrink-0 text-right">
      <slot name="value">
        <span v-if="value !== undefined" class="block text-[14.5px] font-semibold num text-ink">{{ value }}</span>
      </slot>
      <span v-if="sub" class="block text-[12px] text-ink-3">{{ sub }}</span>
    </span>

    <svg
      v-if="clickable"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="ml-0.5 shrink-0 text-ink-3"
    >
      <path d="M1 1l5.5 6L1 13" />
    </svg>
  </component>
</template>
