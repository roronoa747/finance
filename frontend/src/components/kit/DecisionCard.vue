<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import ProgressBar from './ProgressBar.vue'

/**
 * Карточка решения (DESIGN.md §5, принцип «одно решение за раз»): вопрос 22 (заголовочный),
 * строка деталей, необязательные прогресс «N из K» и внутренняя карточка (`inner`), ответы —
 * чипы (`chips`) и/или кнопки `primary` / `secondary` / `ghost` («Потом»). Один компонент для
 * платежа, зарплаты, подписки, строки выписки и вопросов первого запуска; ответ пишет
 * родитель (запись `payments` / `merchantRules`).
 */
withDefaults(
  defineProps<{
    question: string
    meta?: string
    progress?: { n: number; k: number } | null
    actions?: { primary?: string; secondary?: string; ghost?: string } | null
    disabled?: boolean
    /** Главное действие экрана (правило 12): рамка `--brand`, как у карточки решения макета «А · Ритуал». */
    lead?: boolean
  }>(),
  { meta: '', progress: null, actions: null, disabled: false, lead: false },
)

const emit = defineEmits<{
  (e: 'primary'): void
  (e: 'secondary'): void
  (e: 'ghost'): void
}>()
</script>

<template>
  <section class="flex flex-col gap-3.5 rounded-card border bg-surface p-5 text-left" :class="lead ? 'border-brand' : 'border-card-border'" aria-live="polite">
    <div v-if="progress" class="type-meta flex items-center gap-2.5">
      <ProgressBar :value="progress.k ? progress.n / progress.k : 0" :height="4" class="flex-1" />
      <span class="num shrink-0">{{ progress.n }} из {{ progress.k }}</span>
    </div>
    <h2 class="type-h2 text-ink">{{ question }}</h2>
    <p v-if="meta" class="text-[14px] text-ink-3">{{ meta }}</p>
    <div v-if="$slots.inner" class="rounded-inner bg-surface-2 px-3.5 py-3 text-[14px]">
      <slot name="inner" />
    </div>
    <div v-if="$slots.chips" class="flex flex-wrap gap-2">
      <slot name="chips" />
    </div>
    <slot />
    <div v-if="actions || $slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions">
        <Button v-if="actions?.primary" :disabled="disabled" @click="emit('primary')">{{ actions.primary }}</Button>
        <Button v-if="actions?.secondary" variant="secondary" :disabled="disabled" @click="emit('secondary')">{{ actions.secondary }}</Button>
        <Button v-if="actions?.ghost" variant="ghost" class="px-2.5" :disabled="disabled" @click="emit('ghost')">{{ actions.ghost }}</Button>
      </slot>
    </div>
  </section>
</template>
