<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import { progressMoments, summaryMonth } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Row from '@/components/kit/Row.vue'
import Section from '@/components/kit/Section.vue'
import MonthSummaryCard from '@/components/MonthSummaryCard.vue'

/**
 * «История и итоги» (DESIGN.md §3; B2C-21) — то, что уехало с прежнего Обзора: итог месяца
 * «Наш <месяц>» (источник сторис «утечек», B2C-20) и «История семьи» (моменты прогресса).
 * «Впереди» — в «Деньгах» (g6, возврат смоука). Ничего не считается здесь — `finance.ts`.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

// Итог месяца (RP-13): в последние дни — за этот, в первые — за прошлый; в середине месяца итога нет.
const summaryKey = computed(() => summaryMonth())

// История семьи (RP-12): моменты прогресса выводятся из записанного. Без имён.
const HISTORY_ROWS = 8
const history = computed(() =>
  progressMoments({
    credits: financeStore.householdDoc.credits,
    goals: financeStore.goals,
    payments: financeStore.payments,
  })
    .slice(0, HISTORY_ROWS)
    .map((m) => {
      const when = atLabel(m.at)
      if (m.kind === 'half') return { id: m.id, title: `«${m.name}»: собрали половину`, note: when, to: null }
      if (m.kind === 'saved') {
        return { id: m.id, title: `Не отдадим банку ${money(m.saved)}`, note: `${when} · досрочка в «${m.name}»`, to: null }
      }
      // Платёж долга из плана «Сначала долги» уже идёт в следующий долг — решать нечего.
      const inPlan = !!financeStore.activePlan?.creditIds.includes(m.creditId)
      return {
        id: m.id,
        title: `«${m.name}» закрыт`,
        note: inPlan ? `${when} · его платёж идёт в следующий долг по плану` : `${when} · освободилось ${money(m.freed)} в месяц`,
        // Раскладка — решение: viewer его не принимает (Р-13).
        to: authStore.isViewer ? null : inPlan ? '/money/plan' : `/week/salary?from=credit&credit=${m.creditId}`,
      }
    }),
)
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!-- Итог месяца на двоих (RP-13) — источник карточки «утечек» (B2C-20) -->
    <MonthSummaryCard v-if="summaryKey" :month="summaryKey" />
    <p v-else class="px-1 type-meta">Итоги месяца появятся в его последние дни.</p>

    <!-- История семьи (RP-12): одна спокойная строка на момент; нет моментов — нет раздела -->
    <template v-if="history.length">
      <Section title="История семьи" />
      <Card flush>
        <Row
          v-for="h in history"
          :key="h.id"
          :title="h.title"
          :note="h.note"
          :clickable="!!h.to"
          @click="h.to && router.push(h.to)"
        />
      </Card>
    </template>
  </div>
</template>
