<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { money, plain } from '@/lib/money'
import { monthKey, monthFrom } from '@/lib/dates'
import { amountAt, breakdownPath, freedChange, freedQuestion, liveObligations } from '@/lib/finance'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/kit/Card.vue'
import MoneySquares from '@/components/money/MoneySquares.vue'
import PaydaySummary from '@/components/money/PaydaySummary.vue'
import IncomeWidget from '@/components/money/IncomeWidget.vue'
import LivingWidget from '@/components/money/LivingWidget.vue'
import DebtsWidget from '@/components/money/DebtsWidget.vue'
import CapitalLists from '@/components/money/CapitalLists.vue'
import PlanSquare from '@/components/money/PlanSquare.vue'
import HistorySquare from '@/components/money/HistorySquare.vue'


/**
 * «Деньги» — один экран (пивот 3, Р-31; `pivot-3/index.html` `#money`): квадраты Капитал · План ·
 * История по адресу `/money`, `/money/plan`, `/money/history`. У Капитала сверху сводка «До
 * зарплаты» (Р-32), под квадратами — «Освободится» (до разбора «Неделя», Р-39) и виджеты Доход ·
 * Траты · Долги (Р-33), под ними — «Счета» и «Платежи» (Р-32). Ничего не считается здесь — только `finance.ts`.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()
const ops = useOperationsStore()

const square = computed(() => (route.params.square === 'plan' || route.params.square === 'history' ? route.params.square : 'capital'))
const key = computed(() => monthKey())

// Событие «освободится N ₸»: у годового — доля в месяц и разница за год (`freedChange`).
const freed = computed(() => freedChange(liveObligations(financeStore.obligations), key.value, fx.book))

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!-- Сводка «До зарплаты» — только у Капитала (как в макете); «Пришла зарплата» — в ней. -->
    <PaydaySummary v-if="square === 'capital'" :quiet="!!freed" />

    <MoneySquares />

    <template v-if="square === 'capital'">
      <!-- Событие высвобождения средств -->
      <Card v-if="freed" class="border-brand">
        <div class="type-section text-brand">С {{ monthFrom(freed.change.from, false) }}</div>
        <h3 class="mt-1 type-h2 text-ink">{{ freedQuestion(freed) }}</h3>
        <p class="mb-3.5 mt-1 text-[13px] text-ink-2 num">
          {{ freed.o.name }}: {{ plain(amountAt(freed.o, key, fx.book)) }} → {{ plain(amountAt(freed.o, freed.change.from, fx.book)) }} ₸ · {{ money(freed.yearly) }} за год
        </p>
        <Button v-if="!authStore.isViewer" class="w-full" @click="router.push(breakdownPath({ from: 'freed' }))">Распределить</Button>
      </Card>

      <IncomeWidget />
      <LivingWidget />
      <DebtsWidget />

      <CapitalLists />
    </template>

    <PlanSquare v-else-if="square === 'plan'" />
    <HistorySquare v-else />
  </div>
</template>
