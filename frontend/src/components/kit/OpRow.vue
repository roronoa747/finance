<script setup lang="ts">
import { money } from '@/lib/money'

/**
 * Строка операции `.op` (DESIGN.md §5): квадрат 36 с буквой на цвете раздела, продавец,
 * раздел с точкой, сумма (`pos` — поступление, зелёная). Тап — выбор раздела (родитель).
 */
withDefaults(
  defineProps<{
    merchant: string
    /** Раздел; null — «Не разобрано» (`--s-unknown`). */
    category?: { name: string; color: string } | null
    /** Целые тенге; минус — списание. */
    amount: number
    date?: string
    letter?: string
    clickable?: boolean
    /** Не трата (перевод между своими): сумма без знака, тихим цветом. */
    muted?: boolean
  }>(),
  { category: null, date: '', letter: '', clickable: false, muted: false },
)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0 first:pt-0 last:pb-0"
    :class="clickable && 'cursor-pointer hover:bg-surface-2'"
    @click="clickable && emit('click')"
  >
    <span
      class="grid size-9 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo"
      :style="{ background: category?.color ?? 'var(--s-unknown)' }"
      aria-hidden="true"
    >
      {{ letter || merchant.slice(0, 1).toUpperCase() }}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate font-medium text-ink">{{ merchant }}</span>
      <span class="flex items-center gap-1.5 text-[12px] text-ink-2">
        <i class="size-[7px] shrink-0 rounded-full" :style="{ background: category?.color ?? 'var(--s-unknown)' }" aria-hidden="true" />
        <span class="truncate">{{ category?.name ?? 'Не разобрано' }}<template v-if="date"> · {{ date }}</template></span>
      </span>
    </span>
    <span v-if="muted" class="money whitespace-nowrap text-ink-2">{{ money(Math.abs(amount)) }}</span>
    <span v-else class="money whitespace-nowrap" :class="amount > 0 ? 'text-ok' : 'text-ink'">{{ amount > 0 ? '+' : '−' }}{{ money(Math.abs(amount)) }}</span>
  </component>
</template>
