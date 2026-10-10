<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useOperationsStore } from '@/stores/operations'
import { useFinanceStore } from '@/stores/finance'
import { money, plain } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { amountTotal, capitalGoals, capitalStats, liveAccounts, liveCredits, liveGoals, netWorth, openDebt } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import MoneySquares from '@/components/money/MoneySquares.vue'
import DebtsWidget from '@/components/money/DebtsWidget.vue'
import CapitalSalaries from '@/components/money/CapitalSalaries.vue'
import CapitalLists from '@/components/money/CapitalLists.vue'
import CapitalStats from '@/components/money/CapitalStats.vue'
import HistoryMonths from '@/components/money/HistoryMonths.vue'

/**
 * «Деньги» — капитал без месяца (Блок 15, Р-91; макет week-month.html «Деньги»): квадраты Капитал · Долги · История
 * (`/money`, `/money/debts`, `/money/history`). Капитал — чистых крупно и под ним формула «счета − долги» (понятность
 * Р-2, эталон `capital-stats.html`); вся плашка — кнопка, по нажатию на месте раскрывается статистика месяца
 * (`CapitalStats`, Р-3), при каждом заходе закрыта (сложное скрыто, правило 12). Ниже зарплаты месяца для справки (Р-108),
 * «Счета» с «Цели · N» (Р-109), «Кредиты» и «Платежи» справочником (без отметок месяца, подписки — одной строкой);
 * Долги — по макету Блока 16 (`DebtsWidget`, Р-110); История — месяцами, лента — свёрнутой «Все записи»
 * (`HistoryMonths`, Р-111). Плана месяца, «Подробнее», «До зарплаты» и виджетов «Траты» здесь нет: месяц живёт в
 * «План · Месяц». Брендовой кнопки на экране нет (правило 12). Ничего не считается здесь.
 */
const route = useRoute()
const ops = useOperationsStore()
const finance = useFinanceStore()

const square = computed(() => (route.params.square === 'debts' || route.params.square === 'history' ? route.params.square : 'capital'))
const worth = computed(() => netWorth(liveAccounts(finance.accounts), liveCredits(finance.credits), liveGoals(finance.goals)))
// Формула под суммой: «Счета» (счета и цели вне счетов, Р-109) и долги — те же функции, что у списков «Капитала».
const assets = computed(() => amountTotal(liveAccounts(finance.accounts)) + capitalGoals(finance.goals, finance.accounts).total)
const debt = computed(() => openDebt(finance.credits))
const formula = computed(() => (debt.value > 0 ? `счета ${plain(assets.value)} − долги ${plain(debt.value)}` : `счета ${plain(assets.value)} · долгов нет`))

/** Статистика раскрыта; локально — при заходе на экран всегда закрыто. */
const statsOpen = ref(false)
/** Считается только раскрытой (`v-if`): план месяца — из стора (`monthPlanOf`), без второго прогона очереди. */
const stats = computed(() => capitalStats(finance.monthPlanOf(monthKey()), { ...finance.planState(), plans: finance.plans }, monthKey()))

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <MoneySquares />

    <template v-if="square === 'capital'">
      <!-- Плашка (понятность Р-2, Р-3): число, под ним формула «счета − долги»; нажатие раскрывает статистику на месте -->
      <Card
        tight
        class="press flex cursor-pointer flex-col gap-1.5 py-5"
        role="button"
        tabindex="0"
        :aria-expanded="statsOpen"
        data-capital
        data-capital-stats
        @click="statsOpen = !statsOpen"
        @keydown.enter.prevent="statsOpen = !statsOpen"
        @keydown.space.prevent="statsOpen = !statsOpen"
      >
        <span class="flex w-full items-center justify-between gap-2.5">
          <span class="font-num text-[34px] font-bold leading-none num" :class="worth < 0 ? 'text-warn' : 'text-ink'" data-worth>{{ money(worth) }}</span>
          <PhCaretRight :size="20" class="shrink-0 text-ink-3 transition-transform" :class="statsOpen && 'rotate-90'" aria-hidden="true" />
        </span>
        <span class="text-[14px] num text-ink-2" data-worth-formula>{{ formula }}</span>
        <CapitalStats v-if="statsOpen" :stats="stats" :debt="debt" class="mt-2 border-t border-line pt-3.5" />
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
