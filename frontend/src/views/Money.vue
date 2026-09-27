<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhChartBar, PhCoins, PhCalendarBlank, PhClockCounterClockwise, PhPiggyBank } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain } from '@/lib/money'
import { monthKey, monthFrom, dayLabel } from '@/lib/dates'
import { amountAt, liveAccounts, liveObligations, nextChange, salaryOpen, untilPayday } from '@/lib/finance'
import { cn, plural } from '@/lib/utils'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import Row from '@/components/kit/Row.vue'
import Section from '@/components/kit/Section.vue'
import PaidRow from '@/components/PaidRow.vue'
import SalaryRow from '@/components/SalaryRow.vue'

/**
 * «Деньги» — вход на второй уровень (DESIGN.md §2 g6, §3; B2C-13, B2C-21): входы — Бюджет,
 * Капитал, План «Сначала долги», вклады, «История и итоги»; событие «освободится N ₸» и
 * «До зарплаты» с отметками. «Впереди», итог месяца и история семьи — `/money/history`.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const obligations = computed(() => liveObligations(financeStore.obligations))

const deposits = computed(() => liveAccounts(financeStore.accounts).filter((a) => a.kind === 'deposit'))
const entries = computed(() => [
  { to: '/money/budget', title: 'Бюджет', note: 'план месяца, календарь платежей, список', icon: PhChartBar },
  { to: '/money/capital', title: 'Капитал', note: 'счета, обязательства, кредиты', icon: PhCoins },
  { to: '/money/plan', title: 'План «Сначала долги»', note: 'шаги месяца и прогноз', icon: PhCalendarBlank },
  ...deposits.value.map((a) => ({ to: `/money/capital/${a.id}`, title: `Вклад · ${a.name}`, note: `${money(a.amount)} · проценты и график`, icon: PhPiggyBank })),
  { to: '/money/history', title: 'История и итоги', note: 'итог месяца, что впереди, моменты семьи', icon: PhClockCounterClockwise },
])

// Событие «освободится N ₸»
const freed = computed(() =>
  obligations.value.map((o) => ({ o, change: nextChange(o, key.value) })).find((x) => x.change && x.change.delta < 0),
)

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

// «Пришла зарплата» (RP-10): ближайшая зарплата — своя, и её день настал или близко.
const salaryHere = computed(() => {
  const info = paydayInfo.value
  if (!info || authStore.isViewer || authStore.slot !== info.who.id) return false
  return salaryOpen(info.who, financeStore.payments, info.key)
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <Card tight>
      <div class="flex flex-col">
        <Row v-for="e in entries" :key="e.to" :title="e.title" :note="e.note" clickable dense @click="router.push(e.to)">
          <template #icon><component :is="e.icon" :size="18" /></template>
        </Row>
      </div>
    </Card>

    <!-- Событие высвобождения средств -->
    <Card v-if="freed && freed.change" class="border-brand">
      <div class="type-section text-brand">С {{ monthFrom(freed.change.from, false) }}</div>
      <h3 class="mt-1 type-h2 text-ink">Освободится {{ money(Math.abs(freed.change.delta)) }} в месяц</h3>
      <p class="mb-3.5 mt-1 text-[13px] text-ink-2">
        {{ freed.o.name }} снизится с {{ plain(amountAt(freed.o, key)) }} до {{ plain(freed.change.amount) }} ₸.
        За год это {{ money(Math.abs(freed.change.delta) * 12) }} — решите заранее, куда они пойдут.
      </p>
      <Button v-if="!authStore.isViewer" class="w-full" @click="router.push('/week/salary?from=freed')">Распределить</Button>
      <Callout tone="neutral" class="mt-3" title="Перед экономией будет пик">
        В месяц переезда платятся депозит, комиссия и перевозка — сверх обычных расходов. Экономия начнётся только со
        следующего месяца, и приложение не будет делать вид, что это не так.
      </Callout>
    </Card>

    <!-- Блок «До зарплаты» -->
    <template v-if="paydayInfo && (paydayInfo.due.length || paydayInfo.paid.length || salaryHere)">
      <Section title="До зарплаты" />
      <Card>
        <div class="flex items-baseline gap-2">
          <span class="type-h3 text-ink">
            {{ paydayInfo.inDays === 0 ? 'Сегодня' : `Через ${paydayInfo.inDays} ${plural(paydayInfo.inDays, 'день', 'дня', 'дней')}` }}
          </span>
          <span class="ml-auto text-[13px] text-ink-3">
            {{ dayLabel(paydayInfo.day, paydayInfo.key) }}
          </span>
        </div>
        <div class="mt-0.5 text-[13px] text-ink-2">
          {{ paydayInfo.who.name }} получит {{ money(paydayInfo.income) }}
        </div>
        <SalaryRow v-if="salaryHere" button :person-id="paydayInfo.who.id" :period="paydayInfo.key" />

        <div class="mt-3 border-t border-line pt-3">
          <div class="flex items-baseline">
            <span class="text-[13px] text-ink-2">Списаний до неё</span>
            <b class="ml-auto num text-[14.5px] text-ink">{{ money(paydayInfo.dueTotal) }}</b>
          </div>
          <div class="mt-1 flex flex-col">
            <PaidRow
              v-for="d in [...paydayInfo.due, ...paydayInfo.paid]"
              :key="d.id"
              dense
              :kind="d.kind"
              :target-id="d.targetId"
              :period="d.when"
              :title="d.name"
              :note="dayLabel(d.day, d.when)"
            />
          </div>
        </div>

        <div
          v-if="paydayInfo.knowsCash"
          :class="
            cn(
              'mt-3 rounded-inner px-3.5 py-3 text-[12.5px] leading-relaxed',
              paydayInfo.shortfall >= 0 ? 'bg-brand-soft text-ink-2' : 'bg-warn-soft text-ink-2',
            )
          "
        >
          {{
            paydayInfo.shortfall >= 0
              ? `На счетах ${plain(paydayInfo.onAccounts)} ₸ — хватает, остаётся ${plain(paydayInfo.shortfall)} ₸.`
              : `На счетах ${plain(paydayInfo.onAccounts)} ₸ — не хватает ${plain(-paydayInfo.shortfall)} ₸. Перенесите платёж или возьмите из накоплений, но решите это сейчас, а не в день списания.`
          }}
        </div>
        <p v-else class="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          Хватит ли этого, приложение не знает: остаток на картах не заведён. Добавьте счёт в «Капитале» — и здесь
          появится ответ вместо списка.
        </p>
      </Card>
    </template>
  </div>
</template>
