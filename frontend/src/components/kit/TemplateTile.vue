<script setup lang="ts">
import { computed } from 'vue'
import { PhCamera, PhLink } from '@phosphor-icons/vue'

/**
 * Плитка шаблона цели (DESIGN.md §5): типы с фото, «Своё фото» (`camera`) и «По ссылке» (`link`, PN-08) —
 * пунктирные плитки со значком; выбранная — обводка `--brand` 3 px внутрь. Фото шаблона — `templateImageUrl`
 * (B2C-17), не встроено.
 */
const props = withDefaults(
  defineProps<{
    name: string
    src?: string | null
    selected?: boolean
    camera?: boolean
    link?: boolean
  }>(),
  { src: null, selected: false, camera: false, link: false },
)
const dashed = computed(() => props.camera || props.link)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <button
    type="button"
    :aria-pressed="selected"
    class="relative isolate flex h-[150px] min-w-0 flex-1 flex-col overflow-hidden rounded-tile p-3 text-left press cursor-pointer"
    :class="[
      dashed
        ? 'items-center justify-center gap-1.5 border border-dashed border-line-strong bg-surface text-center text-ink-2'
        : src
          ? 'justify-end text-on-photo'
          : 'justify-end bg-surface-3 text-ink',
      selected && 'outline-3 -outline-offset-3 outline-brand',
    ]"
    @click="emit('click')"
  >
    <template v-if="dashed">
      <PhLink v-if="link" :size="22" />
      <PhCamera v-else :size="22" />
      <span class="text-[13px]">{{ name }}</span>
    </template>
    <template v-else>
      <img v-if="src" :src="src" alt="" class="absolute inset-0 -z-20 size-full object-cover" loading="lazy" />
      <div v-if="src" class="absolute inset-x-0 bottom-0 top-[40%] -z-10 photo-scrim" aria-hidden="true" />
      <div class="w-full truncate text-[13px] font-medium" :class="src ? '' : 'text-ink'">{{ name }}</div>
    </template>
  </button>
</template>
