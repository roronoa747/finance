<script setup lang="ts">
import type { Component } from 'vue'
import { RouterLink } from 'vue-router'
import { PhPlus } from '@phosphor-icons/vue'

/**
 * Нижняя навигация (DESIGN.md §2, §5): одна капсула с вкладками и круглой кнопкой «+»
 * бренда справа. Активная вкладка — `aria-current="page"`, иконка залита.
 */
export type TabItem = { to: string; label: string; icon: Component; active: boolean }

withDefaults(
  defineProps<{
    items: TabItem[]
    plus?: boolean
    plusLabel?: string
  }>(),
  { plus: true, plusLabel: 'Добавить' },
)

const emit = defineEmits<{ (e: 'plus'): void }>()
</script>

<template>
  <nav class="relative flex items-center gap-1 px-4 pb-6 pt-2.5 select-none" aria-label="Разделы">
    <div class="absolute inset-x-4 top-2.5 h-[58px] rounded-pill border border-card-border bg-surface" aria-hidden="true" />
    <RouterLink
      v-for="t in items"
      :key="t.to"
      :to="t.to"
      class="relative flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors"
      :class="t.active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'"
      :aria-current="t.active ? 'page' : undefined"
    >
      <component :is="t.icon" :size="22" :weight="t.active ? 'fill' : 'regular'" />
      <span class="truncate">{{ t.label }}</span>
    </RouterLink>
    <button
      v-if="plus"
      type="button"
      :aria-label="plusLabel"
      class="relative mx-1.5 grid size-[46px] shrink-0 place-items-center rounded-full bg-brand text-brand-ink transition-transform active:scale-95 cursor-pointer"
      @click="emit('plus')"
    >
      <PhPlus :size="22" weight="bold" />
    </button>
  </nav>
</template>
