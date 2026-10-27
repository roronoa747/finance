<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useOperationsStore } from '@/stores/operations'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { amountTotal, capitalGoals, capitalStats, liveAccounts, liveCredits, openGoals, netWorth, openDebt } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Tip from '@/components/kit/Tip.vue'
import MoneySquares from '@/components/money/MoneySquares.vue'
import DebtsWidget from '@/components/money/DebtsWidget.vue'
import CapitalLists from '@/components/money/CapitalLists.vue'
import CapitalStats from '@/components/money/CapitalStats.vue'
import HistoryMonths from '@/components/money/HistoryMonths.vue'

/**
 * «Деньги» — капитал без месяца (Блок 15, Р-91; вид — Блок 5 «Фидбек», Р-34, Figma «Деньги» `19:2`): сегмент Капитал ·
 * Долги · История (`/money`, `/money/debts`, `/money/history`), как «Неделя | Месяц». Капитал — чистых крупно и под ним
 * формула «счета − долги» (понятность Р-2, эталон `capital-stats.html`); вся плашка — кнопка, по нажатию на месте
 * раскрывается статистика месяца (`CapitalStats`, Р-3), при каждом заходе закрыта (сложное скрыто, правило 12). Ниже
 * «Счета» с «Цели · N» (Р-109), «Кредиты» и «Платежи» справочником (без отметок месяца, подписки — одной строкой); у каждой
 * строки слот значка слева, суммы одной колонкой с «₸» (Р-12 бэклога «Figma»). Зарплат месяца здесь больше нет (были для справки, Р-108) — они в
 * «Месяце», тот же лист;
 * Долги — по макету Блока 16 (`DebtsWidget`, Р-110); История — месяцами, лента — свёрнутой «Все записи»
 * (`HistoryMonths`, Р-111). Плана месяца, «Подробнее», «До зарплаты» и виджетов «Траты» здесь нет: месяц живёт в
 * «План · Месяц». Брендовой кнопки на экране нет (правило 12). Ничего не считается здесь.
 */
const route = useRoute()
const ops = useOperationsStore()
const finance = useFinanceStore()
const auth = useAuthStore()
/** Подсказка у квадратов (бэклог «первый» Р-7; слова — владелец на `/ux`, Р-9): три части «Денег» — здесь; viewer — без призыва. */
const tipText = computed(() => (auth.isViewer ? 'Сверху — капитал, долги и история семьи' : 'Нажмите «Долги» или «История», чтобы открыть их'))

const square = computed(() => (route.params.square === 'debts' || route.params.square === 'history' ? route.params.square : 'capital'))
const worth = computed(() => netWorth(liveAccounts(finance.accounts), liveCredits(finance.credits), openGoals(finance.goals))) // Сбылось (PN-13): деньги сбывшейся ушли покупкой — не в капитале
// Под суммой — две рамки «счета N ₸» и «долги N ₸» (пачка 2 «Figma», 19:2, FG-25): «Счета» (счета и цели вне счетов, Р-109) и долги —
// те же функции, что у списков «Капитала»; суммы теперь порознь — у каждой «₸» (Р-12).
const assets = computed(() => amountTotal(liveAccounts(finance.accounts)) + capitalGoals(finance.goals, finance.accounts).total)
const debt = computed(() => openDebt(finance.credits))

/** Статистика раскрыта; локально — при заходе на экран всегда закрыто. */
const statsOpen = ref(false)
/** Считается только раскрытой (`v-if`): план месяца — из стора (`monthPlanOf`), без второго прогона очереди. */
const stats = computed(() => capitalStats(finance.monthPlanOf(monthKey()), { ...finance.planState(), plans: finance.plans }, monthKey()))

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <Tip id="tab-money" :text="tipText"><MoneySquares /></Tip>

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
        <span class="flex flex-wrap items-center gap-1.5">
          <span class="inline-flex h-6 items-center gap-1 rounded-lg border border-line-strong px-2 text-[12px] num" data-worth-assets><span class="text-ink-2">счета</span> <span class="text-ink">{{ money(assets) }}</span></span>
          <span v-if="debt > 0" class="inline-flex h-6 items-center gap-1 rounded-lg border border-line-strong px-2 text-[12px] num" data-worth-debts><span class="text-ink-2">долги</span> <span class="text-ink">{{ money(debt) }}</span></span>
          <span v-else class="text-[12px] text-ink-2" data-worth-no-debts>долгов нет</span>
        </span>
        <CapitalStats v-if="statsOpen" :stats="stats" :debt="debt" class="mt-2 border-t border-line pt-3.5" />
      </Card>
      <CapitalLists />
    </template>

    <template v-else-if="square === 'debts'">
      <DebtsWidget />
    </template>

    <HistoryMonths v-else />
  </div>
</template>
