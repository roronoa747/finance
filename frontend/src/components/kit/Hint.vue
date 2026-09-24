<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: 'Пояснение',
  },
)

const open = ref(false)
const boxRef = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
}

function onClickOutside(e: MouseEvent) {
  if (boxRef.value && !boxRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false
  }
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onClickOutside)
    document.addEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', onClickOutside)
    document.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <span ref="boxRef" class="relative inline-flex items-center">
    <button
      type="button"
      :aria-label="label"
      class="grid size-4.5 place-items-center rounded-full border border-line bg-surface-2 text-[11px] font-semibold text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
      @click="toggle"
    >
      ?
    </button>
    <div
      v-if="open"
      class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-64 max-w-[85vw] rounded-xl border border-line bg-surface p-3 text-[12px] leading-relaxed text-ink-2 shadow-xl"
    >
      <slot />
    </div>
  </span>
</template>
