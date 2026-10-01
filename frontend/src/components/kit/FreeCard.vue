<script setup lang="ts">
import { money } from '@/lib/money'
import Card from './Card.vue'
import ProgressBar from './ProgressBar.vue'

/**
 * «Свободно до конца месяца» (DESIGN.md §5): сумма Piazzolla 44 (`md` — 32), подпись
 * («по факту выписок обоих · N дней до зарплаты»), полоса `--ok`. `amount: null` — «—» до
 * первой выписки. Сумму и долю считает `freeByFact` (`finance.ts`).
 */
withDefaults(
  defineProps<{
    amount: number | null
    note?: string
    /** Доля свободного от дохода месяца, 0…1 — длина полосы. */
    share?: number | null
    label?: string
    size?: 'lg' | 'md'
  }>(),
  { note: '', share: null, label: 'Свободно до конца месяца', size: 'lg' },
)
</script>

<template>
  <Card>
    <div class="type-section">{{ label }}</div>
    <div class="mt-2 num" :class="[size === 'md' ? 'type-big-md' : 'type-big', amount === null ? 'text-ink-3' : 'text-ink']">
      {{ amount === null ? '—' : money(amount) }}
    </div>
    <div v-if="note" class="mt-1.5 text-[13px] text-ink-2">{{ note }}</div>
    <ProgressBar v-if="amount !== null && share !== null" :value="share" tone="ok" class="mt-3" />
    <slot />
  </Card>
</template>
