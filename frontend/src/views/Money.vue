<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useOperationsStore } from '@/stores/operations'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { liveAccounts, liveCredits, liveGoals, netWorth } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import MoneySquares from '@/components/money/MoneySquares.vue'
import DebtsWidget from '@/components/money/DebtsWidget.vue'
import CapitalSalaries from '@/components/money/CapitalSalaries.vue'
import CapitalLists from '@/components/money/CapitalLists.vue'
import HistorySquare from '@/components/money/HistorySquare.vue'

/**
 * «Деньги» — капитал без месяца (Блок 15, Р-91; макет week-month.html «Деньги»): квадраты Капитал · Долги · История
 * (`/money`, `/money/debts`, `/money/history`). Капитал — чистых крупно, зарплаты месяца для справки (Р-108), «Счета» с
 * «Цели · N» (Р-109), «Кредиты» и «Платежи» справочником (без отметок месяца, подписки — одной строкой); Долги — по макету Блока 16 (`DebtsWidget`, Р-110);
 * История — как была. Плана
 * месяца, «Подробнее», «До зарплаты» и виджетов «Доход» и «Траты» здесь нет: месяц живёт в «План · Месяц».
 * Брендовой кнопки на экране нет (правило 12). Ничего не считается здесь.
 */
const route = useRoute()
const ops = useOperationsStore()
const finance = useFinanceStore()

const square = computed(() => (route.params.square === 'debts' || route.params.square === 'history' ? route.params.square : 'capital'))
const worth = computed(() => netWorth(liveAccounts(finance.accounts), liveCredits(finance.credits), liveGoals(finance.goals)))

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <MoneySquares />

    <template v-if="square === 'capital'">
      <Card tight class="flex flex-col gap-1" data-capital>
        <span class="type-label">Капитал</span>
        <span class="font-num text-[40px] font-bold leading-none num" :class="worth < 0 ? 'text-warn' : 'text-ink'" data-worth>{{ money(worth) }}</span>
      </Card>
      <CapitalSalaries />
      <CapitalLists />
    </template>

    <template v-else-if="square === 'debts'">
      <DebtsWidget />
    </template>

    <HistorySquare v-else />
  </div>
</template>
