<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { PhClock } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { monthKey, dayLabel, atLabel } from '@/lib/dates'
import { monthDues, progressMoments, summaryMonth } from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Row from '@/components/kit/Row.vue'
import Section from '@/components/kit/Section.vue'
import PaidRow from '@/components/PaidRow.vue'
import MonthSummaryCard from '@/components/MonthSummaryCard.vue'

/**
 * «История и итоги» (DESIGN.md §3; B2C-21) — то, что уехало с прежнего Обзора: «Впереди»
 * (платежи месяца с отметками), итог месяца «Наш <месяц>» (источник сторис «утечек», B2C-20) и
 * «История семьи» (моменты прогресса). Ничего не считается здесь — `finance.ts`.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())

// Платежи месяца «Впереди» (правило finance.ts): оплаченное — не предстоящее, уходит вниз с отметкой.
const upcoming = computed(() => {
  const items = monthDues(
    { obligations: financeStore.obligations, credits: financeStore.credits, payments: financeStore.payments },
    key.value,
  ).map((d) => ({
    id: d.targetId,
    kind: d.kind,
    name: d.name,
    day: d.day,
    paid: d.paid,
    ...(d.kind === 'obligation'
      ? {
          note: d.obligation.every === 'year' ? 'раз в год' : d.obligation.estimate ? 'оценка по сезону' : d.obligation.note,
          color: `var(--${d.obligation.category})`,
        }
      : { note: d.credit.note || 'ежемесячный платёж', color: 'var(--d2)' }),
    to: `/money/capital?${d.kind}=${d.targetId}`,
  }))
  return items.sort((a, b) => Number(a.paid) - Number(b.paid) || a.day - b.day)
})

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

    <!-- Секция «Впереди» -->
    <Section title="Впереди">
      <template #action>
        <RouterLink to="/money/budget" class="text-[13px] font-semibold text-brand">Календарь</RouterLink>
      </template>
    </Section>
    <Card flush>
      <PaidRow
        v-for="u in upcoming"
        :key="u.id"
        :kind="u.kind"
        :target-id="u.id"
        :period="key"
        :accent="u.color"
        :title="u.name"
        :note="`${dayLabel(u.day, key)}${u.note ? ` · ${u.note}` : ''}`"
        clickable
        @open="router.push(u.to)"
      >
        <template #icon>
          <PhClock :size="17" />
        </template>
      </PaidRow>
      <p v-if="!upcoming.length" class="px-4 py-3 type-meta">В этом месяце платежей по графику нет.</p>
    </Card>

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
