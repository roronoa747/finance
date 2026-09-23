<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { budgetAmounts } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'

const financeStore = useFinanceStore()

const amounts = computed(() => budgetAmounts(financeStore.householdDoc))
const free = computed(() => amounts.value.d5)
const income = computed(() => amounts.value.income)
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1 text-left">
    <Card>
      <div class="text-[13px] text-ink-2">Свободно в этом месяце</div>
      <div class="mb-2 font-display text-[36px] font-semibold tracking-[-0.03em] num text-ink">
        {{ money(free) }}
      </div>
      <div class="flex justify-between text-[12px] text-ink-3">
        <span>Общий доход {{ money(income) }}</span>
        <span>Обязательства {{ money(income - free) }}</span>
      </div>
    </Card>
  </div>
</template>
