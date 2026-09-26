<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhMinus, PhPlus, PhX } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'
import { money, plain } from '@/lib/money'
import {
  goalMonths,
  budgetAmounts,
  creditOutlook,
  emergencyCoverage,
  amountAt,
  costliestCredits,
  liveCredits,
  liveGoals,
  liveObligations,
  lumpPlan,
  nextChange,
  lastAccountFor,
  NO_SAVING,
  paidFor,
  payableAccounts,
  planMandatory,
  prepayOutcome,
  planPrepays,
  salaryFree,
  stepDue,
} from '@/lib/finance'
import { monthAfter, monthFrom, monthFromAfter, monthInAfter, monthKey } from '@/lib/dates'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { cn, plural, sentence } from '@/lib/utils'

const STEP = 10_000

const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const people = computed(() => financeStore.people)
const goals = computed(() => liveGoals(financeStore.goals))
const credits = computed(() => liveCredits(financeStore.credits))
const obligations = computed(() => liveObligations(financeStore.obligations))

/** Параметр адреса: откуда деньги раскладки. */
const query = (name: string) => {
  const v = route.query[name]
  return typeof v === 'string' ? v : ''
}

/** Освободившийся платёж обязательства — источник без параметров, как было. */
const freed = computed(() =>
  obligations.value
    .map((o) => ({ o, change: nextChange(o, key.value) }))
    .find((x) => x.change && x.change.delta < 0),
)

/**
 * Пришедшая зарплата (RP-10): `?from=salary&person=a&period=2026-09`. Сумма — доля
 * свободного месяца, приходящаяся на неё (finance.ts `salaryFree`); кредиты — производные,
 * как на Обзоре.
 */
const salary = computed(() => {
  if (query('from') !== 'salary') return null
  const record = paidFor(financeStore.payments, 'salary', query('person'), query('period'))
  if (!record) return null
  const free = budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits }).d5
  return { record, total: salaryFree(free, people.value, record) }
})

/** Остаток месяца (RP-11): `?from=rest&amount=50000&period=2026-09` — сумма, которую назвали. */
const rest = computed(() => {
  if (query('from') !== 'rest') return null
  return { amount: Math.max(0, Math.round(Number(query('amount')) || 0)), period: query('period') || key.value }
})

/**
 * Разовая сумма этого месяца (зарплата, остаток): решение — разовые взносы в цели,
 * ежемесячные не меняются. Освободившийся платёж повторяется каждый месяц: решение
 * прибавляет ежемесячные взносы.
 */
const once = computed(() => !!salary.value || !!rest.value)

const total = computed(() => {
  if (query('from') === 'salary') return salary.value?.total ?? 0
  if (rest.value) return rest.value.amount
  return freed.value?.change ? Math.abs(freed.value.change.delta) : 0
})

const empty = computed(() => {
  if (query('from') === 'salary') {
    return salary.value
      ? 'Свободного в этой зарплате нет: всё уже расписано планом месяца.'
      : 'Эта зарплата пока не отмечена — раскладывать нечего.'
  }
  if (rest.value) return 'Остатка нет — раскладывать нечего.'
  return 'Сейчас нет запланированных изменений, которые высвобождают деньги. Событие появится само, когда у обязательства будет версия с будущей датой и меньшей суммой.'
})

const alloc = ref<Record<string, number>>({})
const done = ref(false)
const doneNote = ref('')

const used = computed(() => Object.values(alloc.value).reduce((a, v) => a + v, 0))
const left = computed(() => total.value - used.value)
/** Сколько разложено по целям — у разового решения это взносы со счёта. */
const toGoals = computed(() => goals.value.reduce((a, g) => a + (alloc.value[g.id] ?? 0), 0))

/**
 * Откуда отложить разовые взносы: по умолчанию — счёт, куда пришла зарплата (Р-5), у
 * остатка — куда приходит своя зарплата; не знаем — спросить (undefined). «Не двигать» —
 * взносы только в целях, как без счёта в окне цели.
 */
const picked = ref<string | null | undefined>(undefined)
const fromAccount = computed<string | null | undefined>({
  get: () => {
    if (picked.value !== undefined) return picked.value
    if (salary.value) return salary.value.record.accountId
    return authStore.slot ? lastAccountFor(financeStore.payments, authStore.slot, financeStore.accounts) : undefined
  },
  set: (v) => {
    picked.value = v
  },
})
/** Разовые взносы без выбранного счёта не записываются: деньги посчитались бы дважды. */
const needAccount = computed(() => once.value && toGoals.value > 0 && fromAccount.value === undefined)
const accountChoices = computed(() => payableAccounts(financeStore.accounts))
// Месяц списаний — тот же, что у шага плана (подушка в Ритуале есть только с планом).
const mandatory = computed(() => planMandatory(financeStore.planState(), key.value))
// Досрочка — в самый дорогой открытый долг с процентами, не в первый по порядку.
const credit = computed(() => costliestCredits(credits.value)[0])

// План «Сначала долги» (PV-16): его досрочка вносится кнопкой плана, Ритуал её только
// показывает — распределяет он «освободившееся», а у плана своя сумма.
const plan = computed(() => financeStore.activePlan)
const step = computed(() => financeStore.planStepNow())
const paused = computed(() => financeStore.pausedGoalIds)

// Шаг — 10 000; последний забирает остаток, иначе сумма не кратная шагу (доля зарплаты)
// не раскладывалась бы до нуля и подтвердить было бы нельзя.
function set(id: string, delta: number) {
  const cur = alloc.value[id] ?? 0
  const d = delta > 0 ? Math.min(delta, left.value) : delta
  if (d > 0 || cur > 0) alloc.value = { ...alloc.value, [id]: Math.max(0, cur + d) }
}

function effectForGoal(goalId: string, extra: number) {
  const g = goals.value.find((x) => x.id === goalId)
  if (!g) return ''
  const remaining = Math.max(0, g.need - g.have)
  const base = goalMonths(remaining, g.monthly)
  if (once.value && extra) {
    // Разовый взнос: остаток цели меньше, ежемесячный взнос тот же.
    if (extra >= remaining) return 'Цель соберётся целиком'
    const now = goalMonths(remaining - extra, g.monthly)
    if (!Number.isFinite(base) || now === base) return `Останется собрать ${money(remaining - extra)}`
    return `${monthAfter(now - 1)} вместо ${monthFromAfter(base - 1)}. Быстрее на ${base - now} мес.`
  }
  if (!extra) return `Сейчас закрывается в ${monthInAfter(base - 1)}`
  const now = goalMonths(remaining, g.monthly + extra)
  return `${monthAfter(now - 1)} вместо ${monthFromAfter(base - 1)}. Быстрее на ${base - now} мес.`
}

// Сроки и деньги — `creditOutlook` / `prepayOutcome` (целые, без «Infinity»); платёж не
// покрывает проценты — текст Р-11, как в окне досрочки и на экране плана.
function effectForCredit(extra: number) {
  if (!credit.value) return ''
  if (!extra) {
    const now = creditOutlook(credit.value)
    if (!now.closes) return `Сейчас: ${NO_SAVING}`
    return `Сейчас: ${now.months} ${plural(now.months, 'платёж', 'платежа', 'платежей')}, переплата ${money(now.overpay)}`
  }
  const p = prepayOutcome(credit.value, extra, once.value ? 'once' : 'monthly')
  if (!p) return sentence(NO_SAVING)
  return `Закроется за ${p.monthsAfter} мес. вместо ${p.monthsNow}. Переплата меньше на ${money(p.saved)}`
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
  if (lp.openEnded) return `${head}: ${NO_SAVING}`
  return `${head}: платежей останется ${lp.months} вместо ${lp.monthsBefore}, не отдадим банку ${money(lp.saved)}`
}

/** Цель на паузе ради плана (Р-9): её взнос, и добавка тоже, уходит в досрочку до конца плана. */
function effectForPaused(extra: number) {
  if (extra && once.value) return `На паузе ради плана: ${money(extra)} лягут в цель сейчас, её взнос пока идёт в досрочку`
  return extra
    ? `На паузе ради плана: +${money(extra)} пойдут в досрочку, цель ускорится после плана`
    : 'На паузе ради плана: её взнос сейчас идёт в досрочку'
}

function effectForLife(extra: number) {
  if (extra && once.value) return `${money(extra)} на себя в этом месяце. Цели при этом не двигаются вперёд.`
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
        ? `Через год покроет ${emergencyCoverage(g.have + g.monthly * 12 + (once.value ? x : x * 12), mandatory.value)
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
  if (once.value) {
    // Разовое решение: взносы в цели сейчас и сдвиг остатка выбранного счёта — как взнос в
    // окне цели. Досрочка и «качество жизни» не записываются (вне скоупа RP-10).
    if (needAccount.value) return
    const by = authStore.slot ?? 'a'
    const note = rest.value ? 'из остатка месяца' : 'из зарплаты'
    for (const g of goals.value) {
      const extra = alloc.value[g.id] ?? 0
      if (extra > 0) financeStore.contribute(g.id, extra, by, note)
    }
    const acc = fromAccount.value ? financeStore.accounts.find((a) => a.id === fromAccount.value) : undefined
    if (acc && toGoals.value > 0) financeStore.shiftAccountAmount(acc.id, -toGoals.value)
    doneNote.value = toGoals.value
      ? `В цели отложено ${money(toGoals.value)}${acc ? ` со счёта «${acc.name}»` : ''} — взносы видны в истории целей. Ежемесячные взносы не менялись.`
      : 'Цели не тронуты, ежемесячные взносы не менялись.'
  } else {
    for (const g of goals.value) {
      const extra = alloc.value[g.id] ?? 0
      if (extra > 0) {
        financeStore.setGoalMonthly(g.id, g.monthly + extra)
      }
    }
  }
  void financeStore.syncHousehold()
  done.value = true
}

// После разового решения назад в раскладку не вернуться: второе подтверждение отложило бы
// те же деньги ещё раз.
function home() {
  if (once.value) void router.replace('/')
  else void router.push('/')
}
</script>

<template>
  <!-- СОСТОЯНИЕ 1: РАСКЛАДЫВАТЬ НЕЧЕГО -->
  <div
    v-if="total <= 0 && !done"
    class="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center"
  >
    <p class="text-[14px] text-ink-2">{{ empty }}</p>
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
    <p v-if="once" class="max-w-[38ch] text-[14px] leading-relaxed text-ink-2 num">{{ doneNote }}</p>
    <p v-else-if="freed?.change" class="max-w-[38ch] text-[14px] leading-relaxed text-ink-2">
      Взносы по целям увеличены с {{ monthFrom(freed.change.from) }}. Когда появятся
      два аккаунта, это же решение уйдёт {{ people[1]?.name || 'партнёру' }} на подтверждение — с окном 72 часа на
      «вернуть на обсуждение», а не с блокировкой.
    </p>
    <Button @click="home">На главную</Button>
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

    <p v-if="salary" class="px-0.5 text-[13px] leading-relaxed text-ink-2 num">
      Зарплата пришла — {{ money(salary.record.amount) }}. Свободно из неё {{ money(total) }}: остальное
      уже расписано планом месяца.
    </p>
    <p v-else-if="rest" class="px-0.5 text-[13px] leading-relaxed text-ink-2 num">
      Остаток {{ monthFrom(rest.period, false) }} — {{ money(total) }}. Разложим его, пока он незаметно не разошёлся.
    </p>

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
            :disabled="left <= 0"
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

    <AccountChoice
      v-if="once && toGoals > 0"
      v-model="fromAccount"
      :accounts="accountChoices"
      label="Откуда отложить в цели"
      none="Не двигать остаток счёта"
    />

    <p v-if="once" class="px-0.5 text-[12.5px] leading-relaxed text-ink-3">
      Решение разовое: отложенное ляжет в цели сейчас, ежемесячные взносы не изменятся.
    </p>
    <p v-else-if="freed?.change" class="px-0.5 text-[12.5px] leading-relaxed text-ink-3">
      Пока решения нет, эти деньги не попадают в «свободно потратить». {{ freed.o.name }} снизится с
      {{ plain(amountAt(freed.o, key)) }} до {{ plain(freed.change.amount) }} ₸ с
      {{ monthFrom(freed.change.from) }}.
    </p>

    <Button class="mb-2 w-full" :disabled="left !== 0 || needAccount" @click="confirm">
      {{ left !== 0 ? `Осталось ${money(left)}` : needAccount ? 'Выберите, откуда отложить' : 'Подтвердить распределение' }}
    </Button>
  </div>
</template>
