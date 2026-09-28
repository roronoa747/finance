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
  cushionInYear,
  emergencyCoverage,
  amountAt,
  costliestCredits,
  freedChange,
  liveCredits,
  liveGoals,
  liveObligations,
  lumpPlan,
  movementMonth,
  lastAccountFor,
  NO_SAVING,
  paidFor,
  payableAccounts,
  planMandatory,
  prepayOutcome,
  planPrepays,
  progressMoments,
  salaryFree,
  stepDue,
  allocationFor,
  closerWish,
  goalRemaining,
} from '@/lib/finance'
import { atLabel, monthAfter, monthFrom, monthFromAfter, monthInAfter, monthKey } from '@/lib/dates'
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

/**
 * Освободившийся платёж обязательства — `?from=freed` («Деньги») или без параметров, как было.
 * Сумма в месяц — `freedChange` (у годового — двенадцатая часть разницы). У зарплаты, остатка
 * и закрытого долга его нет: иначе они показали бы чужое «Уже разложено» и абзац обязательства.
 */
const freed = computed(() =>
  ['salary', 'rest', 'credit'].includes(query('from')) ? null : freedChange(obligations.value, key.value),
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
  // План месяца этой зарплаты — у пришедшей за прошлый месяц свой оклад и свои платежи.
  const free = budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits }, record.period).d5
  return { record, total: salaryFree(free, people.value, record) }
})

/**
 * Закрытый долг (RP-12): `?from=credit&credit=<id>` — освободился его платёж, каждый месяц.
 * Сумма — из момента прогресса (`progressMoments`, кредиты — из документа). Платёж долга из
 * активного плана «Сначала долги» уже идёт в следующий долг — раскладывать нечего.
 */
const closed = computed(() => {
  if (query('from') !== 'credit') return null
  const m = progressMoments({
    credits: financeStore.householdDoc.credits,
    goals: financeStore.goals,
    payments: financeStore.payments,
  }).find((x) => x.kind === 'closed' && x.creditId === query('credit'))
  return m?.kind === 'closed' ? { ...m, inPlan: !!financeStore.activePlan?.creditIds.includes(m.creditId) } : null
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

/** Источник раскладки — ключ записи решения (B2C-21): второй заход и партнёр видят записанное. */
const srcKey = computed(() => {
  if (salary.value) return { source: 'salary' as const, sourceId: query('person'), period: query('period') || key.value }
  if (rest.value) return { source: 'rest' as const, sourceId: rest.value.period, period: rest.value.period }
  // Долг закрывается один раз — период записи — месяц закрытия, а не текущий: иначе в следующем
  // месяце раскладка открылась бы снова и ежемесячный взнос вырос бы второй раз.
  if (closed.value) return { source: 'freed' as const, sourceId: closed.value.creditId, period: movementMonth(closed.value.at) }
  if (freed.value) return { source: 'freed' as const, sourceId: freed.value.o.id, period: freed.value.change.from }
  return null
})
const recorded = computed(() => (srcKey.value ? allocationFor(financeStore.allocations, srcKey.value) : null))
function partName(target: string) {
  if (target === 'life') return 'Качество жизни'
  if (target.startsWith('prepay:')) return `Досрочно в «${financeStore.credits.find((c) => c.id === target.slice(7))?.name ?? 'долг'}»`
  return goals.value.find((g) => g.id === target)?.name ?? 'Цель'
}
const recordedParts = computed(() => (recorded.value?.parts ?? []).map((p) => ({ ...p, name: partName(p.target) })))
const recordedBy = computed(() => people.value.find((p) => p.id === recorded.value?.by)?.name ?? 'участник')
/** «Это приближает» (B2C-18 п. 4): какое желание становится ближе от этой суммы. */
const closer = computed(() => closerWish(financeStore.wishlist, total.value, once.value ? 'once' : 'monthly'))

const total = computed(() => {
  if (query('from') === 'salary') return salary.value?.total ?? 0
  if (query('from') === 'credit') return closed.value && !closed.value.inPlan ? closed.value.freed : 0
  if (rest.value) return rest.value.amount
  return freed.value?.monthly ?? 0
})

const empty = computed(() => {
  if (query('from') === 'salary') {
    return salary.value
      ? 'Свободного в этой зарплате нет: всё уже расписано планом месяца.'
      : 'Эта зарплата пока не отмечена — раскладывать нечего.'
  }
  if (query('from') === 'credit') {
    return closed.value?.inPlan
      ? 'Платёж этого долга уже идёт в следующий долг по плану «Сначала долги».'
      : 'Этот долг ещё не закрыт — освободившегося платежа нет.'
  }
  if (rest.value) return 'Остатка нет — раскладывать нечего.'
  return 'Сейчас нет запланированных изменений, которые высвобождают деньги.'
})

const alloc = ref<Record<string, number>>({})
const done = ref(false)
const doneNote = ref('')

const used = computed(() => Object.values(alloc.value).reduce((a, v) => a + v, 0))
const left = computed(() => total.value - used.value)
/** Сколько разложено по целям — у разового решения это взносы со счёта. */
const toGoals = computed(() => goals.value.reduce((a, g) => a + (alloc.value[g.id] ?? 0), 0))
/** Корзина досрочки (по кредиту или по плану — на экране одна из двух): у разового решения — со счёта. */
const prepayTotal = computed(() => (alloc.value.credit ?? 0) + (alloc.value.plan ?? 0))

/**
 * Откуда отложить разовые взносы и внести досрочку: по умолчанию — счёт, куда пришла зарплата
 * (Р-5), у остатка — куда приходит своя зарплата; не знаем — спросить (undefined). «Не
 * двигать» — взносы только в целях, как без счёта в окне цели.
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
/**
 * Разовые взносы и досрочка без выбранного счёта не записываются: деньги посчитались бы
 * дважды (долг меньше, а на счёте те же деньги).
 */
const needAccount = computed(
  () => once.value && (toGoals.value > 0 || prepayTotal.value > 0) && fromAccount.value === undefined,
)
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

/**
 * Сколько ещё можно положить в корзину: не больше нераспределённого, а разовую досрочку — и не
 * больше остатка долга (лишнее не внеслось бы, но числилось бы в записи и в итоге).
 */
function room(id: string) {
  const c = credit.value
  // Обе корзины досрочки («по кредиту» и «по плану») платят один долг — потолок на их сумму.
  const cap = once.value && (id === 'credit' || id === 'plan') && c ? c.principal - prepayTotal.value : Infinity
  return Math.max(0, Math.min(left.value, cap))
}

// Шаг — 10 000; последний забирает остаток, иначе сумма не кратная шагу (доля зарплаты)
// не раскладывалась бы до нуля и подтвердить было бы нельзя.
function set(id: string, delta: number) {
  const cur = alloc.value[id] ?? 0
  const d = delta > 0 ? Math.min(delta, room(id)) : delta
  if (d > 0 || cur > 0) alloc.value = { ...alloc.value, [id]: Math.max(0, cur + d) }
}

function effectForGoal(goalId: string, extra: number) {
  const g = goals.value.find((x) => x.id === goalId)
  if (!g) return ''
  const remaining = goalRemaining(g)
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
  // Разовая добавка вносится сама, шаг плана — своей кнопкой: эффект — только от добавки.
  const base = once.value && extra ? 0 : (stepDue(s)?.amount ?? 0)
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
        ? `Через год покроет ${emergencyCoverage(cushionInYear(g, x, once.value), mandatory.value)
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
  // Долг и шаг плана — до записи: досрочка, закрывшая самый дорогой долг, сдвинула бы `credit`
  // на следующий, а внесённая — шаг месяца.
  const c = credit.value
  const stepApplied = step.value?.kind === 'prepay' && !!step.value.applied
  // Сколько досрочки внесено на деле (`lumpPlan`: не больше остатка долга) — в итог и запись.
  let prepaid = 0
  if (once.value) {
    // Разовое решение: взносы в цели сейчас и сдвиг остатка выбранного счёта — как взнос в
    // окне цели. «Качество жизни» не записывается (вне скоупа RP-10).
    if (needAccount.value) return
    const by = authStore.slot ?? 'a'
    const note = rest.value ? 'из остатка месяца' : 'из зарплаты'
    for (const g of goals.value) {
      const extra = alloc.value[g.id] ?? 0
      if (extra > 0) financeStore.contribute(g.id, extra, by, note)
    }
    const acc = fromAccount.value ? financeStore.accounts.find((a) => a.id === fromAccount.value) : undefined
    if (acc && toGoals.value > 0) financeStore.shiftAccountAmount(acc.id, -toGoals.value)
    // Досрочка из раскладки (B2C-21) — запись `prepay` со счёта раскладки в самый дорогой долг.
    // Досрочкой плана «Сначала долги» (с его id) она считается, только если шаг месяца уже
    // внесён: иначе разовая добавка закрыла бы шаг (и подушку) частичной суммой.
    if (prepayTotal.value > 0 && c) {
      const rec = financeStore.applyPrepayment(c.id, by, {
        amount: prepayTotal.value,
        mode: 'term',
        accountId: fromAccount.value,
        ...(plan.value && stepApplied ? { planId: plan.value.id } : {}),
      })
      prepaid = rec?.amount ?? 0
    }
    doneNote.value =
      (toGoals.value
        ? `В цели отложено ${money(toGoals.value)}${acc ? ` со счёта «${acc.name}»` : ''} — взносы видны в истории целей. Ежемесячные взносы не менялись.`
        : 'Цели не тронуты, ежемесячные взносы не менялись.') +
      (prepaid && c ? ` Досрочка ${money(prepaid)} внесена в «${c.name}».` : '')
  } else {
    for (const g of goals.value) {
      const extra = alloc.value[g.id] ?? 0
      if (extra > 0) {
        financeStore.setGoalMonthly(g.id, g.monthly + extra)
      }
    }
  }
  // Решение записано (B2C-21): партнёр и повторный заход увидят его, а не раскладку заново.
  if (srcKey.value) {
    financeStore.recordAllocation({
      ...srcKey.value,
      by: authStore.slot ?? 'a',
      total: total.value,
      parts: Object.entries(alloc.value)
        .map(([id, amount]) =>
          id === 'credit' || id === 'plan'
            ? { target: `prepay:${c?.id ?? ''}`, amount: once.value ? prepaid : amount }
            : { target: id, amount },
        )
        .filter((p) => p.amount > 0),
    })
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
  <!-- СОСТОЯНИЕ 0: УЖЕ РАЗЛОЖЕНО (B2C-21) — запись видят оба, второй раз не раскладываем -->
  <div v-if="recorded && !done" class="flex flex-col gap-3 pt-1 text-left">
    <div class="rounded-card border border-card-border bg-surface p-5">
      <div class="type-section text-ink-3">Уже разложено</div>
      <h2 class="mt-1 type-h2 text-ink">{{ money(recorded.total) }}</h2>
      <p class="mt-1 text-[13px] text-ink-2">{{ recordedBy }} · {{ atLabel(recorded.at) }}</p>
      <div class="mt-3 flex flex-col">
        <div v-for="p in recordedParts" :key="p.target" class="flex items-baseline justify-between gap-3 border-t border-line py-2 first:border-t-0">
          <span class="text-[14px] text-ink">{{ p.name }}</span>
          <b class="num text-[14px] text-ink">{{ money(p.amount) }}</b>
        </div>
      </div>
      <p class="mt-3 text-[12.5px] leading-relaxed text-ink-3">Решение записано — второй раз те же деньги не раскладываются.</p>
    </div>
    <Button variant="outline" class="w-full" @click="router.push('/')">На главную</Button>
  </div>

  <!-- СОСТОЯНИЕ 1: РАСКЛАДЫВАТЬ НЕЧЕГО -->
  <div
    v-else-if="total <= 0 && !done"
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
    <p v-else-if="closed" class="max-w-[38ch] text-[14px] leading-relaxed text-ink-2">
      Взносы по целям увеличены — платёж «{{ closed.name }}» теперь работает на цели.
    </p>
    <p v-else-if="freed" class="max-w-[38ch] text-[14px] leading-relaxed text-ink-2">
      Взносы по целям увеличены с {{ monthFrom(freed.change.from) }}.
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
      Зарплата пришла — {{ money(salary.record.amount) }} · свободно {{ money(total) }}
    </p>
    <p v-else-if="rest" class="px-0.5 text-[13px] leading-relaxed text-ink-2 num">
      Остаток {{ monthFrom(rest.period, false) }} — {{ money(total) }}. Разложим его, пока он незаметно не разошёлся.
    </p>
    <p v-else-if="closed" class="px-0.5 text-[13px] leading-relaxed text-ink-2 num">
      «{{ closed.name }}» закрыт — освободилось {{ money(total) }} в месяц. Решим, куда они пойдут дальше.
    </p>

    <!-- «Это приближает» (B2C-18 п. 4) -->
    <p v-if="closer" class="px-0.5 text-[13px] leading-relaxed text-ink-2 num">
      Это приближает: «{{ closer.wish.name }}» —
      {{ closer.covers ? (once ? 'хватит целиком' : `хватит целиком, через ${closer.months} мес.`) : once ? `ближе на ${money(closer.closer)}` : `через ${closer.months} мес.` }}.
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
            :disabled="room(p.id) <= 0"
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
      v-if="once && (toGoals > 0 || prepayTotal > 0)"
      v-model="fromAccount"
      :accounts="accountChoices"
      :label="toGoals > 0 ? 'Откуда отложить в цели' : 'Откуда внести досрочку'"
      none="Не двигать остаток счёта"
    />

    <!-- Разовое решение пояснений не требует: под каждой корзиной уже одна строка эффекта (правило интерфейса). -->
    <p v-if="closed" class="px-0.5 text-[12.5px] leading-relaxed text-ink-3">
      Пока решения нет, платёж закрытого долга остаётся в «Свободно».
    </p>
    <p v-else-if="freed" class="px-0.5 text-[12.5px] leading-relaxed text-ink-3">
      Пока решения нет, эти деньги не попадают в «свободно потратить». {{ freed.o.name }} снизится с
      {{ plain(amountAt(freed.o, key)) }} до {{ plain(freed.change.amount) }} ₸ с
      {{ monthFrom(freed.change.from) }}.
    </p>

    <Button class="mb-2 w-full" :disabled="left !== 0 || needAccount" @click="confirm">
      {{ left !== 0 ? `Осталось ${money(left)}` : needAccount ? 'Выберите, откуда отложить' : 'Подтвердить распределение' }}
    </Button>
  </div>
</template>
