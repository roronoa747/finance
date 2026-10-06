<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCaretRight, PhPlus } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, rateField } from '@/lib/money'
import { monthBy, monthFrom, monthKey } from '@/lib/dates'
import { debtsOverview, type DebtRow } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Button from '@/components/ui/Button.vue'
import CreditSheet from '@/components/capital/CreditSheet.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'
import NewDebtSheet from '@/components/capital/NewDebtSheet.vue'
import PlanSquare from '@/components/money/PlanSquare.vue'

/**
 * Экран «Долги» (Блок 16, Р-110; макет money-b16.html): карточка — сумма остатков и «без долгов — к <месяц>»; кредиты
 * строками «платёж в месяц · ставка · до когда» с остатком и полосой «погашено с начала учёта» (отметок с телом нет —
 * без полосы), нажатие — лист кредита. «Как закрыть быстрее ›» свёрнуто: внутри — долговой план (`PlanSquare`).
 * Тихое «+ Кредит» — участнику; брендовых кнопок нет: «Отложил» в долг — у его строки в «Месяце». Всё — `debtsOverview`.
 */
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const overview = computed(() => debtsOverview({ ...financeStore.planState(), plans: financeStore.plans }, key.value))
const hasPlan = computed(() => !!financeStore.activePlan)
// Без открытых долгов и плана — прошлые планы и поздравление плана видны сразу, без свёртки (как раньше).
const pastPlans = computed(() => financeStore.plans.some((p) => !p.deletedAt && p.status !== 'active'))

function rowMeta(r: DebtRow): string {
  const rate = r.rateUnknown ? 'ставку уточните' : `${rateField(r.rate)} %`
  return [`${plain(r.payment)} в месяц`, rate, r.endMonth ? `до ${monthFrom(r.endMonth)}` : 'не закрывается'].join(' · ')
}

const calcOpen = ref(false)
const creditId = ref<string | null>(null)
const payoffId = ref<string | null>(null)
const addOpen = ref(false)
</script>

<template>
  <Card tight class="flex flex-col gap-1" data-debts>
    <span class="type-label">Долги</span>
    <template v-if="overview.total > 0">
      <span class="font-num text-[40px] font-bold leading-none num text-ink" data-debts-total>{{ money(overview.total) }}</span>
      <span v-if="overview.freeMonth" class="type-meta" data-debts-free>без долгов — {{ monthBy(overview.freeMonth, key) }}</span>
    </template>
    <span v-else class="type-num text-[24px] text-ok">Долгов нет</span>
  </Card>

  <Card v-if="overview.rows.length" flush data-debt-rows>
    <button
      v-for="r in overview.rows"
      :key="r.creditId"
      type="button"
      class="press flex w-full cursor-pointer flex-col gap-1 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-2"
      :data-debt="r.creditId"
      @click="creditId = r.creditId"
    >
      <span class="flex w-full items-baseline justify-between gap-3">
        <span class="min-w-0 truncate text-[15px] font-semibold text-ink">{{ r.name }}</span>
        <span class="shrink-0 text-[15px] font-semibold num text-ink">{{ money(r.left) }}</span>
      </span>
      <span class="type-meta num">{{ rowMeta(r) }}</span>
      <span v-if="r.paidShare !== null" class="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-track" data-debt-bar>
        <span class="block h-full rounded-full bg-ok" :style="{ width: `${Math.round(r.paidShare * 100)}%` }" />
      </span>
    </button>
  </Card>

  <!-- Расчёт и «Сначала долги» — свёрнуты (правило 12) -->
  <template v-if="overview.rows.length || hasPlan">
    <button
      type="button"
      class="press flex w-full cursor-pointer items-center justify-between gap-3 rounded-[16px] border border-card-border bg-surface px-4 py-3 text-left text-[15px] font-semibold text-ink"
      :aria-expanded="calcOpen"
      data-debts-calc
      @click="calcOpen = !calcOpen"
    >
      Как закрыть быстрее
      <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="calcOpen && 'rotate-90'" />
    </button>
    <div v-show="calcOpen" class="flex flex-col gap-3" data-debts-calc-body>
      <PlanSquare />
    </div>
  </template>
  <PlanSquare v-else-if="pastPlans" />

  <div v-if="!authStore.isViewer">
    <Button variant="ghost" class="px-2.5" data-add-credit @click="addOpen = true"><PhPlus :size="16" weight="bold" /> Кредит</Button>
  </div>

  <CreditSheet :credit-id="creditId" @close="creditId = null" @payoff="(id) => { payoffId = id; creditId = null }" />
  <PayoffSheet :credit-id="payoffId" @close="payoffId = null" />
  <NewDebtSheet :open="addOpen" @close="addOpen = false" />
</template>
