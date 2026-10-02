<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { monthIn, monthKey } from '@/lib/dates'
import { debtsSummary } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Tag from '@/components/kit/Tag.vue'

/**
 * Виджет «Долги» (пивот 3, Р-33): остаток кредитов красным, тег «в <месяце> оплачено N из M»
 * (платежи кредитов месяца, `monthDues`). Открытых долгов нет — «Долгов нет». «Чистых» — только в
 * квадрате «Капитал» (решение владельца 2026-10-02). Проценты банку — в квадрате «План» (B2C-43).
 */
const financeStore = useFinanceStore()

const key = computed(() => monthKey())
const debts = computed(() => debtsSummary({ credits: financeStore.credits, payments: financeStore.payments }, key.value))
</script>

<template>
  <Card tight class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <span class="type-label">Долги</span>
      <Tag v-if="debts.count" :tone="debts.paid === debts.count ? 'ok' : 'neutral'" class="num">
        в {{ monthIn(key, false) }} оплачено {{ debts.paid }} из {{ debts.count }}
      </Tag>
    </div>
    <span v-if="debts.open" class="type-num num text-destructive">−{{ money(debts.total) }}</span>
    <span v-else class="type-num text-[24px] text-ok">Долгов нет</span>
  </Card>
</template>
