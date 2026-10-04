<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { money, parseMoney, plain, signTone } from '@/lib/money'
import { dayLabel, monthBy, monthFrom, monthShort } from '@/lib/dates'
import { CURRENCY_WORD } from '@/lib/fx'
import {
  DEBT_CARD,
  allInDebt,
  fundMonthsOf,
  fxYearDelta,
  liveSpendCategories,
  moneySettingsOf,
  monthPlan,
  movementMonth,
  planFromSource,
  planSave,
  progressMoments,
  salaryOf,
  type MonthPlanCtx,
  type PlanQueueItem,
} from '@/lib/finance'
import { plannedElsewhere } from '@/lib/statements/dictionary'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import { plural } from '@/lib/utils'
import { usePhotos } from '@/lib/photos/usePhoto'
import type { PersonId } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import SortableList from '@/components/kit/SortableList.vue'
import Tag from '@/components/kit/Tag.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Button from '@/components/ui/Button.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import FxRateSheet from '@/components/money/FxRateSheet.vue'
import MonthRing from '@/components/money/MonthRing.vue'

/**
 * «План месяца» — верх «Денег» (Р-78, Р-79; макет month-plan.html, вариант «А · Лесенка»): обе зарплаты одним
 * кругом → платежи с датой и плательщиком → траты каждого (план и факт) → цели, фонды и «закрыть кредит» по
 * очереди (⋮⋮, вкл/выкл) → что осталось. Всё считает `monthPlan` (`finance.ts`); здесь — только показ и правки
 * документа через стор. Главное действие одно: пришла неразложенная зарплата → «Отложить по плану» (Р-78).
 * Viewer — тот же план без переключателей, плательщиков, правок и кнопки.
 */
const props = defineProps<{ monthKey: string }>()

const router = useRouter()
const finance = useFinanceStore()
const auth = useAuthStore()
const fx = useFxStore()
const ops = useOperationsStore()

const canEdit = computed(() => !auth.isViewer)
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (id: PersonId | null) => people.value.find((p) => p.id === id)?.name ?? ''

const state = computed(() => ({ ...finance.householdDoc, credits: finance.credits, book: fx.book }))
const ctx = computed<MonthPlanCtx>(() => ({
  key: props.monthKey,
  totals: finance.householdDoc.spendTotals ?? [],
  spendCategories: finance.householdDoc.spendCategories ?? [],
  uploads: ops.uploads,
}))
const plan = computed(() => monthPlan(state.value, ctx.value))
const debtTip = computed(() => allInDebt(state.value, ctx.value, plan.value))
const by = (x: string) => monthBy(x, props.monthKey)

/* ---------- круг ---------- */
const parts = computed(() => [
  { key: 'dues', amount: plan.value.duesTotal, color: '--s1' },
  { key: 'spend', amount: plan.value.spendTotal, color: '--s8' },
  { key: 'queue', amount: plan.value.queueTotal, color: '--s3' },
])

/* ---------- зарплаты ---------- */
const salaries = computed(() =>
  plan.value.income.byPerson.map((inc) => {
    const p = people.value.find((x) => x.id === inc.person)!
    const left = plan.value.byPerson.find((x) => x.person === inc.person)?.left ?? 0
    return { ...inc, payday: p?.payday ?? 1, left, year: p ? fxYearDelta(p, props.monthKey, fx.book) : null, foreign: !!p && salaryOf(p, props.monthKey).currency !== 'KZT' }
  }),
)
const rateFor = ref<PersonId | null>(null)
const signed = (v: number) => (v > 0 ? `+${plain(v)}` : plain(v))

/* ---------- «Отложить по плану» (Р-78) ---------- */
// Чья зарплата пришла и не отложена: своя — первой. Одна брендовая кнопка за раз.
const save = computed(() => {
  if (!canEdit.value) return null
  const order = [auth.slot, ...people.value.map((p) => p.id)].filter((x, i, a): x is PersonId => !!x && a.indexOf(x) === i)
  for (const id of order) {
    const s = planSave(plan.value, id)
    if (s && s.parts.length) return { person: id, total: s.parts.reduce((a, x) => a + x.amount, 0), count: s.parts.length, save: s }
  }
  return null
})
const savedTotal = computed(() =>
  Object.values(plan.value.saved).reduce((a, r) => a + (r?.parts ?? []).reduce((b, x) => b + x.amount, 0), 0),
)
function onSave() {
  const s = save.value
  if (!s || !auth.slot) return
  finance.applyPlan(s.save, { by: auth.slot, note: 'по плану месяца' })
}

/* ---------- прочие источники (Р-86): «Освободится», «Долг закрыт» — одной кнопкой, пока зарплата отложена ---------- */
const source = computed(() => {
  if (!canEdit.value || save.value) return null
  const sctx = { ...ctx.value, rawCredits: finance.householdDoc.credits }
  const f = planFromSource(state.value, sctx, { from: 'freed' })
  if (f?.mode === 'monthly' && !f.recorded) {
    const o = finance.obligations.find((x) => x.id === f.record.sourceId)
    const when = f.after ? ` ${by(f.after)}` + (f.before && f.before !== f.after ? `, а не ${by(f.before)}` : '') : ''
    return {
      kind: 'freed' as const,
      label: `С ${monthFrom(f.record.period, false)} · ${o?.name ?? ''}`,
      big: `+${money(f.add)}`,
      meta: `в месяц → «${f.name}»${when}`,
      button: `Добавить к «${f.name}»`,
      note: 'освободившийся платёж',
      src: f,
    }
  }
  const closed = progressMoments({ credits: finance.householdDoc.credits, payments: finance.payments }).find(
    (m) => m.kind === 'closed' && movementMonth(m.at) === props.monthKey,
  )
  if (closed?.kind === 'closed') {
    const c = planFromSource(state.value, sctx, { from: 'credit', creditId: closed.creditId })
    if (c?.mode === 'once' && !c.recorded && c.amount > 0) {
      return { kind: 'credit' as const, label: `${closed.name} закрыт`, big: money(c.amount), meta: 'свободны в этом месяце → по очереди', button: 'Отложить', note: 'закрытый долг', src: c }
    }
  }
  return null
})
function onSource() {
  const s = source.value
  if (s && auth.slot) finance.applyPlan(s.src, { by: auth.slot, note: s.note })
}

/* ---------- кто платит (Р-80) ---------- */
type PayerTarget = { kind: 'obligation' | 'credit' | 'goal' | 'debt'; id: string; name: string; payer: PersonId | null }
const payerFor = ref<PayerTarget | null>(null)
function pick(person: PersonId) {
  const t = payerFor.value
  payerFor.value = null
  if (t && t.payer !== person) finance.setPayer(t.kind, t.id, person)
}

/* ---------- платежи ---------- */
const dues = computed(() => plan.value.dues.slice().sort((a, b) => a.day - b.day || a.name.localeCompare(b.name)))
const mon = computed(() => monthShort(props.monthKey, false))

/* ---------- траты каждого (Р-81) ---------- */
const categories = computed(() => {
  const all = finance.householdDoc.spendCategories ?? []
  return liveSpendCategories(all).filter((c) => !plannedElsewhere(c.id, all))
})
const spendShare = (fact: number | null, planned: number) => (fact === null || planned <= 0 ? 0 : Math.min(100, Math.round((fact / planned) * 100)))
const spendEdit = ref<{ by: PersonId; categoryId: string; amount: string; fresh: boolean } | null>(null)
function editSpend(personId: PersonId, categoryId?: string, amount = 0) {
  if (!canEdit.value) return
  spendEdit.value = { by: personId, categoryId: categoryId ?? categories.value[0]?.id ?? '', amount: amount ? plain(amount) : '', fresh: !categoryId }
}
function saveSpend() {
  const e = spendEdit.value
  spendEdit.value = null
  if (e?.categoryId) finance.setSpendPlan(e.by, e.categoryId, parseMoney(e.amount))
}
const spendless = computed(() => people.value.filter((p) => !plan.value.spend.some((s) => s.by === p.id)))

/* ---------- очередь (Р-84) ---------- */
const queueIds = computed(() => plan.value.queue.map((q) => q.id))
const queueById = computed(() => new Map(plan.value.queue.map((q) => [q.id, q])))
const goalOf = (q: PlanQueueItem) => (q.goalId ? finance.goals.find((g) => g.id === q.goalId) : undefined)
const photos = usePhotos(() => plan.value.queue.map((q) => goalOf(q)?.photoId))
const settings = computed(() => moneySettingsOf(finance.householdDoc))

function thumbOf(q: PlanQueueItem) {
  const g = goalOf(q)
  const src = g?.photoId ? photos.value[g.photoId] : null
  if (src) return { src }
  if (q.kind === 'debt') return { cls: 'thumb-debt', text: '₸' }
  if (q.kind === 'fund' && g) return { cls: q.fund === 'reserve' ? 'thumb-reserve' : 'thumb-cushion', text: `${fundMonthsOf(q.fund!, g, settings.value)} мес` }
  return { tone: g ? hueColor(g.hue, isDark.value) : null }
}

/** Строка состояния карточки очереди — коротко (правило 12). */
function statusOf(q: PlanQueueItem): { text: string; warn?: boolean; ok?: boolean } {
  if (q.paused === 'off') return { text: 'на паузе' }
  if (q.paused === 'plan') return { text: 'на паузе ради плана' }
  if (q.kind === 'debt') {
    // С планом «Сначала долги» сумма карточки — шаг плана (Р-82); шага в долг в этом месяце нет — так и пишем.
    if (q.want <= 0 && finance.activePlan) return { text: 'по плану «Сначала долги»' }
    if (q.want <= 0) return { text: canEdit.value ? 'задайте сумму в месяц' : 'по графику' + (q.doneMonth ? ` · ${by(q.doneMonth)}` : '') }
    return { text: `${plain(q.given)} ₸` + (q.doneMonth ? ` · ${by(q.doneMonth)}` : ''), warn: q.given < q.want }
  }
  if (q.need - q.have <= 0) return { text: 'собрано', ok: true }
  if (q.want <= 0) return { text: 'взнос не задан' }
  if (q.given < q.want) return q.given > 0 ? { text: `получит ${plain(q.given)} из ${plain(q.want)}`, warn: true } : { text: 'в этом месяце не хватает', warn: true }
  return { text: `${plain(q.given)} ₸` + (q.doneMonth ? ` · ${by(q.doneMonth)}` : '') }
}
const progressOf = (q: PlanQueueItem) => (q.kind === 'debt' || q.need <= 0 ? null : Math.min(100, Math.round((Math.max(0, q.have) / q.need) * 100)))

/** Вкл/выкл (Р-83): выключенная — на паузе с этой минуты и дальше. */
const toggle = (id: string, on: boolean) => finance.pauseGoal(id, !on)

function openItem(q: PlanQueueItem) {
  if (q.kind === 'debt') {
    if (canEdit.value) debtEdit.value = plain(finance.debtCard.monthly)
    return
  }
  if (q.goalId) void router.push(`/goals/${q.goalId}`)
}
const debtEdit = ref<string | null>(null)
function saveDebt() {
  const v = parseMoney(debtEdit.value ?? '')
  debtEdit.value = null
  finance.setDebtCard({ monthly: Math.max(0, v) })
}
const debtName = computed(() => plan.value.queue.find((q) => q.id === DEBT_CARD)?.name ?? '')

// Фонда ещё нет (Р-82): тихая строка «+ Запас» / «+ Подушка» — заводит и открывает его взнос.
const missingFunds = computed(() =>
  canEdit.value ? (['reserve', 'cushion'] as const).filter((k) => !plan.value.queue.some((q) => q.kind === 'fund' && q.fund === k)) : [],
)
function addFund(kind: 'reserve' | 'cushion') {
  const id = finance.ensureFund(kind)
  void router.push(`/goals/${id}`)
}

/* ---------- желания ---------- */
const wishes = computed(() => finance.wishes.filter((w) => !w.bought))
const wishSrc = usePhotos(() => wishes.value.slice(0, 3).map((w) => w.photoId))
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Деньги сверх плана (Р-86): карточка над кругом, одна кнопка -->
    <Card v-if="source" class="flex flex-col gap-1.5 border-[1.5px] border-brand" :data-source="source.kind">
      <span class="type-section">{{ source.label }}</span>
      <span class="font-num text-[40px] font-bold leading-none num text-ink">{{ source.big }}</span>
      <span class="type-meta num">{{ source.meta }}</span>
      <Button class="mt-1.5 w-full" @click="onSource">{{ source.button }}</Button>
    </Card>

    <!-- Круг месяца: обе зарплаты снаружи, платежи · траты · очередь внутри -->
    <MonthRing :income="plan.income.byPerson" :parts="parts" :total="plan.income.total">
      <template v-if="plan.short > 0">
        <span class="type-section">Не хватает</span>
        <span class="font-num text-[26px] font-bold leading-tight num text-warn">{{ money(plan.short) }}</span>
      </template>
      <template v-else>
        <span class="type-section">Остаётся</span>
        <span class="font-num text-[26px] font-bold leading-tight num text-ink" data-rest>{{ money(plan.rest) }}</span>
      </template>
      <span class="type-meta num">из {{ plain(plan.income.total) }}</span>
    </MonthRing>

    <!-- Зарплаты: пришла / ждём, хватает ли каждому (?), обмен — у валютной -->
    <Card v-if="salaries.length" class="flex flex-col gap-2.5">
      <template v-for="(s, i) in salaries" :key="s.person">
        <div v-if="i > 0" class="h-px bg-line" />
        <div class="flex items-center gap-2.5" :data-salary="s.person">
          <Avatar :id="s.person" :name="s.name" />
          <div class="flex min-w-0 flex-1 flex-col gap-px">
            <span class="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
              {{ s.name }}<span v-if="s.came" class="text-[13px] font-semibold text-ok">✓ пришла</span>
            </span>
            <span v-if="!s.came" class="type-meta">ждём {{ dayLabel(s.payday, monthKey) }}</span>
          </div>
          <div class="flex flex-col items-end gap-1">
            <b class="font-num text-[16px] num whitespace-nowrap" :class="s.came ? 'text-ink' : 'text-ink-3'">{{ money(s.amount) }}</b>
            <span class="flex items-center">
              <Tag :tone="s.left >= 0 ? 'ok' : 'warn'" class="num" data-left>{{ signed(s.left) }}</Tag>
              <Hint v-if="i === 0" label="Хватает ли">Зарплата минус свои платежи, траты, цели и фонды</Hint>
            </span>
          </div>
        </div>
        <div v-if="s.came && s.foreign" class="pl-10">
          <SalaryExchange :person-id="s.person" :period="monthKey" />
        </div>
        <button
          v-if="s.year"
          type="button"
          class="press -mt-1 flex cursor-pointer items-center gap-1 self-start pl-10 text-left text-[12.5px] num"
          :aria-label="`Курс ${CURRENCY_WORD[s.year.currency].gen} за год`"
          @click="rateFor = s.person"
        >
          <span :class="signTone(s.year.tenge, 'text-ink-3')">{{ CURRENCY_WORD[s.year.currency].nom }} {{ signed(s.year.perUnit) }} ₸ за год</span>
          <PhCaretRight :size="12" class="text-ink-3" />
        </button>
      </template>

      <template v-if="canEdit">
        <template v-if="save">
          <Button class="w-full" data-plan-save @click="onSave">Отложить по плану</Button>
          <span class="-mt-1 text-center text-[12.5px] text-ink-3 num">
            {{ money(save.total) }} · {{ save.count }} {{ plural(save.count, 'цель', 'цели', 'целей') }} · {{ personName(save.person) }}
          </span>
        </template>
        <div v-else-if="savedTotal > 0" class="flex items-center justify-center gap-2 p-1.5 text-[14px] font-semibold text-ok num" data-plan-saved>
          ✓ Отложено {{ money(savedTotal) }}
        </div>
      </template>
    </Card>
    <FxRateSheet :person-id="rateFor" @close="rateFor = null" />

    <!-- Платежи -->
    <template v-if="dues.length">
      <div class="plan-head" style="--c: var(--s1)">
        <span class="plan-k">Платежи</span><span class="plan-v num">{{ plain(plan.duesTotal) }}</span>
      </div>
      <Card flush class="px-3.5 py-0.5">
        <div v-for="d in dues" :key="`${d.kind}:${d.targetId}`" class="flex items-center gap-2.5 border-t border-line py-[11px] first:border-t-0" data-due>
          <span class="flex w-[38px] shrink-0 flex-col items-center leading-[1.05]" :class="d.paid ? 'text-ink-3' : 'text-ink-2'">
            <b class="font-num text-[18px] num">{{ d.day }}</b><span class="text-[11px] text-ink-3">{{ mon }}</span>
          </span>
          <span class="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{{ d.name }}</span>
          <button
            v-if="canEdit && d.payer"
            type="button"
            class="press shrink-0 cursor-pointer rounded-full"
            :aria-label="`Платит ${personName(d.payer)}. Сменить`"
            @click="payerFor = { kind: d.kind, id: d.targetId, name: d.name, payer: d.payer }"
          >
            <Avatar :id="d.payer" :name="personName(d.payer)" :size="24" />
          </button>
          <Avatar v-else-if="d.payer" :id="d.payer" :name="personName(d.payer)" :size="24" />
          <span class="font-num text-[15px] font-bold num whitespace-nowrap" :class="d.paid ? 'font-semibold text-ink-3' : 'text-ink'">
            <span v-if="d.paid" class="font-extrabold text-ok">✓ </span>{{ plain(d.amount) }}
          </span>
        </div>
      </Card>
    </template>

    <!-- Траты каждого: план и факт по разделам -->
    <div class="plan-head" style="--c: var(--s8)">
      <span class="plan-k">Траты</span><span class="plan-v num">{{ plain(plan.spendTotal) }}</span>
    </div>
    <Card flush class="px-3.5 py-0.5">
      <div v-for="s in plan.spend" :key="s.by" class="flex flex-col gap-[9px] border-t border-line py-2.5 first:border-t-0" :data-spend="s.by">
        <div class="flex items-center gap-2">
          <Avatar :id="s.by" :name="personName(s.by)" :size="24" />
          <b class="flex-1 text-[15.5px] text-ink">{{ personName(s.by) }}</b>
          <span class="type-meta num">{{ s.fact === null ? `план ${plain(s.plan)}` : `${plain(s.fact)} из ${plain(s.plan)}` }}</span>
        </div>
        <component
          :is="canEdit ? 'button' : 'div'"
          v-for="r in s.rows"
          :key="r.categoryId"
          :type="canEdit ? 'button' : undefined"
          class="flex flex-col gap-1 pl-8 text-left"
          :class="canEdit && 'press cursor-pointer'"
          @click="editSpend(s.by, r.categoryId, r.plan)"
        >
          <span class="flex w-full justify-between gap-2 text-[14px]">
            <span class="text-ink">{{ r.name }}</span>
            <span class="whitespace-nowrap text-ink-3 num"><b v-if="r.fact !== null" class="font-semibold text-ink">{{ plain(r.fact) }}</b>{{ r.fact !== null ? ' из ' : '' }}{{ plain(r.plan) }}</span>
          </span>
          <span class="block h-[5px] w-full overflow-hidden rounded-pill bg-track">
            <i class="block h-full rounded-pill bg-s8" :style="{ width: `${spendShare(r.fact, r.plan)}%` }" />
          </span>
        </component>
        <button v-if="canEdit" type="button" class="press self-start cursor-pointer pl-8 text-[13.5px] font-semibold text-ink-2" @click="editSpend(s.by)">+ Раздел</button>
      </div>
      <button
        v-for="p in canEdit ? spendless : []"
        :key="p.id"
        type="button"
        class="press flex w-full cursor-pointer items-center gap-2 border-t border-line py-2.5 text-left first:border-t-0"
        @click="editSpend(p.id)"
      >
        <Avatar :id="p.id" :name="p.name" :size="24" />
        <span class="text-[14.5px] font-semibold text-ink-2">+ Траты · {{ p.name }}</span>
      </button>
      <p v-if="!plan.spend.length && !canEdit" class="py-3 type-meta">Плана трат нет</p>
    </Card>

    <!-- Цели и фонды по очереди: ⋮⋮ — выше раньше получает деньги -->
    <template v-if="plan.queue.length || missingFunds.length">
      <div class="plan-head" style="--c: var(--s3)">
        <span class="plan-k">Цели и фонды</span><span class="plan-v num">{{ plain(plan.queueTotal) }}</span>
      </div>
      <Card flush class="px-3.5 py-0.5" :class="canEdit && 'pl-2.5'">
        <SortableList
          :ids="queueIds"
          :disabled="!canEdit"
          :label="(id) => `Переставить: ${queueById.get(id)?.name ?? ''}`"
          @move="(id, i) => finance.moveInQueue(id, i)"
        >
          <template #default="{ id }">
            <template v-if="queueById.get(id)">
              <div class="flex items-center gap-2.5 py-2.5" :data-queue="id" :class="queueById.get(id)!.paused && 'is-off'">
                <button type="button" class="press flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left" @click="openItem(queueById.get(id)!)">
                  <span
                    class="plan-thumb grid size-12 shrink-0 place-items-center overflow-hidden rounded-[13px] bg-surface-3 text-center text-[11px] font-bold leading-[1.1] text-on-photo"
                    :class="thumbOf(queueById.get(id)!).cls"
                    :style="thumbOf(queueById.get(id)!).tone ? { background: thumbOf(queueById.get(id)!).tone! } : undefined"
                  >
                    <img v-if="thumbOf(queueById.get(id)!).src" :src="thumbOf(queueById.get(id)!).src!" alt="" class="size-full object-cover" />
                    <template v-else>{{ thumbOf(queueById.get(id)!).text }}</template>
                  </span>
                  <span class="plan-tx flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="text-[15.5px] font-semibold text-ink">
                      {{ queueById.get(id)!.name }}<span v-if="queueById.get(id)!.goalId && queueById.get(id)!.goalId === finance.heroGoal?.id" class="ml-1.5 rounded-pill bg-brand-soft px-[7px] py-px align-[1px] text-[11px] font-bold text-brand">главная</span>
                    </span>
                    <span class="text-[12.5px] num" :class="statusOf(queueById.get(id)!).warn ? 'text-warn' : statusOf(queueById.get(id)!).ok ? 'text-ok' : 'text-ink-3'" data-status>
                      {{ statusOf(queueById.get(id)!).text }}
                    </span>
                    <span v-if="progressOf(queueById.get(id)!) !== null" class="mt-[3px] block h-[5px] w-full overflow-hidden rounded-pill bg-track">
                      <i class="block h-full rounded-pill bg-s3" :style="{ width: `${progressOf(queueById.get(id)!)}%` }" />
                    </span>
                  </span>
                </button>
                <button
                  v-if="canEdit && queueById.get(id)!.payer"
                  type="button"
                  data-no-drag
                  class="press shrink-0 cursor-pointer rounded-full"
                  :aria-label="`Платит ${personName(queueById.get(id)!.payer)}. Сменить`"
                  @click="
                    payerFor = {
                      kind: queueById.get(id)!.kind === 'debt' ? 'debt' : 'goal',
                      id: queueById.get(id)!.goalId ?? DEBT_CARD,
                      name: queueById.get(id)!.name,
                      payer: queueById.get(id)!.payer,
                    }
                  "
                >
                  <Avatar :id="queueById.get(id)!.payer!" :name="personName(queueById.get(id)!.payer)" :size="24" />
                </button>
                <Avatar v-else-if="queueById.get(id)!.payer" :id="queueById.get(id)!.payer!" :name="personName(queueById.get(id)!.payer)" :size="24" />
                <span v-if="canEdit" data-no-drag class="shrink-0">
                  <Toggle
                    :model-value="queueById.get(id)!.paused !== 'off'"
                    :label="queueById.get(id)!.name"
                    tone="ok"
                    @update:model-value="toggle(id, $event)"
                  />
                </span>
              </div>
              <!-- Одна готовая подсказка (Р-83): весь свободный остаток — в долг -->
              <div v-if="id === DEBT_CARD && debtTip" class="mb-2.5 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[13.5px] text-ink num" data-debt-tip>
                Всё в долг — закроете {{ by(debtTip.month) }}
              </div>
            </template>
          </template>
        </SortableList>
        <button
          v-for="k in missingFunds"
          :key="k"
          type="button"
          class="press flex w-full cursor-pointer items-center gap-2.5 border-t border-line py-2.5 text-left first:border-t-0"
          @click="addFund(k)"
        >
          <span class="plan-thumb grid size-12 shrink-0 place-items-center rounded-[13px] text-[11px] font-bold text-on-photo" :class="k === 'reserve' ? 'thumb-reserve' : 'thumb-cushion'">
            {{ k === 'reserve' ? settings.reserveMonths : settings.cushionMonths }} мес
          </span>
          <span class="text-[15px] font-semibold text-ink-2">+ {{ k === 'reserve' ? 'Запас' : 'Подушка' }}</span>
        </button>
      </Card>
    </template>

    <!-- Итог -->
    <Card class="flex flex-col gap-2" data-plan-sum>
      <div class="flex items-baseline justify-between text-[15px] text-ink">
        <span>Отложим</span><b class="font-num text-[17px] num text-ok">{{ money(plan.queueTotal) }}</b>
      </div>
      <div class="flex items-baseline justify-between text-[15px] text-ink">
        <span>Потратим</span><b class="font-num text-[17px] num">{{ money(plan.outTotal) }}</b>
      </div>
      <div class="flex items-baseline justify-between text-[15px] text-ink">
        <span>{{ plan.short > 0 ? 'Не хватает' : 'Остаётся' }}</span>
        <b class="font-num text-[22px] num" :class="plan.short > 0 && 'text-warn'">{{ money(plan.short > 0 ? plan.short : plan.rest) }}</b>
      </div>
    </Card>

    <!-- Желания — свёрнутой строкой -->
    <button
      type="button"
      class="press flex w-full cursor-pointer items-center gap-3 rounded-tile border border-card-border bg-surface px-3.5 py-3 text-left"
      @click="router.push('/wishes')"
    >
      <span v-if="wishes.length" class="flex">
        <span
          v-for="w in wishes.slice(0, 3)"
          :key="w.id"
          class="-ml-2.5 block size-[30px] overflow-hidden rounded-[9px] border-2 border-surface bg-surface-3 first:ml-0"
        >
          <img v-if="w.photoId && wishSrc[w.photoId]" :src="wishSrc[w.photoId]!" alt="" class="size-full object-cover" />
        </span>
      </span>
      <b class="flex-1 text-[16px] text-ink">Желания · {{ wishes.length }}</b>
      <PhCaretRight :size="18" class="text-ink-3" />
    </button>

    <!-- Кто платит — одно нажатие, кнопки нет -->
    <Sheet :open="!!payerFor" :title="payerFor ? `Кто платит: ${payerFor.name.toLowerCase()}?` : ''" @close="payerFor = null">
      <div class="flex flex-col gap-2">
        <button
          v-for="p in people"
          :key="p.id"
          type="button"
          class="press flex cursor-pointer items-center gap-3 rounded-[16px] border-[1.5px] px-3.5 py-3 text-left text-[16px] font-semibold text-ink"
          :class="payerFor?.payer === p.id ? 'border-ink bg-surface-2' : 'border-line'"
          @click="pick(p.id)"
        >
          <Avatar :id="p.id" :name="p.name" :size="34" />{{ p.name }}
          <span v-if="payerFor?.payer === p.id" class="ml-auto font-extrabold text-ok">✓</span>
        </button>
        <p class="text-center text-[12.5px] text-ink-3">С {{ monthFrom(monthKey, false) }} и дальше</p>
      </div>
    </Sheet>

    <!-- Сумма раздела трат -->
    <Sheet :open="!!spendEdit" :title="spendEdit?.fresh ? 'Траты на месяц' : 'Сколько в месяц'" @close="spendEdit = null">
      <template v-if="spendEdit">
        <Field v-if="spendEdit.fresh" label="Раздел">
          <Select v-model="spendEdit.categoryId" :options="categories.map((c) => ({ value: c.id, label: c.name }))" class="mb-3" />
        </Field>
        <Field :label="`${personName(spendEdit.by)}, ₸ в месяц`">
          <NumField v-model="spendEdit.amount" placeholder="50 000" class="mb-3" />
        </Field>
        <Button class="w-full" :disabled="!spendEdit.categoryId" @click="saveSpend">Готово</Button>
      </template>
    </Sheet>

    <!-- Сумма карточки «закрыть кредит» -->
    <Sheet :open="debtEdit !== null" :title="debtName || 'Закрыть кредит'" @close="debtEdit = null">
      <template v-if="debtEdit !== null">
        <Field label="Сверх графика, ₸ в месяц">
          <NumField v-model="debtEdit" placeholder="50 000" class="mb-3" />
        </Field>
        <Button class="w-full" @click="saveDebt">Готово</Button>
      </template>
    </Sheet>
  </div>
</template>

<style>
.plan-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 4px 4px 0;
}
.plan-k {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.plan-k::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c);
}
.plan-v {
  font-family: var(--font-num);
  font-weight: 700;
  font-size: 15px;
  color: var(--ink-2);
}
.thumb-reserve {
  background: linear-gradient(135deg, var(--s3), var(--s5));
}
.thumb-cushion {
  background: linear-gradient(135deg, var(--s8), var(--s1));
}
.thumb-debt {
  background: linear-gradient(135deg, var(--s1), var(--s6));
  font-size: 20px;
}
.is-off .plan-thumb,
.is-off .plan-tx > span:first-child {
  opacity: 0.45;
}
</style>
