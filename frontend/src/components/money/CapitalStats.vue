<script setup lang="ts">
import { computed } from 'vue'
import StackBar from '@/components/kit/StackBar.vue'
import { money } from '@/lib/money'
import { monthBy } from '@/lib/dates'
import { plural } from '@/lib/utils'
import type { CapitalPartKey, CapitalStats } from '@/lib/finance'

/**
 * Аккордеон статистики на плашке Капитала (понятность Р-3, эталон — `capital-stats.html` Блока 2): полоска долей
 * дохода месяца кредиты · платежи · в цели · остаётся (`StackBar`, токены макета), под ней четыре строки «подпись ·
 * сумма · %», ниже «Капитал растёт на ~N в месяц» и две строки долгов — срок и переплата, у каждой рядом то же в
 * зарплатах (`inSalaries`, одна десятая). Всё — из `capitalStats` (`finance.ts`); здесь только слова и цвета.
 * Открывает плашка «Денег» (`Money.vue`); закрыта по умолчанию, в SSR закрытого экрана этого текста нет.
 */
const props = defineProps<{
  stats: CapitalStats
  /** Остаток открытых долгов: 0 — «Долгов нет» вместо срока и переплаты. */
  debt: number
}>()

const LABEL: Record<CapitalPartKey, { name: string; color: string }> = {
  credits: { name: 'кредиты', color: 'var(--s12)' },
  payments: { name: 'платежи', color: 'var(--s1)' },
  goals: { name: 'в цели', color: 'var(--s3)' },
  rest: { name: 'остаётся', color: 'var(--ok)' },
}
const parts = computed(() => props.stats.parts.map((p) => ({ ...p, ...LABEL[p.key] })))
/** «~390 000 ₸» — до тысяч, только на экране (`finance.ts` отдаёт точное тело). */
const growth = computed(() => Math.round(props.stats.growth / 1000) * 1000)
/** «1,5 зарплаты», «9 зарплат», «1 зарплата»: дробь — всегда «зарплаты», целое — по числу. */
function salaries(n: number): string {
  const word = Number.isInteger(n) ? plural(n, 'зарплата', 'зарплаты', 'зарплат') : 'зарплаты'
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${word}`
}
</script>

<template>
  <div class="flex flex-col gap-2.5 text-left" data-capital-stats-body>
    <p v-if="stats.income <= 0" class="text-[14px] text-ink-2" data-no-income>Нет дохода месяца — задайте оклад</p>
    <template v-else>
      <StackBar :segments="parts.map((p) => ({ key: p.key, share: p.share, color: p.color }))" />
      <div v-for="p in parts" :key="p.key" class="grid grid-cols-[10px_1fr_auto_42px] items-center gap-2.5 text-[14.5px]" :data-stat-row="p.key">
        <i class="block size-2.5 rounded-full" :style="{ background: p.color }" />
        <span class="text-ink-2">{{ p.name }}</span>
        <span class="font-semibold num text-ink" data-stat-amount>{{ money(p.amount) }}</span>
        <span class="text-right num text-ink-2" data-stat-pct>{{ p.pct }} %</span>
      </div>
      <p v-if="stats.short > 0" class="text-[13px] text-warn num" data-short>не хватает {{ money(stats.short) }}</p>
      <p v-if="stats.growth > 0" class="mt-0.5 text-[14.5px] text-ink" data-growth>
        Капитал растёт на <b class="font-semibold num">~{{ money(growth) }}</b> в месяц
      </p>
      <p v-if="debt <= 0" class="text-[14.5px] font-semibold text-ok" data-debt-free>Долгов нет</p>
      <template v-else>
        <p v-if="stats.debtFree.month === null" class="text-[14.5px] text-warn" data-debt-free>Долги не закрываются при текущих платежах</p>
        <template v-else>
          <p class="text-[14.5px] text-ink" data-debt-free>
            Без долгов <b class="font-semibold">{{ monthBy(stats.debtFree.month) }}</b>
            <span v-if="stats.debtFree.salaries !== null" class="num text-[13.5px] text-ink-2"> · ещё {{ salaries(stats.debtFree.salaries) }}</span>
          </p>
          <p v-if="stats.overpay.amount === null" class="text-[14px] text-ink-2" data-overpay>Переплата не считается — платёж не покрывает проценты</p>
          <p v-else-if="stats.overpay.amount > 0" class="text-[14.5px] text-ink" data-overpay>
            Переплата <b class="font-semibold num">{{ money(stats.overpay.amount) }}</b>
            <span v-if="stats.overpay.salaries !== null" class="num text-[13.5px] text-ink-2"> · {{ salaries(stats.overpay.salaries) }}</span>
          </p>
        </template>
      </template>
    </template>
  </div>
</template>
