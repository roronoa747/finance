<script setup lang="ts">
import { PhCaretLeft } from '@phosphor-icons/vue'
import { useRouter } from 'vue-router'

/**
 * Шапка экрана `.topbar` (DESIGN.md §5): заголовок Piazzolla 30, подпись `--ink-3`, слева
 * кнопка «Назад» (`back` — адрес или `true` для шага назад), справа — слот `right`.
 */
const props = defineProps<{
  title: string
  sub?: string
  back?: boolean | string
}>()

const emit = defineEmits<{ (e: 'back'): void }>()
const router = useRouter()

function onBack() {
  emit('back')
  if (typeof props.back === 'string') void router.push(props.back)
  else router.back()
}
</script>

<template>
  <header class="flex items-center justify-between gap-3 px-1 pb-1 pt-1.5">
    <div class="flex min-w-0 items-center gap-2.5">
      <button
        v-if="back"
        type="button"
        aria-label="Назад"
        class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
        @click="onBack"
      >
        <PhCaretLeft :size="20" />
      </button>
      <div class="min-w-0">
        <h1 class="type-h1 truncate text-ink">{{ title }}</h1>
        <div v-if="sub" class="mt-0.5 truncate type-meta">{{ sub }}</div>
      </div>
    </div>
    <div v-if="$slots.right" class="flex shrink-0 items-center gap-2.5">
      <slot name="right" />
    </div>
  </header>
</template>
