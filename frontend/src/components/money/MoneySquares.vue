<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { plain } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { liveAccounts, liveCredits, liveGoals, netWorth, openDebt } from '@/lib/finance'
import { cn, plural } from '@/lib/utils'
import Hint from '@/components/kit/Hint.vue'

/**
 * Три квадрата «Денег» (пивот 3, Р-31; Блок 15, Р-91): Капитал — чистых коротко (`netWorth`; подсказка «?» —
 * рядом с кнопкой квадрата, не внутри: кнопка в кнопке недопустима), Долги (бывший «План») — остаток открытых
 * долгов или «долгов нет», История — свои операции месяца.
 * Активный — по адресу; переход — `router.replace`: «назад» ведёт на прошлую вкладку, а не
 * перебирает квадраты.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const ops = useOperationsStore()

const worth = computed(() => netWorth(liveAccounts(financeStore.accounts), liveCredits(financeStore.credits), liveGoals(financeStore.goals)))
const debt = computed(() => openDebt(financeStore.credits))
const debtsNote = computed(() => (debt.value > 0 ? plain(debt.value) : 'долгов нет'))
// Свои операции из выписок за этот месяц (партнёр своих не видит — Р-5); нет — в Истории отметки.
const opsCount = computed(() => {
  const key = monthKey()
  return ops.all.filter((o) => o.date.startsWith(key)).length
})

const squares = computed(() => [
  { to: '/money', title: 'Капитал', note: plain(worth.value) },
  { to: '/money/debts', title: 'Долги', note: debtsNote.value },
  {
    to: '/money/history',
    title: 'История',
    note: opsCount.value ? `${opsCount.value} ${plural(opsCount.value, 'операция', 'операции', 'операций')}` : 'отметки',
  },
])
</script>

<template>
  <div class="flex gap-2" role="group" aria-label="Деньги">
    <div v-for="s in squares" :key="s.to" class="relative flex min-w-0 flex-1">
      <button
        type="button"
        :aria-current="route.path === s.to ? 'page' : undefined"
        :class="
          cn(
            'press flex w-full min-w-0 flex-col gap-px rounded-[16px] border px-3 py-2.5 text-left cursor-pointer',
            route.path === s.to ? 'border-brand bg-brand-soft' : 'border-card-border bg-surface',
          )
        "
        @click="route.path !== s.to && router.replace(s.to)"
      >
        <b :class="cn('truncate text-[14px] font-semibold', route.path === s.to ? 'text-brand' : 'text-ink-2')">{{ s.title }}</b>
        <small :class="cn('truncate text-[11.5px] num', route.path === s.to ? 'text-brand opacity-80' : 'text-ink-3')">{{ s.note }}</small>
      </button>
      <span v-if="s.to === '/money'" class="absolute right-2 top-2">
        <Hint label="Что такое капитал">Всё, что есть, минус всё, что должны.</Hint>
      </span>
    </div>
  </div>
</template>
