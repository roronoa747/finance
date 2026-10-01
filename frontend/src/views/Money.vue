<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { PhChartBar, PhCoins, PhCalendarBlank, PhClockCounterClockwise, PhPiggyBank } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { money, plain } from '@/lib/money'
import { monthKey, monthFrom, dayLabel } from '@/lib/dates'
import { amountAt, budgetAmounts, freeByFact, freedChange, liveAccounts, liveCredits, liveGoals, liveObligations, monthDues, netWorth, salaryAsk, untilPayday } from '@/lib/finance'
import { plural } from '@/lib/utils'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/kit/Card.vue'
import FreeCard from '@/components/kit/FreeCard.vue'
import Row from '@/components/kit/Row.vue'
import Section from '@/components/kit/Section.vue'
import PaidRow from '@/components/PaidRow.vue'
import SalaryRow from '@/components/SalaryRow.vue'

/**
 * «Деньги» — вход на второй уровень (DESIGN.md §2 g6 «Деньги — вход», §3; B2C-13, B2C-21): сверху
 * «Свободно до конца месяца» и «до зарплаты N дней» (как на главном — `freeByFact`, `untilPayday`),
 * «Пришла зарплата» под ними; входы — Бюджет, Капитал, План «Сначала долги», вклады, «История и
 * итоги» с цифрой одной строкой; событие «освободится N ₸»; «Впереди» — платежи месяца с «Оплатил»
 * и зарплата (§3: список «Впереди» — второй уровень «Деньги»). Ничего не считается здесь.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()

const key = computed(() => monthKey())
const obligations = computed(() => liveObligations(financeStore.obligations))

/* ---------- «Свободно до конца месяца» — то же, что на главном ---------- */
const state = computed(() => ({ ...financeStore.householdDoc, credits: financeStore.credits }))
const free = computed(() =>
  freeByFact(state.value, financeStore.householdDoc.spendTotals ?? [], financeStore.householdDoc.spendCategories ?? [], key.value, ops.uploads),
)
const hasUploads = computed(() => ops.uploads.length > 0)

/* ---------- входы: одна строка данных у каждого (g6) ---------- */
const amounts = computed(() => budgetAmounts(state.value, key.value))
const worth = computed(() => netWorth(liveAccounts(financeStore.accounts), liveCredits(financeStore.credits), liveGoals(financeStore.goals)))
const deposits = computed(() => liveAccounts(financeStore.accounts).filter((a) => a.kind === 'deposit'))
const entries = computed(() => [
  { to: '/money/budget', title: 'Бюджет', note: `доход ${plain(amounts.value.income)} · план и календарь платежей`, icon: PhChartBar },
  { to: '/money/capital', title: 'Капитал', note: `счета и долги · чистых ${money(worth.value)}`, icon: PhCoins },
  { to: '/money/plan', title: 'План «Сначала долги»', note: financeStore.activePlan ? 'идёт · шаг месяца и прогноз' : 'что гасить первым', icon: PhCalendarBlank },
  ...deposits.value.map((a) => ({ to: `/money/capital/${a.id}`, title: `Вклад · ${a.name}`, note: `${money(a.amount)} · проценты и график`, icon: PhPiggyBank })),
  { to: '/money/history', title: 'История и итоги', note: 'итог месяца и моменты семьи', icon: PhClockCounterClockwise },
])

// Событие «освободится N ₸»: у годового — доля в месяц и разница за год (`freedChange`).
const freed = computed(() => freedChange(obligations.value, key.value))

// «До зарплаты»: остатки общих счетов и долгов — из отметок, как их отдаёт стор
const paydayInfo = computed(() =>
  untilPayday({
    people: financeStore.people,
    obligations: financeStore.obligations,
    credits: financeStore.credits,
    accounts: financeStore.householdAccounts,
    payments: financeStore.payments,
  }),
)

// «Пришла зарплата» (RP-10): то же условие, что у главного и «Недели» (`salaryAsk`).
const salaryHere = computed(
  () =>
    !authStore.isViewer &&
    !!salaryAsk({ people: financeStore.people, obligations: financeStore.obligations, credits: financeStore.credits, payments: financeStore.payments }, authStore.slot),
)

/* ---------- «Впереди»: платежи месяца и ближайшая зарплата по дню (g6) ---------- */
// Оплаченное — не предстоящее, уходит вниз с отметкой (правило finance.ts, как было в «Истории»).
const upcoming = computed(() => {
  const dues = monthDues({ obligations: financeStore.obligations, credits: financeStore.credits, payments: financeStore.payments }, key.value).map((d) => ({
    type: 'due' as const,
    id: d.targetId,
    kind: d.kind,
    name: d.name,
    day: d.day,
    paid: d.paid,
  }))
  const p = paydayInfo.value
  const salary = p && p.key === key.value ? [{ type: 'salary' as const, id: `salary-${p.who.id}`, day: p.day, paid: false }] : []
  return [...dues, ...salary].sort((a, b) => Number(a.paid) - Number(b.paid) || a.day - b.day)
})

onMounted(() => void ops.loadUploads())
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!-- Свободно до конца месяца · до зарплаты N дней (g6) -->
    <FreeCard :amount="hasUploads ? free.amount : null" :share="hasUploads ? free.share : null" size="md">
      <template v-if="paydayInfo" #aside>
        <div class="type-meta">до зарплаты</div>
        <div class="type-h3 text-ink">{{ paydayInfo.inDays === 0 ? 'сегодня' : `${paydayInfo.inDays} ${plural(paydayInfo.inDays, 'день', 'дня', 'дней')}` }}</div>
      </template>
      <SalaryRow v-if="salaryHere && paydayInfo" button :quiet="!!freed" :person-id="paydayInfo.who.id" :period="paydayInfo.key" />
    </FreeCard>

    <Card tight>
      <div class="flex flex-col">
        <Row v-for="e in entries" :key="e.to" :title="e.title" :note="e.note" clickable dense @click="router.push(e.to)">
          <template #icon><component :is="e.icon" :size="18" /></template>
        </Row>
      </div>
    </Card>

    <!-- Событие высвобождения средств -->
    <Card v-if="freed" class="border-brand">
      <div class="type-section text-brand">С {{ monthFrom(freed.change.from, false) }}</div>
      <h3 class="mt-1 type-h2 text-ink">Освободится {{ money(freed.monthly) }} в месяц</h3>
      <p class="mb-3.5 mt-1 text-[13px] text-ink-2 num">
        {{ freed.o.name }}: {{ plain(amountAt(freed.o, key)) }} → {{ plain(freed.change.amount) }} ₸ · {{ money(freed.yearly) }} за год
      </p>
      <Button v-if="!authStore.isViewer" class="w-full" @click="router.push('/week/salary?from=freed')">Распределить</Button>
    </Card>

    <!-- Впереди (g6): платежи месяца с отметкой оплаты и зарплата; хватит ли до зарплаты — строкой внизу -->
    <template v-if="upcoming.length">
      <Section title="Впереди">
        <template #action>
          <RouterLink to="/money/budget" class="text-[13px] font-semibold text-brand">Календарь</RouterLink>
        </template>
      </Section>
      <Card flush>
        <template v-for="u in upcoming" :key="u.id">
          <SalaryRow
            v-if="u.type === 'salary' && paydayInfo"
            :person-id="paydayInfo.who.id"
            :period="paydayInfo.key"
            :note="`${dayLabel(paydayInfo.day, paydayInfo.key)} · ${paydayInfo.who.name}`"
          />
          <!-- Строка g6: название, дата, сумма и кнопка отметки — без иконки и шеврона, чтобы название не сжималось. -->
          <PaidRow v-else-if="u.type === 'due'" :kind="u.kind" :target-id="u.id" :period="key" :title="u.name" :note="dayLabel(u.day, key)" />
        </template>
        <p v-if="paydayInfo?.knowsCash" class="border-t border-line px-4 py-3 type-meta">
          {{
            paydayInfo.shortfall >= 0
              ? `На счетах ${plain(paydayInfo.onAccounts)} ₸ — хватает, остаётся ${plain(paydayInfo.shortfall)} ₸.`
              : `На счетах ${plain(paydayInfo.onAccounts)} ₸ — не хватает ${plain(-paydayInfo.shortfall)} ₸.`
          }}
        </p>
        <p v-else-if="paydayInfo" class="border-t border-line px-4 py-3 type-meta">Добавьте счёт в «Капитале» — покажем, хватит ли.</p>
      </Card>
    </template>
  </div>
</template>
