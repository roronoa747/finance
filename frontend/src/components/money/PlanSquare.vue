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
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Button from '@/components/ui/Button.vue'
import StrategyCompare from '@/components/StrategyCompare.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'

/**
 * Долговой план — экран «Закрыть быстрее» (Б17; до него — раскрывашка «Долгов», Р-110; квадрат «План» — Р-34). Сверху —
 * переключатель «Сначала долги» и одна крупная цифра «на N мес. раньше»; «Самая дорогая ставка», проценты, своя сумма,
 * «Копить или гасить?» и «Шаги по месяцам» — за «Подробнее». Прежде: «Самая дорогая ставка»
 * (бывшее «Что гасить первым») и «Сначала долги» с переключателем — шаг месяца, прогноз одной
 * строкой, цели на паузе. Блок 16 (Р-110): весь квадрат — внутри свёрнутого «Как закрыть быстрее ›» экрана «Долги»
 * (`DebtsWidget`); «Шаг сделан» и «Изменить режим» убраны — шаг месяца записывает «Отложил» у строки долга в «Месяце». «Копить или гасить?» и «Шаги по месяцам» (с историей
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

/** Под крупной цифрой — шаг месяца одной строкой: сколько и в какой долг (Б17, макет). */
const stepLine = computed(() => {
  const s = step.value
  if (s && s.kind === 'prepay' && !s.applied) {
    const c = financeStore.credits.find((x) => x.id === s.creditId)
    return c ? `${money(s.amount)} → ${c.name} · ${ratePct(c.annualRate, 0).replace('%', ' %')}` : stepText.value
  }
  return stepText.value
})

/**
 * Прогноз одной строкой: срок, на сколько раньше, переплата без плана → с ним, уже сэкономили.
 * До первой досрочки «Уже сэкономили 0 ₸» не печатается: ноль ничего не сообщает (правило 12).
 */
const forecastText = computed(() => {
  const o = outlook.value
  if (!o) return ''
  const savedInterest = fact.value?.savedInterest ?? 0
  const saved = savedInterest > 0 ? ` Уже сэкономили ${money(savedInterest)}.` : ''
  if (o.monthsSooner === null || o.debtFreeMonth === null) return `Прогноз: ${NO_SAVING}.${saved}`
  const sooner = o.monthsSooner > 0 ? `, на ${o.monthsSooner} мес. раньше` : ''
  return `Закроется в ${monthIn(o.debtFreeMonth)}${sooner}. Переплата ${plain(o.overpayWithout!)} → ${money(o.overpayWith!)}.${saved}`
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
const moreOpen = ref(false)
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
  moreOpen.value = true
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
</script>

<template>
  <!-- План закрыл последний долг: поздравление и прошлые планы видны и без долгов (как в прежнем экране плана) -->
  <Callout v-if="justDone" tone="ok" title="Долги с процентами закрыты — цели возобновились">
    Сэкономили {{ money(savedOf(justDone)) }} процентов.
  </Callout>

  <template v-if="!open.length && !plan">
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
    <!-- Главное (Б17, макет): один переключатель «Сначала долги» и одна крупная цифра — на сколько раньше. -->
    <Card v-if="worst || plan || history.length" tight class="flex flex-col gap-2.5" data-plan-main>
      <div class="flex items-center justify-between gap-3">
        <span class="type-h3 text-ink">Сначала долги</span>
        <Toggle :model-value="!!plan" label="Сначала долги" :disabled="authStore.isViewer" @update:model-value="onToggle" />
      </div>
      <template v-if="plan && outlook">
        <span v-if="outlook.monthsSooner" class="font-num text-[34px] font-bold leading-none num text-ink" data-plan-sooner>на {{ outlook.monthsSooner }} мес. раньше</span>
        <span v-else-if="outlook.debtFreeMonth" class="font-num text-[24px] font-bold leading-tight num text-ink" data-plan-sooner>Закроется в {{ monthIn(outlook.debtFreeMonth) }}</span>
        <span v-if="showStep" class="text-[14.5px] text-ink-2 num" data-plan-step>{{ stepLine }}</span>
      </template>
      <span v-else-if="worst" class="text-[14.5px] text-ink-2 num" data-plan-worst>
        Самая дорогая — {{ worst.credit.name }} · {{ ratePct(worst.credit.annualRate, 0).replace('%', ' %') }}
      </span>
      <span v-else-if="!plan" class="type-meta">Долгов с процентами нет</span>
      <p v-if="advice.unknownRate.length" class="type-meta">
        Ставку {{ advice.unknownRate.map((c) => `«${c.name}»`).join(', ') }} уточните — тогда сравним.
      </p>
      <!-- Шаг месяца записывает «Отложил» у строки долга в «Месяце» (Р-110): кнопки шага здесь нет -->
      <Button v-if="!authStore.isViewer && plan && step && step.kind === 'cushion'" variant="secondary" size="md" class="w-full" @click="router.push(`/goals/${step.goalId}`)">Пополнить подушку</Button>
    </Card>

    <Card v-if="plan && (paused.length || cushion)" flush>
      <Row
        v-if="paused.length"
        title="Цели на паузе"
        :note="paused.map((g) => g.name).join(', ')"
        clickable
        @click="router.push(`/goals/${paused[0].id}`)"
      />
      <Row v-if="cushion" title="Подушка плана" :note="cushion.name" />
    </Card>

    <!-- Подробнее — свёрнуто (правило 12): ставки и проценты, своя сумма, «Копить или гасить?», шаги по месяцам. -->
    <Card tight>
      <details :open="moreOpen || undefined" data-plan-more @toggle="(e: Event) => (moreOpen = (e.target as HTMLDetailsElement).open)">
        <summary :class="FOLD_ROW">Подробнее<PhCaretDown :size="16" class="shrink-0 text-ink-3" /></summary>
        <div class="mt-3 flex flex-col gap-3">
          <!-- Самая дорогая ставка — цифрами; абзац и розовый блок — убраны (Б17) -->
          <div v-if="worst" class="flex flex-col gap-1.5 text-[13.5px]" data-plan-worst-detail>
            <span class="type-label">Самая дорогая ставка</span>
            <div class="flex items-baseline justify-between gap-3">
              <span class="min-w-0 truncate font-semibold text-ink">{{ worst.credit.name }} · {{ ratePct(worst.credit.annualRate, 0).replace('%', ' %') }}</span>
              <span class="shrink-0 font-semibold num text-ink">{{ money(worst.credit.principal) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">Процентов в месяц</span>
              <b class="num text-ink">{{ money(worst.cost.monthlyInterest) }}</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">{{ worst.cost.closes ? 'Переплата до конца' : 'Долг не закрывается' }}</span>
              <b v-if="worst.cost.closes" class="num text-ink">{{ money(worst.cost.overpay) }}</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">Доля платежа в проценты</span>
              <b class="num text-ink">{{ worst.cost.sharePct }}%</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">Проценты банку по всем долгам</span>
              <b class="num text-ink">{{ money(interestAll) }} в месяц</b>
            </div>
            <!-- При плане сэкономленное — одним числом в прогнозе ниже, второго рядом нет -->
            <div v-if="!plan && savedAll > 0" class="flex justify-between">
              <span class="text-ink-2">Досрочками уже сэкономили</span>
              <b class="num text-ok">{{ money(savedAll) }}</b>
            </div>
            <template v-if="advice.worstGain && advice.worstHalfExtra">
              <div class="flex justify-between gap-3" data-plan-half>
                <span class="text-ink-2">Половину переплаты снимет добавка</span>
                <b class="num text-ink">{{ money(advice.worstHalfExtra) }} в месяц</b>
              </div>
              <p class="text-[12.5px] text-ink-2 num">это минус {{ advice.worstGain.monthsSaved }} мес. и экономия {{ money(advice.worstGain.saved) }}</p>
            </template>
            <Button variant="ghost" size="md" class="-mx-2 self-start" @click="payoffCreditId = worst.credit.id">Посчитать на свою сумму</Button>
          </div>

          <div v-if="plan" class="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-ink-2" data-plan-forecast>
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
                <span class="text-ink-2">Месяц</span>
                <span class="text-right text-ink-2">План</span>
                <span class="text-right text-ink-2">Факт</span>
                <span class="text-ink-2">Куда</span>
                <template v-for="m in months" :key="m.period">
                  <span :class="cn(m.period === key ? 'font-semibold text-brand' : 'text-ink-2')">{{ monthShort(m.period) }}</span>
                  <span class="text-right text-ink">{{ money(m.planned) }}</span>
                  <span :class="cn('text-right', m.fact ? 'text-ink' : 'text-ink-2')">{{ m.fact ? money(m.fact) : '—' }}</span>
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

  <PayoffSheet :credit-id="payoffCreditId" @close="payoffCreditId = null" />
</template>
