<script setup lang="ts">
import { ref } from 'vue'
import { cn } from '@/lib/utils'

/**
 * Строка списка. Кликабельная — кнопка с откликом, шевроном и защитой от свайпа.
 * Действие (`action`, например «Оплатил») стоит рядом, вне кнопки строки: кнопка в
 * кнопке недопустима. Слот по умолчанию — под строкой («Другая сумма или счёт»).
 */
defineProps<{
  title: string
  note?: string
  value?: string | number
  sub?: string
  accent?: string
  clickable?: boolean
  /** Без боковых отступов — строка внутри карточки со своими отступами. */
  dense?: boolean
  /** Приглушённое название — платёж уже оплачен. */
  muted?: boolean
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
  <div class="border-b border-line last:border-b-0">
    <div class="flex w-full items-center">
      <component
        :is="clickable ? 'button' : 'div'"
        :type="clickable ? 'button' : undefined"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-3 text-left transition-colors',
            dense ? 'py-2.5' : 'px-4 py-3',
            clickable && 'hover:bg-surface-2 active:bg-surface-3 cursor-pointer',
          )
        "
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
          <span :class="cn('block truncate text-[14.5px] font-medium', muted ? 'text-ink-2' : 'text-ink')">
            {{ title }}
          </span>
          <slot name="note">
            <span v-if="note" class="block text-[12.5px] text-ink-3">{{ note }}</span>
          </slot>
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

      <div v-if="$slots.action" :class="cn('shrink-0', dense ? 'pl-3' : 'pr-4')">
        <slot name="action" />
      </div>
    </div>

    <slot />
  </div>
</template>
