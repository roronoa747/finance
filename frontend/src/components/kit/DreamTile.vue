<script setup lang="ts">
import { PhPlus } from '@phosphor-icons/vue'

/**
 * Плитка мечты (DESIGN.md §5): три в ряд, высота 150, радиус 20; фото или `plain`
 * (`--surface-3`), процент Piazzolla 26 и имя с многоточием. Вариант `add` — «Новая мечта».
 */
withDefaults(
  defineProps<{
    name?: string
    percent?: number
    src?: string | null
    add?: boolean
  }>(),
  { name: '', src: null, add: false },
)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <button
    type="button"
    class="relative isolate flex h-[150px] min-w-0 flex-1 flex-col overflow-hidden rounded-tile p-3 text-left transition-transform active:scale-[0.98] cursor-pointer"
    :class="
      add
        ? 'items-center justify-center gap-1.5 border border-dashed border-line-strong bg-surface text-center text-ink-2'
        : src
          ? 'justify-end text-on-photo'
          : 'justify-end bg-surface-3 text-ink'
    "
    :aria-label="add ? 'Новая мечта' : undefined"
    @click="emit('click')"
  >
    <template v-if="add">
      <PhPlus :size="20" />
      <span class="text-[13px]">Новая мечта</span>
    </template>
    <template v-else>
      <img v-if="src" :src="src" alt="" class="absolute inset-0 -z-20 size-full object-cover" />
      <div v-if="src" class="absolute inset-x-0 bottom-0 top-[40%] -z-10 photo-scrim" aria-hidden="true" />
      <div v-if="percent !== undefined" class="font-display text-[26px] font-medium leading-none num">{{ Math.round(percent) }}&nbsp;%</div>
      <div class="mt-0.5 w-full truncate text-[12px]" :class="src ? 'opacity-90' : 'text-ink-2'">{{ name }}</div>
    </template>
  </button>
</template>
