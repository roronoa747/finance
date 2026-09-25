<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhMinus, PhPlus, PhX } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import { money, plain } from '@/lib/money'
import {
  goalMonths,
  prepayment,
  emergencyCoverage,
  amountAt,
  costliestCredits,
  liveCredits,
  liveGoals,
  liveObligations,
  lumpPlan,
  nextChange,
  planMandatory,
  planPrepays,
  stepDue,
} from '@/lib/finance'
import { monthAfter, monthFrom, monthFromAfter, monthInAfter, monthKey } from '@/lib/dates'
import { useFinanceStore } from '@/stores/finance'
import { cn, plural } from '@/lib/utils'

const STEP = 10_000

const router = useRouter()
const financeStore = useFinanceStore()

const key = computed(() => monthKey())
const people = computed(() => financeStore.people)
const goals = computed(() => liveGoals(financeStore.goals))
const credits = computed(() => liveCredits(financeStore.credits))
const obligations = computed(() => liveObligations(financeStore.obligations))

const freed = computed(() =>
  obligations.value
    .map((o) => ({ o, change: nextChange(o, key.value) }))
    .find((x) => x.change && x.change.delta < 0),
)

const total = computed(() => (freed.value?.change ? Math.abs(freed.value.change.delta) : 0))

const alloc = ref<Record<string, number>>({})
const done = ref(false)

const used = computed(() => Object.values(alloc.value).reduce((a, v) => a + v, 0))
const left = computed(() => total.value - used.value)
// Месяц списаний — тот же, что у шага плана (подушка в Ритуале есть только с планом).
const mandatory = computed(() => planMandatory(financeStore.planState(), key.value))
// Досрочка — в самый дорогой открытый долг с процентами, не в первый по порядку.
const credit = computed(() => costliestCredits(credits.value)[0])

// План «Сначала долги» (PV-16): его досрочка вносится кнопкой плана, Ритуал её только
// показывает — распределяет он «освободившееся», а у плана своя сумма.
const plan = computed(() => financeStore.activePlan)
const step = computed(() => financeStore.planStepNow())
const paused = computed(() => financeStore.pausedGoalIds)

function set(id: string, delta: number) {
  const cur = alloc.value[id] ?? 0
  if (delta > 0 && left.value < STEP) return
  alloc.value = { ...alloc.value, [id]: Math.max(0, cur + delta) }
}

function effectForGoal(goalId: string, extra: number) {
  const g = goals.value.find((x) => x.id === goalId)
  if (!g) return ''
  const remaining = Math.max(0, g.need - g.have)
  const base = goalMonths(remaining, g.monthly)
  if (!extra) return `Сейчас закрывается в ${monthInAfter(base - 1)}`
  const now = goalMonths(remaining, g.monthly + extra)
  return `${monthAfter(now - 1)} вместо ${monthFromAfter(base - 1)}. Быстрее на ${base - now} мес.`
}

function effectForCredit(extra: number) {
  if (!credit.value) return ''
  const p = prepayment(credit.value.principal, credit.value.annualRate, credit.value.payment, extra)
  if (!extra) {
    const n = Math.ceil(p.monthsNow)
    return `Сейчас: ${n} ${plural(n, 'платёж', 'платежа', 'платежей')}, переплата ${money(Math.round(p.overpayNow))}`
  }
  return `Закроется за ${Math.ceil(p.monthsAfter)} мес. вместо ${Math.ceil(p.monthsNow)}. Переплата меньше на ${money(Math.round(p.saved))}`
}

/** Корзина плана: шаг месяца (и добавка сверху) в самый дорогой долг — «сократить срок». */
function effectForPlan(extra: number) {
  const c = credit.value
  const s = step.value
  if (!c || !s || s.kind === 'done') return ''
  // Внесённый шаг мог закрыть самый дорогой долг (и тогда шагов два) — имена берём у
  // досрочек месяца, а не у нынешнего первого.
  if (s.kind === 'prepay' && s.applied && !extra) {
    const names = planPrepays(financeStore.payments, key.value).map(
      (p) => `«${financeStore.credits.find((x) => x.id === p.targetId)?.name ?? c.name}»`,
    )
    return `Шаг этого месяца внесён — ${money(s.amount)} в ${[...new Set(names)].join(' и ')}`
  }
  if (s.kind === 'cushion' && !extra) return `Шаг плана в этом месяце — подушка; досрочка в «${c.name}» — следующим шагом`
  const base = stepDue(s)?.amount ?? 0
  const head = base ? `Шаг плана — ${money(base + extra)} в «${c.name}»` : `${money(extra)} в «${c.name}»`
  const lp = lumpPlan(c.principal, c.annualRate, c.payment, base + extra, 'term')
  if (!lp) return ''
  if (lp.left === 0) return `${head}: долг закроется`
  if (lp.openEnded) return `${head}: при текущем платеже долг не закрывается — экономию не считаем`
  return `${head}: платежей останется ${lp.months} вместо ${lp.monthsBefore}, не отдадим банку ${money(lp.saved)}`
}

/** Цель на паузе ради плана (Р-9): её взнос, и добавка тоже, уходит в досрочку до конца плана. */
function effectForPaused(extra: number) {
  return extra
    ? `На паузе ради плана: +${money(extra)} пойдут в досрочку, цель ускорится после плана`
    : 'На паузе ради плана: её взнос сейчас идёт в досрочку'
}

function effectForLife(extra: number) {
  return extra
    ? `${money(extra)} в месяц на себя. Цели при этом не двигаются вперёд.`
    : 'Не ускорит цели — и это нормальный выбор, если он осознанный.'
}

// Подушка — только цель, отмеченная в плане (Р-7): по слову «подушка» не угадываем, без
// плана подушки в Ритуале нет.
const cushion = computed(() =>
  plan.value?.cushionGoalId ? goals.value.find((g) => g.id === plan.value!.cushionGoalId) : undefined,
)
// Шаг плана — подушка: её корзина первой.
const orderedGoals = computed(() =>
  step.value?.kind === 'cushion'
    ? [...goals.value.filter((g) => g.id === cushion.value?.id), ...goals.value.filter((g) => g.id !== cushion.value?.id)]
    : goals.value,
)

const pots = computed(() => [
  ...orderedGoals.value.map((g) => ({
    id: g.id,
    name: g.name,
    effect: (x: number) =>
      cushion.value && g.id === cushion.value.id
        ? `Через год покроет ${emergencyCoverage(g.have + (g.monthly + x) * 12, mandatory.value)
            .toFixed(1)
            .replace('.', ',')} мес. расходов`
        : paused.value.has(g.id)
          ? effectForPaused(x)
          : effectForGoal(g.id, x),
  })),
  ...(credit.value
    ? [
        plan.value
          ? { id: 'plan', name: 'Досрочно по плану', effect: effectForPlan }
          : { id: 'credit', name: 'Досрочно по кредиту', effect: effectForCredit },
      ]
    : []),
  { id: 'life', name: 'Качество жизни', effect: effectForLife },
])

function confirm() {
  for (const g of goals.value) {
    const extra = alloc.value[g.id] ?? 0
    if (extra > 0) {
      financeStore.setGoalMonthly(g.id, g.monthly + extra)
    }
  }
  void financeStore.syncHousehold()
  done.value = true
}
</script>

<template>
  <!-- СОСТОЯНИЕ 1: НЕТ ВЫСВОБОЖДЕНИЯ -->
  <div
    v-if="!freed?.change"
    class="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center"
  >
    <p class="text-[14px] text-ink-2">
      Сейчас нет запланированных изменений, которые высвобождают деньги. Событие появится
      само, когда у обязательства будет версия с будущей датой и меньшей суммой.
    </p>
    <Button variant="outline" @click="router.push('/')">На главную</Button>
  </div>

  <!-- СОСТОЯНИЕ 2: РЕШЕНИЕ ЗАПИСАНО -->
  <div
    v-else-if="done"
    class="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <div class="font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
      Решение записано
    </div>
    <p class="max-w-[38ch] text-[14px] leading-relaxed text-ink-2">
      Взносы по целям увеличены с {{ monthFrom(freed.change.from) }}. Когда появятся
      два аккаунта, это же решение уйдёт {{ people[1]?.name || 'партнёру' }} на подтверждение — с окном 72 часа на
      «вернуть на обсуждение», а не с блокировкой.
    </p>
    <Button @click="router.push('/')">На главную</Button>
  </div>

  <!-- СОСТОЯНИЕ 3: АКТИВНЫЙ РИТУАЛ РАСПРЕДЕЛЕНИЯ -->
  <div v-else class="flex flex-col gap-3 pt-1 text-left">
    <div class="flex items-center gap-3">
      <button
        type="button"
        aria-label="Закрыть"
        class="grid size-[34px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface-3 transition-colors cursor-pointer"
        @click="router.push('/')"
      >
        <PhX :size="19" />
      </button>
      <h2 class="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Куда направить {{ money(total) }}
      </h2>
    </div>

    <div class="flex items-baseline justify-between rounded-[14px] bg-brand-soft px-4 py-3.5">
      <span class="text-[13px] text-ink-2">Осталось распределить</span>
      <span class="font-display text-[22px] font-semibold tracking-[-0.02em] text-brand num">
        {{ money(left) }}
      </span>
    </div>

    <p v-if="step?.kind === 'cushion'" class="px-0.5 text-[13px] leading-relaxed text-ink-2 num">
      Сначала подушка: до месяца обязательных списаний не хватает {{ money(step.missing) }}.
    </p>

    <div
      v-for="p in pots"
      :key="p.id"
      :class="
        cn(
          'rounded-2xl border bg-surface p-3.5 transition-colors',
          (alloc[p.id] ?? 0) > 0 ? 'border-brand' : 'border-line',
        )
      "
    >
      <div class="flex items-center gap-3">
        <b class="flex-1 text-[14.5px] font-semibold text-ink">{{ p.name }}</b>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Убавить"
            :disabled="(alloc[p.id] ?? 0) <= 0"
            class="grid size-[30px] place-items-center rounded-[9px] border border-line bg-surface-2 text-ink-2 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
            @click="set(p.id, -STEP)"
          >
            <PhMinus :size="14" weight="bold" />
          </button>
          <span class="min-w-[62px] text-center text-[14px] font-semibold num text-ink">
            {{ plain(alloc[p.id] ?? 0) }}
          </span>
          <button
            type="button"
            aria-label="Прибавить"
            :disabled="left < STEP"
            class="grid size-[30px] place-items-center rounded-[9px] border border-line bg-surface-2 text-ink-2 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
            @click="set(p.id, STEP)"
          >
            <PhPlus :size="14" weight="bold" />
          </button>
        </div>
      </div>
      <div class="mt-2.5 border-t border-line pt-2.5 text-[12.5px] leading-snug text-ink-2">
        {{ p.effect(alloc[p.id] ?? 0) }}
      </div>
    </div>

    <p class="px-0.5 text-[12.5px] leading-relaxed text-ink-3">
      Пока решения нет, эти деньги не попадают в «свободно потратить». {{ freed.o.name }} снизится с
      {{ plain(amountAt(freed.o, key)) }} до {{ plain(freed.change.amount) }} ₸ с
      {{ monthFrom(freed.change.from) }}.
    </p>

    <Button class="mb-2 w-full" :disabled="left !== 0" @click="confirm">
      {{ left === 0 ? 'Подтвердить распределение' : `Осталось ${money(left)}` }}
    </Button>
  </div>
</template>
