<script setup lang="ts">
/**
 * Экран выбранного плана «Сначала долги» (PV-15…PV-17, Р-5, Р-6): шаг этого месяца,
 * выигрыш (прогноз при выборе, прогноз от факта, уже сэкономлено), план и факт по
 * месяцам, что не ушло в цели, график платежей долга с шагами плана, история планов.
 * Всё считает `finance.ts`, экран только показывает. Пропуски — без упрёка.
 */
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { atLabel, monthIn, monthKey, monthShort, monthTitle } from '@/lib/dates'
import {
  costliestCredits,
  liveGoals,
  pauseMissed,
  pauseShift,
  pausedGoals,
  planFact,
  planForecast,
  planMonths,
  planSchedule,
  planStartMonth,
  planStep,
} from '@/lib/finance'
import type { DebtPlan } from '@/types/finance'
import { cn } from '@/lib/utils'

import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Button from '@/components/ui/Button.vue'
import PlanStepAction from '@/components/PlanStepAction.vue'
import ScheduleTable from '@/components/ScheduleTable.vue'

const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const plan = computed(() => financeStore.activePlan)
const state = computed(() => financeStore.planState())
const step = computed(() => (plan.value ? planStep(plan.value, state.value, key.value) : null))
const creditName = (id: string | null) => financeStore.credits.find((c) => c.id === id)?.name ?? ''
const goalName = (id: string) => liveGoals(financeStore.goals).find((g) => g.id === id)?.name ?? ''
const paused = computed(() => (plan.value ? pausedGoals(plan.value, financeStore.goals) : []))
const cushion = computed(() =>
  plan.value?.cushionGoalId ? liveGoals(financeStore.goals).find((g) => g.id === plan.value!.cushionGoalId) : undefined,
)

/* ------------------ Выигрыш (Р-6) ------------------ */
const forecastNow = computed(() => (plan.value ? planForecast(plan.value, state.value, key.value) : null))
const fact = computed(() => (plan.value ? planFact(plan.value, financeStore.payments, financeStore.credits) : null))
// Р-11: платёж не покрывает проценты — сравнивать не с чем.
const NO_SAVING = 'при текущем платеже долг не закрывается — экономию не считаем'
const closes = (m: string | null) => (m ? `долги с процентами закроются в ${monthIn(m)}` : 'долги с процентами не закрываются')

/* ------------------ План и факт по месяцам ------------------ */
const months = computed(() => (plan.value ? planMonths(plan.value, state.value, key.value) : []))
/**
 * Прошлый месяц плана прошёл без досрочки — одна строка без упрёка (Р-4): план уже
 * пересчитан от факта, пропуски не копятся. Пока шаг — подушка, досрочек и не ждём.
 */
const missed = computed(() => {
  const prev = months.value.at(-2)
  return prev && !prev.fact && step.value?.kind !== 'cushion' ? prev.period : null
})

/* ------------------ График долга с шагами плана (Р-8) ------------------ */
const scheduleOpen = ref(false)
const schedule = computed(() =>
  plan.value && scheduleOpen.value ? planSchedule(plan.value, state.value, key.value) : null,
)
// Долг, который план гасит сейчас; при шаге «подушка» — он же, досрочки начнутся позже.
const target = computed(() => (step.value && step.value.kind !== 'done' ? (costliestCredits(financeStore.credits)[0]?.id ?? null) : null))

/* ------------------ История (Р-5) ------------------ */
const endMonth = (p: DebtPlan) => monthKey(new Date(p.endedAt ?? p.updatedAt))
const history = computed(() =>
  financeStore.plans
    .filter((p) => !p.deletedAt && p.status !== 'active')
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')),
)
/**
 * Итог плана — живым счётом его досрочек (`planFact`), а не снимком `result`: досрочка
 * партнёра, пришедшая после конца плана, и снятая досрочка видны сразу у обоих.
 */
const savedOf = (p: DebtPlan) => planFact(p, financeStore.payments, financeStore.credits).savedInterest
function historyLine(p: DebtPlan): string {
  const from = planStartMonth(p)
  const to = endMonth(p)
  const span = from === to ? monthTitle(from) : `${monthTitle(from)} — ${monthTitle(to)}`
  const saved = money(savedOf(p))
  return p.status === 'done' ? `${span}: сэкономили ${saved} процентов` : `${span}: отменён, сэкономили ${saved}`
}
// План закрылся в этом месяце — цели уже возобновились (Р-5): скажем об этом, пока месяц не кончился.
const justDone = computed(() => {
  const last = history.value[0]
  return !plan.value && last?.status === 'done' && endMonth(last) === key.value ? last : null
})
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1">
    <template v-if="plan">
      <Card>
        <div class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">План «Сначала долги»</div>
        <div class="mt-0.5 text-[13px] text-ink-2">Выбран {{ atLabel(plan.startedAt) }}</div>
      </Card>

      <!-- Шаг этого месяца (PV-16, Р-4, Р-7) -->
      <template v-if="step && step.kind !== 'done' && (step.kind === 'cushion' || step.applied || step.amount > 0)">
        <Section title="Шаг этого месяца" />
        <Card>
          <template v-if="step.kind === 'cushion'">
            <div class="text-[14.5px] font-medium text-ink">Сначала подушка</div>
            <p class="mt-0.5 text-[13px] leading-relaxed text-ink-2 num">
              До месяца обязательных списаний не хватает {{ money(step.missing) }}. Положите
              {{ money(step.amount) }} в «{{ goalName(step.goalId) }}» — досрочки начнутся, когда подушка наберётся.
            </p>
            <Button variant="outline" class="mt-3 w-full bg-surface-2" @click="router.push(`/goals/${step.goalId}`)">
              Пополнить подушку
            </Button>
          </template>
          <template v-else-if="step.applied">
            <div class="text-[14.5px] font-medium text-ink">Внесено по плану</div>
            <p class="mt-0.5 text-[13px] text-ink-2 num">
              {{ money(step.applied.amount) }} в «{{ creditName(step.creditId) }}» · {{ atLabel(step.applied.at) }}
            </p>
          </template>
          <template v-else>
            <div class="font-display text-[22px] font-semibold tracking-[-0.02em] num text-ink">{{ money(step.amount) }}</div>
            <p class="mt-0.5 text-[13px] text-ink-2">
              досрочно в «{{ creditName(step.creditId) }}» — самый дорогой долг; платёж прежний, срок короче
            </p>
            <div class="mt-3"><PlanStepAction wide /></div>
          </template>
        </Card>
      </template>
      <p v-if="missed" class="-mt-1 px-1 text-[12.5px] leading-relaxed text-ink-2">
        В {{ monthIn(missed, false) }} досрочки не было — план пересчитан от факта.
      </p>

      <!-- Выигрыш: прогноз при выборе, от факта, уже сэкономлено (Р-6) -->
      <Section title="Выигрыш" />
      <Card>
        <div class="flex flex-col gap-2.5 text-[13px] leading-snug">
          <div>
            <div class="text-ink-3">При выборе ожидали</div>
            <div class="text-ink num">
              <template v-if="plan.forecast.savedInterest === null">{{ NO_SAVING }}</template>
              <template v-else>
                не отдадим банку <b>{{ money(plan.forecast.savedInterest) }}</b>, {{ closes(plan.forecast.debtFreeMonth) }}
              </template>
            </div>
          </div>
          <div v-if="forecastNow" class="border-t border-line pt-2.5">
            <div class="text-ink-3">Сейчас (от факта)</div>
            <!-- От нынешних остатков: уже сэкономленное — строкой ниже. -->
            <div class="text-ink num">
              <template v-if="forecastNow.savedInterest === null">{{ NO_SAVING }}</template>
              <template v-else>
                ещё не отдадим банку <b>{{ money(forecastNow.savedInterest) }}</b>, {{ closes(forecastNow.debtFreeMonth) }}
              </template>
            </div>
          </div>
          <div v-if="fact" class="flex items-baseline justify-between border-t border-line pt-2.5">
            <span class="text-ink-3">Уже сэкономили</span>
            <b class="num text-brand">{{ money(fact.savedInterest) }}</b>
          </div>
        </div>
      </Card>

      <!-- План и факт по месяцам (Р-6) -->
      <Section title="План и факт по месяцам" />
      <Card>
        <div class="grid grid-cols-[auto_1fr_1fr_auto] items-baseline gap-x-3 gap-y-1.5 text-[12.5px] num">
          <span class="text-ink-3">Месяц</span>
          <span class="text-right text-ink-3">План</span>
          <span class="text-right text-ink-3">Факт</span>
          <span class="text-ink-3">Долг</span>
          <template v-for="m in months" :key="m.period">
            <span :class="cn(m.period === key ? 'font-semibold text-brand' : 'text-ink-2')">{{ monthShort(m.period) }}</span>
            <span class="text-right text-ink">{{ money(m.planned) }}</span>
            <span :class="cn('text-right', m.fact ? 'text-ink' : 'text-ink-3')">{{ m.fact ? money(m.fact) : '—' }}</span>
            <span class="truncate text-ink-2">{{ creditName(m.creditId) || '—' }}</span>
          </template>
        </div>
      </Card>

      <!-- Что не ушло в цели (Р-6) -->
      <Section title="Что не ушло в цели" />
      <Card flush>
        <Row
          v-for="g in paused"
          :key="g.id"
          :title="g.name"
          :note="`${money(pauseMissed(plan, g, key))} не внесено, дата сдвинулась на ${pauseShift(plan, g, key)} мес.`"
          :value="money(g.monthly)"
          sub="в месяц — в долги"
          clickable
          @click="router.push(`/goals/${g.id}`)"
        />
        <div v-if="!paused.length" class="px-4 py-5 text-center text-[13px] text-ink-3">
          Ни одна цель не стоит на паузе
        </div>
      </Card>
      <p v-if="cushion" class="-mt-1 px-1 text-[12.5px] text-ink-2">
        Подушка плана — «{{ cushion.name }}»: взносы продолжаются.
      </p>

      <!-- График платежей долга с шагами плана (Р-8): свёрнут -->
      <div v-if="target" class="rounded-[18px] border border-line bg-surface px-4 py-3">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
          :aria-expanded="scheduleOpen"
          @click="scheduleOpen = !scheduleOpen"
        >
          <span class="text-[13.5px] font-medium text-ink">График платежей «{{ creditName(target) }}»</span>
          <span class="text-[12.5px] text-brand">{{ scheduleOpen ? 'Свернуть' : 'Показать' }}</span>
        </button>
        <ScheduleTable v-if="schedule" :rows="schedule.rows" extra-label="по плану" class="mt-2.5" />
      </div>
    </template>

    <template v-else>
      <Callout v-if="justDone" tone="good" title="Долги с процентами закрыты — цели возобновились">
        Сэкономили {{ money(savedOf(justDone)) }} процентов.
      </Callout>
      <Card>
        <div class="font-display text-[17px] font-semibold text-ink">Плана нет</div>
        <p class="mt-1 text-[13px] leading-relaxed text-ink-2">
          Сравните «копим как сейчас» и «сначала долги» в калькуляторе и выберите план — он поведёт
          семью месяц за месяцем.
        </p>
        <RouterLink to="/capital?advice=strategy" class="mt-2 inline-block text-[13px] font-medium text-brand">
          Открыть калькулятор →
        </RouterLink>
      </Card>
    </template>

    <!-- История планов (Р-5) -->
    <template v-if="history.length">
      <Section title="История планов" />
      <Card>
        <div class="flex flex-col gap-2 text-[13px] text-ink-2 num">
          <div v-for="p in history" :key="p.id">{{ historyLine(p) }}</div>
        </div>
      </Card>
    </template>

    <DangerZone
      v-if="plan && !authStore.isViewer"
      label="Отменить план"
      warning="Цели возобновятся, история плана останется."
      confirm-label="Отменить план"
      @confirm="financeStore.cancelPlan()"
    />
  </div>
</template>
