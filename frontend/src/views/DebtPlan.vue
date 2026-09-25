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
import { atLabel } from '@/lib/dates'
import { liveGoals, pausedGoals } from '@/lib/finance'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import DangerZone from '@/components/kit/DangerZone.vue'

const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const plan = computed(() => financeStore.activePlan)
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
