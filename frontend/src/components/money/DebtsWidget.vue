<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { PhCaretRight, PhCheck, PhPlus, PhUsers } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money, plain } from '@/lib/money'
import { monthBy, monthKey } from '@/lib/dates'
import { debtsOverview, isPeoplePayment, lastAccountFor, liveObligations, monthlyAmount, paidFor, peopleGroup, type DebtRow } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import Card from '@/components/kit/Card.vue'
import Button from '@/components/ui/Button.vue'
import CreditSheet from '@/components/capital/CreditSheet.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'
import NewDebtSheet from '@/components/capital/NewDebtSheet.vue'
import NewObligationSheet from '@/components/capital/NewObligationSheet.vue'
import ObligationSheet from '@/components/capital/ObligationSheet.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import PaymentLine from '@/components/money/PaymentLine.vue'
import PlanSquare from '@/components/money/PlanSquare.vue'

/**
 * Экран «Долги» (Блок 16, Р-110; макет money-b16.html): карточка — сумма остатков и «без долгов — к <месяц>»; кредиты
 * строками «платёж в месяц» (ставка и срок — в листе кредита, Б17) с остатком и полосой «погашено с начала учёта» (отметок с телом нет —
 * без полосы), нажатие — лист кредита. «Как закрыть быстрее ›» — свой экран `/money/debts/faster` (Б17, `PlanSquare`).
 * Тихое «+ Долг» — участнику; брендовых кнопок нет: «Отложил» в долг — у его строки в «Месяце». Всё — `debtsOverview`.
 *
 * Мелочи Р-6 (макет people-debts.html): долг человеку — строкой рядом с кредитами, без ставки; «Отдал» — маленькой
 * кнопкой в его строке (платёж месяца, правится в листе), отдано в этом месяце — ✓ у суммы. Платежи людям — свёрнутой
 * строкой «Людям · N · <в месяц>» (`peopleGroup`), в сумму долгов не входят; раскрыта — платежи и тихое «+ Людям».
 */
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()
const me = computed<PersonId>(() => authStore.slot ?? 'a')

const key = computed(() => monthKey())
const overview = computed(() => debtsOverview({ ...financeStore.planState(), plans: financeStore.plans }, key.value))
const hasPlan = computed(() => !!financeStore.activePlan)
// Без открытых долгов и плана — прошлые планы и поздравление плана видны сразу, без свёртки (как раньше).
const pastPlans = computed(() => financeStore.plans.some((p) => !p.deletedAt && p.status !== 'active'))

// Строка — платёж в месяц; ставка и месяц закрытия — в листе кредита (Р-116). Без ставки и «не закрывается» — предупреждения, остаются.
function rowMeta(r: DebtRow): string {
  if (r.person) return `${plain(r.payment)} в месяц`
  return [`${plain(r.payment)} в месяц`, r.rateUnknown ? 'ставку уточните' : '', r.endMonth ? '' : 'не закрывается'].filter(Boolean).join(' · ')
}

const creditId = ref<string | null>(null)
const payoffId = ref<string | null>(null)
const addOpen = ref(false)

/* ---------- долг человеку: «Отдал» у строки (одна отметка на месяц) ---------- */
const given = (r: DebtRow) => paidFor(financeStore.payments, 'credit', r.creditId, key.value)
/** Счёт — тот, с которого отдавали в прошлый раз (Р-5); не с чего взять — лист отметки спросит один раз. */
const giveFor = ref<{ row: DebtRow; account: string | null | undefined } | null>(null)
function give(r: DebtRow) {
  const last = lastAccountFor(financeStore.payments, r.creditId, financeStore.accounts)
  if (last === undefined) giveFor.value = { row: r, account: last }
  else financeStore.markPaid('credit', r.creditId, me.value, { period: key.value, accountId: last })
}

/* ---------- «Людям · N» ---------- */
const people = computed(() =>
  peopleGroup(
    liveObligations(financeStore.obligations)
      .filter(isPeoplePayment)
      .map((o) => ({ obligation: o, amount: monthlyAmount(o, key.value, fx.book), paid: false, day: o.day })),
    financeStore.obligations,
  ),
)
const peopleOpen = ref(false)
const obligationId = ref<string | null>(null)
const addPeopleOpen = ref(false)
</script>

<template>
  <!-- Слово «Долги» — уже на чипе (Р-116). -->
  <Card tight class="flex flex-col gap-1 py-5" data-debts>
    <template v-if="overview.total > 0">
      <span class="font-num text-[34px] font-bold leading-none num text-ink" data-debts-total>{{ money(overview.total) }}</span>
      <span v-if="overview.freeMonth" class="type-meta" data-debts-free>без долгов — {{ monthBy(overview.freeMonth, key) }}</span>
    </template>
    <span v-else class="type-num text-[24px] text-ok">Долгов нет</span>
  </Card>

  <Card v-if="overview.rows.length" flush data-debt-rows>
    <div v-for="r in overview.rows" :key="r.creditId" class="relative border-b border-line last:border-b-0">
      <button
        type="button"
        class="press flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2"
        :data-debt="r.creditId"
        @click="creditId = r.creditId"
      >
        <span class="flex w-full items-baseline justify-between gap-3">
          <span class="min-w-0 truncate text-[15px] font-semibold text-ink">{{ r.name }}</span>
          <span class="flex shrink-0 items-center gap-1.5">
            <PhCheck v-if="r.person && given(r)" :size="15" weight="bold" class="text-ok" aria-label="отдал в этом месяце" data-debt-given />
            <span class="text-[15px] font-semibold num text-ink">{{ money(r.left) }}</span>
          </span>
        </span>
        <span class="type-meta num">{{ rowMeta(r) }}</span>
        <span v-if="r.paidShare !== null" class="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-track" data-debt-bar>
          <span class="block h-full rounded-full bg-ok" :style="{ width: `${Math.round(r.paidShare * 100)}%` }" />
        </span>
      </button>
      <!-- «Отдал» — у своего предмета, в строке (правило 12); отдано — ✓ у суммы, кнопки нет. -->
      <Button
        v-if="r.person && !authStore.isViewer && !given(r)"
        variant="soft"
        size="sm"
        class="absolute right-4 top-[30px]"
        data-debt-give
        @click="give(r)"
      >
        Отдал
      </Button>
    </div>
  </Card>

  <!-- Платежи людям — одной строкой, в сумму долгов не входят (мелочи Р-6). -->
  <Card v-if="people" flush data-people>
    <button
      type="button"
      class="press flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
      :aria-expanded="peopleOpen"
      @click="peopleOpen = !peopleOpen"
    >
      <span class="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-surface-3 text-ink-2"><PhUsers :size="17" /></span>
      <span class="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">Людям · {{ people.count }}</span>
      <span class="shrink-0 text-[15px] font-semibold num text-ink" data-people-total>{{ money(people.total) }}</span>
      <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="peopleOpen && 'rotate-90'" />
    </button>
    <div v-if="peopleOpen" class="mb-2 ml-[33px] border-l-2 border-line pl-3" data-people-list>
      <template v-for="g in people.parts" :key="g.groupId ?? ''">
        <PaymentLine
          v-for="x in g.rows"
          :key="x.obligation.id"
          dense
          :item="{ kind: 'obligation', obligation: x.obligation }"
          :period="key"
          @open="obligationId = x.obligation.id"
        />
      </template>
      <Button v-if="!authStore.isViewer" variant="ghost" size="sm" class="-ml-2 my-1" data-add-people @click="addPeopleOpen = true">
        <PhPlus :size="14" weight="bold" /> Людям
      </Button>
    </div>
  </Card>

  <!-- Расчёт и «Сначала долги» — свёрнуты (правило 12) -->
  <template v-if="overview.rows.length || hasPlan">
    <!-- «Как закрыть быстрее» — свой экран (Б17): открывается сверху, «назад» — сюда же. -->
    <RouterLink
      to="/money/debts/faster"
      class="press flex w-full items-center justify-between gap-3 rounded-[16px] border border-card-border bg-surface px-4 py-3 text-left text-[15px] font-semibold text-ink"
      data-debts-calc
    >
      Как закрыть быстрее
      <PhCaretRight :size="14" class="shrink-0 text-ink-3" />
    </RouterLink>
  </template>
  <PlanSquare v-else-if="pastPlans" />

  <div v-if="!authStore.isViewer">
    <Button variant="ghost" class="px-2.5" data-add-credit @click="addOpen = true"><PhPlus :size="16" weight="bold" /> Долг</Button>
  </div>

  <CreditSheet :credit-id="creditId" @close="creditId = null" @payoff="(id) => { payoffId = id; creditId = null }" />
  <PayoffSheet :credit-id="payoffId" @close="payoffId = null" />
  <NewDebtSheet :open="addOpen" @close="addOpen = false" />
  <ObligationSheet :obligation-id="obligationId" @close="obligationId = null" />
  <NewObligationSheet :open="addPeopleOpen" people @close="addPeopleOpen = false" />
  <MarkSheet
    v-if="giveFor"
    open="mark"
    kind="credit"
    :target-id="giveFor.row.creditId"
    :period="key"
    :title="giveFor.row.name"
    :amount="giveFor.row.payment"
    :account="giveFor.account"
    first-time
    @close="giveFor = null"
  />
</template>
