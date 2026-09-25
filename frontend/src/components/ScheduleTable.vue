<script setup lang="ts">
import { PhCheck } from '@phosphor-icons/vue'
import { plain } from '@/lib/money'
import { monthShort } from '@/lib/dates'
import type { ScheduleRow } from '@/lib/finance'
import { cn } from '@/lib/utils'

/**
 * График платежей по кредиту (Р-8): месяц, платёж, в долг, банку, остаток; оплаченный
 * месяц помечен, досрочка месяца — строкой под ним. Окно кредита и экран плана.
 */
withDefaults(defineProps<{ rows: ScheduleRow[]; extraLabel?: string }>(), { extraLabel: 'досрочка' })
</script>

<template>
  <div class="grid grid-cols-[auto_1fr_1fr_1fr_1fr] gap-x-2 gap-y-1 text-right text-[11.5px] num">
    <span class="text-left text-ink-3">Месяц</span>
    <span class="text-ink-3">Платёж</span>
    <span class="text-ink-3">В долг</span>
    <span class="text-ink-3">Банку</span>
    <span class="text-ink-3">Остаток</span>
    <template v-for="r in rows" :key="r.period">
      <span :class="cn('flex items-center gap-1 text-left', r.paid ? 'text-brand' : 'text-ink-2')">
        <PhCheck v-if="r.paid" :size="11" weight="bold" aria-label="оплачен" />
        {{ monthShort(r.period) }}
      </span>
      <span :class="r.paid ? 'text-ink-3' : 'text-ink'">{{ plain(r.amount) }}</span>
      <span :class="r.paid ? 'text-ink-3' : 'text-ink'">{{ plain(r.body) }}</span>
      <span :class="r.paid ? 'text-ink-3' : 'text-ink'">{{ plain(r.interest) }}</span>
      <span :class="r.paid ? 'text-ink-3' : 'text-ink'">{{ plain(r.left) }}</span>
      <span v-if="r.extra > 0" class="col-span-5 -mt-0.5 text-right text-brand">
        {{ extraLabel }} {{ plain(r.extra) }}
      </span>
    </template>
  </div>
</template>
