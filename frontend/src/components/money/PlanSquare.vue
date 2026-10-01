<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretDown } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, ratePct } from '@/lib/money'
import { MONTHS_GEN, monthIn, monthKey, monthShort, monthTitle, parseMonthKey } from '@/lib/dates'
import {
  NO_SAVING,
  amountTotal,
  budgetInterest,
  debtAdvice,
  liveCredits,
  liveGoals,
  openCredits,
  pauseMissed,
  pauseShift,
  liveObligations,
  planFact,
  planMonths,
  planOutlook,
  planPrepays,
  planStartMonth,
  prepaySaved,
  stepDue,
} from '@/lib/finance'
import type { DebtPlan } from '@/types/finance'
import { cn } from '@/lib/utils'

import Card from '@/components/kit/Card.vue'
import Callout from '@/components/kit/Callout.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Button from '@/components/ui/Button.vue'
import { buttonVariants } from '@/components/ui/button'
import StrategyCompare from '@/components/StrategyCompare.vue'
import PlanStepAction from '@/components/PlanStepAction.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'

/**
 * Квадрат «План» (пивот 3, Р-34; макет `pivot-3/index.html`, «План»): «Самая дорогая ставка»
 * (бывшее «Что гасить первым») и «Сначала долги» с переключателем — шаг месяца, прогноз одной
 * строкой, «Шаг сделан», цели на паузе. «Копить или гасить?» и «Шаги по месяцам» (с историей
 * планов, Р-39) — свёрнуты. Всё считает `finance.ts`; график долга — только в листе кредита.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const credits = computed(() => liveCredits(financeStore.credits))
const open = computed(() => openCredits(credits.value))
const goals = computed(() => liveGoals(financeStore.goals))
const creditName = (id: string | null) => financeStore.credits.find((c) => c.id === id)?.name ?? ''

/* ------------------ Самая дорогая ставка ------------------ */
const advice = computed(() => debtAdvice(credits.value))
const worst = computed(() => advice.value.worstDebt)
const interestAll = computed(() => budgetInterest(credits.value))
const savedAll = computed(() => prepaySaved(financeStore.payments, financeStore.credits))
const payoffCreditId = ref<string | null>(null)
const payoffPlan = ref<{ id: string; amount: number; creditId: string } | null>(null)

/* ------------------ Сначала долги ------------------ */
const plan = computed(() => financeStore.activePlan)
const state = computed(() => financeStore.planState())
const step = computed(() => financeStore.planStepNow())
const due = computed(() => stepDue(step.value))
/** Шаг есть: подушка, внесён или ждёт досрочки (на паузе нет взносов — шага «0 ₸» нет). */
const showStep = computed(() => !!step.value && step.value.kind !== 'done' && (step.value.kind === 'cushion' || !!step.value.applied || !!due.value))
// Досрочки плана этого месяца: шаг закрыл долг — остаток идёт вторым шагом в следующий.
const monthPaid = computed(() => planPrepays(financeStore.payments, key.value))
const outlook = computed(() => (plan.value ? planOutlook(plan.value, state.value, key.value) : null))
const fact = computed(() => (plan.value ? planFact(plan.value, financeStore.payments, financeStore.credits) : null))
const paused = computed(() => goals.value.filter((g) => financeStore.pausedGoalIds.has(g.id)))
const cushion = computed(() => (plan.value?.cushionGoalId ? goals.value.find((g) => g.id === plan.value!.cushionGoalId) : undefined))

/** Вид шага одной строкой (`planStepNow`). */
const stepText = computed(() => {
  const s = step.value
  if (!s || s.kind === 'done') return 'готово'
  if (s.kind === 'cushion') return `сначала подушка: не хватает ${money(s.missing)}`
  if (s.applied) return `внесено по плану · ${money(s.amount)}`
  return `${money(s.amount)} досрочно`
})

/** Прогноз одной строкой: срок, на сколько раньше, переплата без плана → с ним, уже сэкономили. */
const forecastText = computed(() => {
  const o = outlook.value
  if (!o) return ''
  const saved = `Уже сэкономили ${money(fact.value?.savedInterest ?? 0)}.`
  if (o.monthsSooner === null || o.debtFreeMonth === null) return `Прогноз: ${NO_SAVING}. ${saved}`
  const sooner = o.monthsSooner > 0 ? `, на ${o.monthsSooner} мес. раньше` : ''
  return `Закроется в ${monthIn(o.debtFreeMonth)}${sooner}. Переплата ${plain(o.overpayWithout!)} → ${money(o.overpayWith!)}. ${saved}`
})

/* ------------------ Шаги по месяцам и история (Р-39) ------------------ */
const months = computed(() => (plan.value ? planMonths(plan.value, state.value, key.value) : []))
/** Прошлый месяц плана без досрочки — одна строка без упрёка (Р-4): план уже пересчитан от факта. */
const missed = computed(() => {
  const prev = months.value.at(-2)
  return prev && !prev.fact && !prev.cushion ? prev.period : null
})
const endMonth = (p: DebtPlan) => monthKey(new Date(p.endedAt ?? p.updatedAt))
const history = computed(() =>
  financeStore.plans.filter((p) => !p.deletedAt && p.status !== 'active').sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '')),
)
/** Итог плана — живым счётом его досрочек, а не снимком `result` (Р-5). */
const savedOf = (p: DebtPlan) => planFact(p, financeStore.payments, financeStore.credits).savedInterest
function historyLine(p: DebtPlan): string {
  const from = planStartMonth(p)
  const to = endMonth(p)
  const span = from === to ? monthTitle(from) : `${monthTitle(from)} — ${monthTitle(to)}`
  const saved = money(savedOf(p))
  return p.status === 'done' ? `${span}: сэкономили ${saved} процентов` : `${span}: отменён, сэкономили ${saved}`
}
// План закрылся в этом месяце — цели уже возобновились (Р-5): скажем, пока месяц не кончился.
const justDone = computed(() => {
  const last = history.value[0]
  return !plan.value && last?.status === 'done' && endMonth(last) === key.value ? last : null
})

/** Свёрнутая строка карточки (макет: «Копить или гасить?», «Шаги по месяцам» — слева, стрелка вниз). */
const FOLD_ROW = 'flex w-full cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden'
const FOLD = `${FOLD_ROW} border-t border-line pt-3`

/* ------------------ Переключатель ------------------ */
const compareOpen = ref(false)
const compareEl = ref<HTMLElement | null>(null)
const cancelOpen = ref(false)

/** Включить — раскрыть «Копить или гасить?» и прокрутить к нему; выключить — с подтверждением. */
async function onToggle(on: boolean) {
  if (authStore.isViewer) return
  if (!on) {
    cancelOpen.value = true
    return
  }
  compareOpen.value = true
  await nextTick()
  compareEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function cancelPlan() {
  financeStore.cancelPlan()
  cancelOpen.value = false
}
function choosePlan(opts: { keptGoalIds: string[]; cushionGoalId: string | null; months: 12 | 24 | 36; lump: number }) {
  if (financeStore.choosePlan(opts, authStore.slot ?? 'a')) compareOpen.value = false
}

/** «Изменить режим»: окно досрочки с суммой шага — там можно «снизить платёж» (Р-10); запись — с id плана. */
function changeMode() {
  const s = due.value
  if (!s || !plan.value) return
  payoffPlan.value = { id: plan.value.id, amount: s.amount, creditId: s.creditId }
  payoffCreditId.value = s.creditId
}
</script>

<template>
  <!-- План закрыл последний долг: поздравление и прошлые планы видны и без долгов (как в прежнем экране плана) -->
  <Callout v-if="justDone" tone="ok" title="Долги с процентами закрыты — цели возобновились">
    Сэкономили {{ money(savedOf(justDone)) }} процентов.
  </Callout>

  <template v-if="!open.length && !plan">
    <EmptyState title="Долгов нет" />
    <Card v-if="history.length" tight>
      <details>
        <summary :class="FOLD_ROW">Прошлые планы<PhCaretDown :size="16" class="shrink-0 text-ink-3" /></summary>
        <div class="mt-2 flex flex-col gap-1.5 text-[12.5px] text-ink-2 num">
          <div v-for="p in history" :key="p.id">{{ historyLine(p) }}</div>
        </div>
      </details>
    </Card>
  </template>

  <template v-else>

    <!-- Самая дорогая ставка -->
    <Card tight class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <span class="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">Самая дорогая ставка</span>
        <Tag v-if="worst" class="num">{{ ratePct(worst.credit.annualRate, 0).replace('%', ' %') }}</Tag>
      </div>
      <template v-if="worst">
        <div class="flex items-baseline justify-between gap-3">
          <span class="min-w-0 truncate type-h3 text-ink">{{ worst.credit.name }}</span>
          <span class="shrink-0 text-[15px] font-semibold num text-ink">{{ money(worst.credit.principal) }}</span>
        </div>
        <div class="type-meta num">
          процентов в месяц {{ plain(worst.cost.monthlyInterest) }} ·
          {{ worst.cost.closes ? `переплата до конца ${plain(worst.cost.overpay)}` : 'долг не закрывается' }}
        </div>
      </template>
      <div v-else class="type-meta">Долгов с процентами нет</div>
      <p v-if="advice.unknownRate.length" class="type-meta">
        Ставку {{ advice.unknownRate.map((c) => `«${c.name}»`).join(', ') }} уточните — тогда сравним.
      </p>

      <!-- Цифры и расчёты — свёрнуты (правило 12) -->
      <details v-if="worst">
        <summary :class="cn(buttonVariants({ variant: 'ghost' }), 'flex w-full list-none [&::-webkit-details-marker]:hidden')">Подробнее</summary>
        <div class="mt-1 flex flex-col gap-1.5 text-[13px]">
          <div class="flex justify-between">
            <span class="text-ink-2">Доля платежа в проценты</span>
            <b class="num text-ink">{{ worst.cost.sharePct }}%</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Проценты банку по всем долгам</span>
            <b class="num text-ink">{{ money(interestAll) }} в месяц</b>
          </div>
          <!-- При плане сэкономленное — одним числом в строке прогноза, второго рядом нет -->
          <div v-if="!plan && savedAll > 0" class="flex justify-between">
            <span class="text-ink-2">Досрочками уже сэкономили</span>
            <b class="num text-brand">{{ money(savedAll) }}</b>
          </div>
          <p class="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            {{
              worst.cost.sharePct >= 50
                ? 'Больше половины платежа уходит в проценты, поэтому остаток почти не двигается. Такой долг выгоднее закрыть раньше остальных, даже если он самый маленький.'
                : 'Здесь самая высокая ставка из ваших долгов, поэтому каждый лишний тенге, внесённый сюда, экономит больше, чем в любом другом.'
            }}
          </p>
          <div v-if="advice.worstGain && advice.worstHalfExtra" class="mt-1 rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
            <div class="text-[12.5px] text-ink-2">Половину переплаты снимает добавка</div>
            <div class="mt-1 type-h3 num text-brand">{{ money(advice.worstHalfExtra) }} в месяц</div>
            <div class="mt-0.5 text-[13px] text-ink-2 num">
              это минус {{ advice.worstGain.monthsSaved }} мес. и экономия {{ money(advice.worstGain.saved) }}
            </div>
          </div>
          <Button variant="secondary" class="mt-1 w-full" @click="payoffCreditId = worst.credit.id">Посчитать на свою сумму</Button>
        </div>
      </details>
    </Card>

    <!-- Сначала долги -->
    <Card v-if="worst || plan || history.length" tight class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between gap-3">
        <span class="type-h3 text-ink">Сначала долги</span>
        <Toggle :model-value="!!plan" label="Сначала долги" :disabled="authStore.isViewer" @update:model-value="onToggle" />
      </div>

      <template v-if="plan">
        <div class="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-ink-2">
          <div v-if="showStep" class="flex items-baseline justify-between gap-3">
            <b class="text-ink">Шаг {{ MONTHS_GEN[parseMonthKey(key).month] }}</b>
            <span class="num text-right">{{ stepText }}</span>
          </div>
          <p v-if="showStep && step && step.kind === 'prepay' && !step.applied" class="mt-0.5 text-[12.5px] num">
            в «{{ creditName(step.creditId) }}»<template v-if="monthPaid.length">; уже внесено {{ money(amountTotal(monthPaid)) }} — «{{ creditName(monthPaid.at(-1)!.targetId) }}» закрыт</template>
          </p>
          <p v-for="p in step && step.kind === 'prepay' && step.applied ? monthPaid : []" :key="p.id" class="mt-0.5 text-[12.5px] num">
            {{ money(p.amount) }} в «{{ creditName(p.targetId) }}»
          </p>
          <p class="mt-1 leading-relaxed num">{{ forecastText }}</p>
          <p v-if="missed" class="mt-1 text-[12.5px]">В {{ monthIn(missed, false) }} досрочки не было — план пересчитан от факта.</p>
        </div>

        <div v-if="!authStore.isViewer && step && (due || step.kind === 'cushion')" class="flex gap-2">
          <Button v-if="step.kind === 'cushion'" class="flex-1" @click="router.push(`/goals/${step.goalId}`)">Пополнить подушку</Button>
          <template v-else>
            <PlanStepAction primary />
            <Button variant="ghost" @click="changeMode">Изменить режим</Button>
          </template>
        </div>

        <div class="flex flex-col">
          <Row
            v-if="paused.length"
            dense
            title="Цели на паузе"
            :note="`${paused.map((g) => g.name).join(', ')} · взнос идёт в долг`"
            clickable
            @click="router.push(`/goals/${paused[0].id}`)"
          />
          <Row v-if="cushion" dense title="Подушка плана" :note="cushion.name" />
        </div>
      </template>

      <!-- Свёрнутое: сравнение и шаги по месяцам -->
      <details ref="compareEl" :open="compareOpen || undefined" @toggle="(e: Event) => (compareOpen = (e.target as HTMLDetailsElement).open)">
        <summary :class="FOLD">Копить или гасить?<PhCaretDown :size="16" class="shrink-0 text-ink-3" /></summary>
        <div class="mt-2">
          <StrategyCompare
            :credits="open"
            :goals="goals"
            :obligations="liveObligations(financeStore.obligations)"
            :month-key="key"
            :payments="financeStore.payments"
            :plan="plan"
            :can-choose="!authStore.isViewer"
            @choose="choosePlan"
          />
        </div>
      </details>

      <details v-if="plan || history.length">
        <summary :class="FOLD">Шаги по месяцам<PhCaretDown :size="16" class="shrink-0 text-ink-3" /></summary>
        <div class="mt-2 flex flex-col gap-3 text-[12.5px]">
          <div v-if="plan" class="grid grid-cols-[auto_1fr_1fr_auto] items-baseline gap-x-3 gap-y-1.5 num">
            <span class="text-ink-3">Месяц</span>
            <span class="text-right text-ink-3">План</span>
            <span class="text-right text-ink-3">Факт</span>
            <span class="text-ink-3">Куда</span>
            <template v-for="m in months" :key="m.period">
              <span :class="cn(m.period === key ? 'font-semibold text-brand' : 'text-ink-2')">{{ monthShort(m.period) }}</span>
              <span class="text-right text-ink">{{ money(m.planned) }}</span>
              <span :class="cn('text-right', m.fact ? 'text-ink' : 'text-ink-3')">{{ m.fact ? money(m.fact) : '—' }}</span>
              <span class="truncate text-ink-2">{{ m.cushion ? 'в подушку' : creditName(m.creditId) || '—' }}</span>
            </template>
          </div>
          <p v-for="g in plan ? paused : []" :key="g.id" class="text-ink-2 num">
            «{{ g.name }}»: {{ money(pauseMissed(plan!, g, key)) }} не внесено, дата сдвинулась на {{ pauseShift(plan!, g, key) }} мес.
          </p>
          <p v-if="plan" class="text-ink-2 num">
            При выборе ожидали:
            <template v-if="plan.forecast.savedInterest === null">{{ NO_SAVING }}</template>
            <template v-else>не отдадим банку {{ money(plan.forecast.savedInterest) }}</template>
          </p>
          <div v-if="history.length" class="flex flex-col gap-1.5 border-t border-line pt-2.5 text-ink-2 num">
            <div v-for="p in history" :key="p.id">{{ historyLine(p) }}</div>
          </div>
        </div>
      </details>
    </Card>
  </template>

  <!-- Выключить план — подтверждение -->
  <Sheet :open="cancelOpen" title="Выключить план?" @close="cancelOpen = false">
    <p class="mb-4 text-[14px] text-ink-2">Цели возобновятся, история плана останется.</p>
    <Button variant="destructive" class="mb-2 w-full" @click="cancelPlan">Отменить план</Button>
    <Button variant="ghost" class="w-full" @click="cancelOpen = false">Оставить</Button>
  </Sheet>

  <PayoffSheet
    :credit-id="payoffCreditId"
    :plan="payoffPlan"
    @close="
      payoffCreditId = null;
      payoffPlan = null;
    "
  />
</template>
