<script setup lang="ts">
import { money } from '@/lib/money'
import Card from './Card.vue'

/**
 * Остаток по плану на первом запуске (DESIGN.md §5, B2C-51): подпись секции, сумма 32 (цифры
 * --font-num) и строка под ней. Сумму считает `finance.ts`; «Свободно» — только на «Мечтах».
 */
withDefaults(
  defineProps<{
    amount: number
    note?: string
    label?: string
  }>(),
  { note: '', label: 'Остаток по плану' },
)
</script>

<template>
  <Card>
    <div class="type-section">{{ label }}</div>
    <div class="mt-2 num type-big-md text-ink">{{ money(amount) }}</div>
    <div v-if="note" class="mt-1.5 text-[13px] text-ink-2">{{ note }}</div>
  </Card>
</template>
