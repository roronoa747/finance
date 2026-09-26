<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { hintPosition } from './hintPosition'

/**
 * Знак вопроса с пояснением (React `kit.tsx:340-399`). Окно — `position: fixed` под знаком,
 * прижато к краям экрана (`hintPosition`); закрывается нажатием мимо, Escape и прокруткой:
 * закреплённое на экране, при прокрутке оно осталось бы висеть в стороне от своего знака.
 */
withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: 'Пояснение',
  },
)

const at = ref<{ left: number; top: number; width: number } | null>(null)
const boxRef = ref<HTMLElement | null>(null)

function toggle(e: MouseEvent) {
  if (at.value) {
    at.value = null
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  at.value = hintPosition(r, window.innerWidth)
}

function onPointerDown(e: Event) {
  if (!boxRef.value?.contains(e.target as Node)) at.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') at.value = null
}

function hide() {
  at.value = null
}

// Слушатели — только пока окно открыто.
function listen(on: boolean) {
  const doc = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document)
  doc('pointerdown', onPointerDown)
  doc('keydown', onKeydown)
  if (on) window.addEventListener('scroll', hide, true)
  else window.removeEventListener('scroll', hide, true)
}

watch(
  () => !!at.value,
  (open) => listen(open),
)

onUnmounted(() => {
  if (at.value) listen(false)
})
</script>

<template>
  <span ref="boxRef" class="relative inline-flex items-center">
    <button
      type="button"
      :aria-label="label"
      :aria-expanded="!!at"
      :class="[
        'grid size-4.5 place-items-center rounded-full border bg-surface-2 text-[11px] font-semibold hover:bg-surface-3 hover:text-ink cursor-pointer',
        at ? 'border-brand text-brand' : 'border-line text-ink-3',
      ]"
      @click="toggle"
    >
      ?
    </button>
    <span
      v-if="at"
      role="note"
      :style="{ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px` }"
      class="fixed z-50 rounded-xl border border-line bg-surface p-3 text-[12px] font-normal leading-relaxed text-ink-2 shadow-lift"
    >
      <slot />
    </span>
  </span>
</template>
