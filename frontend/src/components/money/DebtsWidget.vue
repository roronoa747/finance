<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { openDebt } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'

/**
 * Карточка «Долги» — верх квадрата «Долги» (пивот 3, Р-33; Блок 15, Р-91): остаток открытых кредитов красным;
 * открытых долгов нет — «Долгов нет». Отметок месяца здесь нет (они в «Месяце»); проценты банку и план
 * «Сначала долги» — ниже, в том же квадрате (`PlanSquare`).
 */
const financeStore = useFinanceStore()

const total = computed(() => openDebt(financeStore.credits))
</script>

<template>
  <Card tight class="flex flex-col gap-2">
    <span class="type-label">Долги</span>
    <span v-if="total > 0" class="type-num num text-destructive" data-debts-total>−{{ money(total) }}</span>
    <span v-else class="type-num text-[24px] text-ok">Долгов нет</span>
  </Card>
</template>
