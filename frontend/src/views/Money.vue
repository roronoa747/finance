<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useOperationsStore } from '@/stores/operations'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { amountTotal, capitalGoals, liveAccounts, liveCredits, liveGoals, netWorth, openDebt } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Hint from '@/components/kit/Hint.vue'
import MoneySquares from '@/components/money/MoneySquares.vue'
import DebtsWidget from '@/components/money/DebtsWidget.vue'
import CapitalSalaries from '@/components/money/CapitalSalaries.vue'
import CapitalLists from '@/components/money/CapitalLists.vue'
import HistoryMonths from '@/components/money/HistoryMonths.vue'

/**
 * «Деньги» — капитал без месяца (Блок 15, Р-91; макет week-month.html «Деньги»): квадраты Капитал · Долги · История
 * (`/money`, `/money/debts`, `/money/history`). Капитал — чистых крупно, зарплаты месяца для справки (Р-108), «Счета» с
 * «Цели · N» (Р-109), «Кредиты» и «Платежи» справочником (без отметок месяца, подписки — одной строкой); Долги — по макету Блока 16 (`DebtsWidget`, Р-110);
 * История — месяцами, лента — свёрнутой «Все записи» (`HistoryMonths`, Р-111). Плана
 * месяца, «Подробнее», «До зарплаты» и виджетов «Доход» и «Траты» здесь нет: месяц живёт в «План · Месяц».
 * Брендовой кнопки на экране нет (правило 12). Ничего не считается здесь.
 */
const route = useRoute()
const ops = useOperationsStore()
const finance = useFinanceStore()

const square = computed(() => (route.params.square === 'debts' || route.params.square === 'history' ? route.params.square : 'capital'))
const worth = computed(() => netWorth(liveAccounts(finance.accounts), liveCredits(finance.credits), liveGoals(finance.goals)))
// Для подсказки у суммы: «Счета» (счета и цели вне счетов, Р-109) и долги — те же функции, что у списков «Капитала».
const assets = computed(() => amountTotal(liveAccounts(finance.accounts)) + capitalGoals(finance.goals, finance.accounts).total)
const debt = computed(() => openDebt(finance.credits))

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <MoneySquares />

    <template v-if="square === 'capital'">
      <!-- Слово «Капитал» — уже на чипе; «счета − долги» и итог «Счетов» — в подсказке у суммы (Р-116). -->
      <Card tight class="flex items-center gap-1.5 py-5" data-capital>
        <span class="font-num text-[34px] font-bold leading-none num" :class="worth < 0 ? 'text-warn' : 'text-ink'" data-worth>{{ money(worth) }}</span>
        <Hint label="Что такое капитал" data-worth-hint>
          <span class="block">Всё, что есть, минус всё, что должны.</span>
          <span class="block num">Счета и цели — {{ money(assets) }}, долги — {{ money(debt) }}.</span>
        </Hint>
      </Card>
      <CapitalSalaries />
      <CapitalLists />
    </template>

    <template v-else-if="square === 'debts'">
      <DebtsWidget />
    </template>

    <HistoryMonths v-else />
  </div>
</template>
