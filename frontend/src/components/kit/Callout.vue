<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { PhBell, PhCheck, PhInfo, PhLock, PhWarningCircle } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'

/**
 * Заметка `.note` (DESIGN.md §5): мягкий фон без рамки, иконка 18 px. Тон — `neutral`
 * (пояснение), `brand` (подсказка приложения), `ok` (готово, запомнили), `warn`
 * (внимание). `good` — прежнее имя `ok`, экраны до Блока 3 его ещё зовут. Заголовок
 * не обязателен: одна фраза — обычный вид заметки.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    tone?: 'warn' | 'good' | 'ok' | 'brand' | 'neutral'
    /** Иконка: по умолчанию — по тону. */
    icon?: 'info' | 'check' | 'bell' | 'lock' | 'warn' | 'none'
    class?: HTMLAttributes['class']
    className?: string
  }>(),
  {
    tone: 'warn',
    icon: undefined,
  },
)

const TONES = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  good: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
} as const

const ICONS = { info: PhInfo, check: PhCheck, bell: PhBell, lock: PhLock, warn: PhWarningCircle } as const

const icon = computed(() => {
  const key = props.icon ?? (props.tone === 'ok' || props.tone === 'good' ? 'check' : props.tone === 'warn' ? 'warn' : 'info')
  return key === 'none' ? null : ICONS[key]
})
</script>

<template>
  <div :class="cn('flex items-start gap-2.5 rounded-inner px-3.5 py-3 text-left text-[14px] leading-snug', TONES[tone], props.class, props.className)">
    <component :is="icon" v-if="icon" :size="18" class="mt-px shrink-0" aria-hidden="true" />
    <div class="min-w-0">
      <b v-if="title" class="block text-[14px] font-semibold text-ink">{{ title }}</b>
      <span :class="title ? 'text-[13px] text-ink-2' : ''">
        <slot />
      </span>
    </div>
  </div>
</template>
