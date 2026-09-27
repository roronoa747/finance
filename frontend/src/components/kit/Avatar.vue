<script setup lang="ts">
import type { PersonId } from '@/types/finance'

/** Аватар участника (DESIGN.md §5): первая буква имени на цвете `--pa`/`--pb`; 30 в шапке, 34 в списках. */
withDefaults(
  defineProps<{
    id: PersonId
    name: string
    size?: 30 | 34
  }>(),
  { size: 30 },
)

const color = (id: PersonId) => (id === 'c' ? 'var(--ink-3)' : `var(--p${id})`)
</script>

<template>
  <span
    class="grid shrink-0 place-items-center rounded-full border-2 border-canvas text-[12px] font-semibold text-dot-ink"
    :class="size === 34 ? 'size-[34px]' : 'size-[30px]'"
    :style="{ background: color(id) }"
    :title="name"
  >
    {{ name.slice(0, 1) }}
  </span>
</template>
