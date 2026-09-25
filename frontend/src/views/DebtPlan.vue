<script setup lang="ts">
/**
 * Экран выбранного плана «Сначала долги» (PV-15; PV-16 — шаг месяца, PV-17 — месяцы,
 * выигрыш, график и история). Всё считает `finance.ts`, экран только показывает.
 */
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { addMonths, atLabel, monthIn, monthKey } from '@/lib/dates'
import { liveGoals, pausedGoals, planPrepay, planStartMonth, planStep } from '@/lib/finance'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Button from '@/components/ui/Button.vue'
import PlanStepAction from '@/components/PlanStepAction.vue'

const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const plan = computed(() => financeStore.activePlan)
const step = computed(() => (plan.value ? planStep(plan.value, financeStore.planState(), key.value) : null))
const creditName = (id: string) => financeStore.credits.find((c) => c.id === id)?.name ?? ''
const goalName = (id: string) => liveGoals(financeStore.goals).find((g) => g.id === id)?.name ?? ''
/**
 * Прошлый месяц плана прошёл без досрочки — одна строка без упрёка (Р-4): план уже
 * пересчитан от факта, пропуски не копятся.
 */
const missed = computed(() => {
  if (!plan.value) return null
  const prev = addMonths(key.value, -1)
  if (prev < planStartMonth(plan.value) || planPrepay(plan.value, financeStore.payments, prev)) return null
  return prev
})
const paused = computed(() => (plan.value ? pausedGoals(plan.value, financeStore.goals) : []))
const cushion = computed(() =>
  plan.value?.cushionGoalId ? liveGoals(financeStore.goals).find((g) => g.id === plan.value!.cushionGoalId) : undefined,
)
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1">
    <template v-if="plan">
      <Card>
        <div class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">План «Сначала долги»</div>
        <div class="mt-0.5 text-[13px] text-ink-2">Выбран {{ atLabel(plan.startedAt) }}</div>
      </Card>

      <!-- Шаг этого месяца (PV-16, Р-4, Р-7) -->
      <template v-if="step && step.kind !== 'done'">
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

      <Section title="Цели на паузе" />
      <Card flush>
        <Row
          v-for="g in paused"
          :key="g.id"
          :title="g.name"
          note="взнос идёт в досрочку"
          :value="money(g.monthly)"
          sub="в месяц"
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

      <DangerZone
        v-if="!authStore.isViewer"
        label="Отменить план"
        warning="Цели возобновятся, история плана останется."
        confirm-label="Отменить план"
        @confirm="financeStore.cancelPlan()"
      />
    </template>

    <Card v-else>
      <div class="font-display text-[17px] font-semibold text-ink">Плана нет</div>
      <p class="mt-1 text-[13px] leading-relaxed text-ink-2">
        Сравните «копим как сейчас» и «сначала долги» в калькуляторе и выберите план — он поведёт
        семью месяц за месяцем.
      </p>
      <RouterLink to="/capital?advice=strategy" class="mt-2 inline-block text-[13px] font-medium text-brand">
        Открыть калькулятор →
      </RouterLink>
    </Card>
  </div>
</template>
