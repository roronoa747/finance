<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { monthIn, monthKey } from '@/lib/dates'
import { debtsSummary, liveAccounts, liveCredits, liveGoals, netWorth } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Hint from '@/components/kit/Hint.vue'
import Tag from '@/components/kit/Tag.vue'

/**
 * Виджет «Долги» (пивот 3, Р-33): остаток кредитов красным, тег «в <месяце> оплачено N из M»
 * (платежи кредитов месяца, `monthDues`) и «чистых N ₸» (`netWorth`) — бывшая карточка «Чистый
 * капитал». Открытых долгов нет — «Долгов нет». Проценты банку — в квадрате «План» (B2C-43).
 */
const financeStore = useFinanceStore()

const key = computed(() => monthKey())
const debts = computed(() => debtsSummary({ credits: financeStore.credits, payments: financeStore.payments }, key.value))
const worth = computed(() => netWorth(liveAccounts(financeStore.accounts), liveCredits(financeStore.credits), liveGoals(financeStore.goals)))
</script>

<template>
  <Card tight class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <span class="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">Долги</span>
      <Tag v-if="debts.count" :tone="debts.paid === debts.count ? 'ok' : 'neutral'" class="num">
        в {{ monthIn(key, false) }} оплачено {{ debts.paid }} из {{ debts.count }}
      </Tag>
    </div>
    <div class="flex items-center justify-between gap-3">
      <span v-if="debts.open" class="font-num text-[28px] font-bold leading-[1.05] tracking-[-0.01em] num text-destructive">−{{ money(debts.total) }}</span>
      <span v-else class="font-num text-[24px] font-bold leading-[1.05] tracking-[-0.01em] text-ok">Долгов нет</span>
      <span class="flex items-center gap-1 type-meta num">
        чистых {{ money(worth) }}
        <Hint>Всё, что есть, минус всё, что должны.</Hint>
      </span>
    </div>
  </Card>
</template>
