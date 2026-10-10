<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { money, moneyIn, parseMoney, plain } from '@/lib/money'
import { dayLabel, monthBy, monthFrom, monthKey as monthNow, monthShort, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import {
  DEBT_CARD,
  closerDays,
  freeByFact,
  allInDebt,
  goalPace,
  lastAccountFor,
  liveSpendCategories,
  monthPlan,
  monthSalaries,
  monthSubscriptions,
  pendingPuts,
  planExtras,
  planPutSaves,
  planPuts,
  putsLeft,
  queueStatus,
  spendFact,
  untilPayday,
  type PlanDue,
  type PlanPut,
  type PlanQueueItem,
} from '@/lib/finance'
import { plannedElsewhere } from '@/lib/statements/dictionary'
import type { PersonId } from '@/types/finance'
import { plural } from '@/lib/utils'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import SortableList from '@/components/kit/SortableList.vue'
import Toast from '@/components/kit/Toast.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import ExtraIncomeSheet from '@/components/capital/ExtraIncomeSheet.vue'
import DueRow from '@/components/money/DueRow.vue'
import MonthRing from '@/components/money/MonthRing.vue'
import SalarySheet from '@/components/money/SalarySheet.vue'

/**
 * «План · Месяц» (Блок 15, Р-90; макет week-month.html, ворота B2C-91): круг — оглавление. Под кругом зарплаты и
 * три строки-раздела — Платежи · Траты · Цели и фонды; раздел раскрывается под кругом нажатием цвета круга или
 * строки, один за раз, по умолчанию всё свёрнуто. Месяц — список дел одним языком (правило 12 «Смысловой флоу»):
 * платёж — «Оплатил» ✓ (Р-94), цель — «Отложил» ✓, зарплата — «Пришла» ✓ (Р-97); действие — нажатием своей строки,
 * лист с одной кнопкой. Подписки — одной строкой (Р-93), цели — короткими строками без фото (Р-92). Управление
 * Блока 14 — то же: плательщик, вкл/выкл, ⋮⋮, траты каждого. Всё считает `finance.ts`; здесь — показ и правки
 * документа через стор. Viewer — тот же план без переключателей, плательщиков, листов и кнопок.
 */
const props = defineProps<{ monthKey: string }>()

const route = useRoute()
const router = useRouter()
const finance = useFinanceStore()
const auth = useAuthStore()

const canEdit = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (id: PersonId | null) => people.value.find((p) => p.id === id)?.name ?? ''

// Вход плана — один на все экраны (`planInput`, ревью frontend Б14 Н-4).
const input = computed(() => finance.planInput(props.monthKey))
const state = computed(() => input.value.state)
const ctx = computed(() => input.value.ctx)
const plan = computed(() => monthPlan(state.value, ctx.value))
const debtTip = computed(() => allInDebt(state.value, ctx.value, plan.value))
const by = (x: string) => monthBy(x, props.monthKey)
const mon = computed(() => monthShort(props.monthKey, false))
const monthName = computed(() => MONTHS_NOM[parseMonthKey(props.monthKey).month].toLowerCase())

/* ---------- круг — оглавление: какой раздел раскрыт (состояние экрана) ---------- */
type Section = 'dues' | 'spend' | 'queue'
const opened = ref<Section | null>(null)
const toggleSection = (k: string) => (opened.value = opened.value === k ? null : (k as Section))
const parts = computed(() => [
  { key: 'dues', amount: plan.value.duesTotal, color: '--s1' },
  { key: 'spend', amount: plan.value.spendTotal, color: '--s8' },
  { key: 'queue', amount: plan.value.queueTotal, color: '--s3' },
])

/* ---------- список дел: «Отложил» (Р-97) и деньги сверх плана (Р-86) ---------- */
const puts = computed(() => planPuts(state.value, plan.value))
const putById = computed(() => new Map(puts.value.map((p) => [p.id, p])))
const pending = computed(() => (canEdit.value ? pendingPuts(puts.value) : []))
const pendingTotal = computed(() => putsLeft(pending.value))
const extras = computed(() =>
  canEdit.value ? planExtras(state.value, { ...ctx.value, rawCredits: finance.householdDoc.credits }) : { freed: null, closed: null },
)
/* «Ближе на N дней» (PN-09, Р-15): один тост на «Отложил» и «Отложил всё» — первая цель по очереди и «и ещё M»; фонды и
 * долг дней не дают; ни у одной цели нет темпа — тоста нет. Темп и остаток — до записи взносов. */
const closerNote = ref<string | null>(null)
let closerTimer: ReturnType<typeof setTimeout> | null = null
function flashCloser(text: string, ms = 4000) {
  if (closerTimer) clearTimeout(closerTimer)
  closerNote.value = text
  closerTimer = setTimeout(() => (closerNote.value = null), ms)
}
onBeforeUnmount(() => {
  if (closerTimer) clearTimeout(closerTimer)
})
function savePuts(list: PlanPut[]) {
  const closer = list.flatMap((p) => {
    if (p.kind !== 'goal' || !p.goalId || p.left <= 0) return []
    const g = finance.goals.find((x) => x.id === p.goalId && !x.deletedAt)
    const days = g ? closerDays(p.left, goalPace(g, props.monthKey)) : null
    return days ? [{ name: p.name, days }] : []
  })
  finance.putPlan(planPutSaves(plan.value, list), { by: me.value, note: 'по плану месяца' })
  if (!closer.length) return
  const [first] = closer
  flashCloser(`${first.name} ближе на ${first.days} ${plural(first.days, 'день', 'дня', 'дней')}${closer.length > 1 ? ` · и ещё ${closer.length - 1}` : ''}`)
}
function onFreed() {
  const f = extras.value.freed
  if (f) finance.applyPlan(f, { by: me.value, note: 'освободившийся платёж' })
}
function onClosed() {
  const c = extras.value.closed
  if (c) finance.applyPlan(c, { by: me.value, note: 'закрытый долг' })
}
const freedMeta = computed(() => {
  const f = extras.value.freed
  return f ? `С ${monthFrom(f.record.period, false)} свободно +${plain(f.add)} в месяц` : ''
})

const spentFact = computed(() => spendFact(plan.value.spend))
const sections = computed(() => [
  {
    key: 'dues' as const,
    name: 'Платежи',
    color: '--s1',
    total: plan.value.duesTotal,
    meta: `${plan.value.dues.filter((d) => d.paid).length} из ${plan.value.dues.length} оплачено`,
    dot: !!extras.value.freed,
  },
  {
    key: 'spend' as const,
    name: 'Траты',
    color: '--s8',
    total: plan.value.spendTotal,
    meta: spentFact.value !== null ? `потрачено ${plain(spentFact.value)}` : 'по плану',
    dot: false,
  },
  {
    key: 'queue' as const,
    name: 'Цели и фонды',
    color: '--s3',
    total: plan.value.queueTotal,
    meta: puts.value.length ? `${puts.value.filter((p) => p.done).length} из ${puts.value.length} отложено` : 'взносов нет',
    dot: pending.value.length > 0 || !!extras.value.closed,
  },
])

/* ---------- зарплаты: ✓ у суммы; нажатие строки — лист: «Пришла» у своей, «Изменить оклад» ---------- */
const salaries = computed(() =>
  monthSalaries(plan.value, { people: finance.people, payments: finance.payments }).map((s) => ({
    ...s,
    // Свою зарплату отмечает только сам участник (Р-13), когда её день настал или близко.
    canMark: canEdit.value && auth.slot === s.person && s.open,
  })),
)

/*
 * Подсказка у «Остаётся» (Р-116, переехало с «Мечт»): «Свободно» по факту выписок (Р-47 — до выписки месяца числа нет)
 * и дни до зарплаты. Считает `finance.ts` — те же `freeByFact` и `untilPayday`, что были на «Мечтах».
 */
const fx = useFxStore()
const ops = useOperationsStore()
const free = computed(() =>
  freeByFact(
    { ...finance.householdDoc, credits: finance.credits, book: fx.book },
    finance.householdDoc.spendTotals ?? [],
    finance.householdDoc.spendCategories ?? [],
    props.monthKey,
    ops.uploads,
  ),
)
const paydayText = computed(() => {
  if (props.monthKey !== monthNow()) return ''
  const p = untilPayday({
    people: finance.people,
    obligations: finance.obligations,
    credits: finance.credits,
    accounts: finance.householdAccounts,
    payments: finance.payments,
    fxExchanges: finance.fxExchanges,
    book: fx.book,
  })
  if (!p) return ''
  return p.inDays === 0 ? 'Сегодня зарплата' : `До зарплаты ${p.inDays} ${plural(p.inDays, 'день', 'дня', 'дней')}`
})
// Лист зарплаты — общий с «Капиталом» (`SalarySheet`, Р-108).
const salaryFor = ref<PersonId | null>(null)
const salarySheet = computed(() => salaries.value.find((s) => s.person === salaryFor.value) ?? null)

/* ---------- внеплановый доход: тихо в карточке зарплат и из «+» (`?income=1`) ---------- */
const incomeOpen = ref(false)
watch(
  () => route.query.income,
  (v) => {
    if (v === '1' && canEdit.value) incomeOpen.value = true
  },
  { immediate: true },
)

/* ---------- кто платит (Р-80) ---------- */
type PayerTarget = { kind: 'obligation' | 'credit' | 'goal' | 'debt'; id: string; name: string; payer: PersonId | null }
const payerFor = ref<PayerTarget | null>(null)
function pick(person: PersonId) {
  const t = payerFor.value
  payerFor.value = null
  if (t && t.payer !== person) finance.setPayer(t.kind, t.id, person)
}

/* ---------- платежи: подписки группой (Р-93), «Оплатил» нажатием строки (Р-94) ---------- */
const dueKey = (d: PlanDue) => `${d.kind}:${d.targetId}`
const grouped = computed(() => monthSubscriptions(plan.value.dues, finance.obligations))
type DueLine = { key: string; day: number; due: PlanDue | null }
const dueLines = computed<DueLine[]>(() => {
  const lines: DueLine[] = grouped.value.rest.map((d) => ({ key: dueKey(d), day: d.day, due: d }))
  if (grouped.value.subs) lines.push({ key: 'subs', day: grouped.value.subs.day, due: null })
  return lines.sort((a, b) => a.day - b.day || (a.due?.name ?? '').localeCompare(b.due?.name ?? ''))
})
const subsOpen = ref(false)
// «Освободится» — подсказкой у своего платежа: в общем списке или у группы подписок, где он лежит.
const freedAt = computed(() => {
  const id = extras.value.freed?.obligationId
  if (!id) return null
  if (grouped.value.rest.some((d) => d.kind === 'obligation' && d.targetId === id)) return `obligation:${id}`
  return grouped.value.subs ? 'subs' : (dueLines.value[0]?.key ?? null)
})

const payFor = ref<string | null>(null)
const paySheet = computed(() => plan.value.dues.find((d) => dueKey(d) === payFor.value) ?? null)
const markFor = ref<{ due: PlanDue; account: string | null | undefined } | null>(null)
/** «Оплатил»: одно нажатие — со счёта прошлой оплаты (Р-5); счёт спросить не у кого или сумма-оценка — лист отметки. */
function pay(d: PlanDue) {
  payFor.value = null
  const last = lastAccountFor(finance.payments, d.targetId, finance.accounts)
  const estimate = d.kind === 'obligation' && !!d.obligation.estimate
  if (last === undefined || estimate) markFor.value = { due: d, account: last }
  else finance.markPaid(d.kind, d.targetId, me.value, { period: props.monthKey, accountId: last })
}
/** Долг человеку — «Отдал», как у его строки в «Долгах» (мелочи Р-5). */
const givenDue = (d: PlanDue) => d.kind === 'credit' && !!d.credit.person
function unpay(d: PlanDue) {
  payFor.value = null
  finance.unmarkPaid(d.kind, d.targetId, props.monthKey)
}
/** «Изменить платёж» — лист платежа в «Деньгах» (справочник, Р-91). */
function editDue(d: PlanDue) {
  payFor.value = null
  void router.push({ path: '/money', query: d.kind === 'credit' ? { credit: d.targetId } : { obligation: d.targetId } })
}
const dueNote = (d: PlanDue) => (d.kind === 'obligation' && d.obligation.estimate ? 'примерно' : '')
const askPayer = (d: PlanDue) => (payerFor.value = { kind: d.kind, id: d.targetId, name: d.name, payer: d.payer })

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
const spendForm = useFormCheck(() => [['category', !spendEdit.value?.categoryId && 'Выберите раздел']])
function saveSpend() {
  const e = spendEdit.value
  spendEdit.value = null
  if (e?.categoryId) finance.setSpendPlan(e.by, e.categoryId, parseMoney(e.amount))
}
const spendless = computed(() => people.value.filter((p) => !plan.value.spend.some((s) => s.by === p.id)))

/* ---------- цели и фонды — короткие строки (Р-92), очередь ⋮⋮ (Р-84), «Отложил» нажатием ---------- */
const queueIds = computed(() => plan.value.queue.map((q) => q.id))
const queueById = computed(() => new Map(plan.value.queue.map((q) => [q.id, q])))

/** Строка состояния — только когда есть что сказать (правило 12): пауза, нехватка, собрано (`queueStatus`). */
function statusOf(q: PlanQueueItem): { text: string; warn?: boolean } | null {
  const st = queueStatus(q, { debtPlan: !!finance.activePlan })
  if (!st) return null
  switch (st.kind) {
    case 'off':
      return { text: 'на паузе' }
    case 'planPause':
      return { text: 'на паузе ради плана' }
    // С планом «Сначала долги» сумма карточки — шаг плана (Р-82); шага в долг в этом месяце нет — так и пишем.
    case 'debtByPlan':
      return { text: 'по плану «Сначала долги»' }
    case 'debtNoAmount':
      return { text: canEdit.value ? 'задайте сумму в месяц' : 'по графику' }
    case 'collected':
      return { text: 'собрано' }
    case 'noMonthly':
      return { text: 'взнос не задан' }
    case 'short':
      return { text: `не хватает ${plain(st.amount)}`, warn: true }
    case 'shortAll':
      return { text: 'в этом месяце не хватает', warn: true }
  }
}

/** Вкл/выкл (Р-83): выключенная — на паузе с этой минуты и дальше. */
const toggle = (id: string, on: boolean) => finance.pauseGoal(id, !on)

const putFor = ref<string | null>(null)
const putSheet = computed(() => (putFor.value ? (putById.value.get(putFor.value) ?? null) : null))
const debtEdit = ref<string | null>(null)
/**
 * Строка с суммой месяца — лист «Отложил»; без суммы — к цели или к сумме карточки долга, как в Блоке 14. В прошлом
 * месяце (он открыт планом, пока своя зарплата не отложена) цель по одной не отмечается: первая же запись закрыла бы
 * месяц сводкой, а остальные цели остались бы без отметки — там только «Отложил всё».
 */
function openItem(q: PlanQueueItem) {
  if (canEdit.value && props.monthKey >= monthNow() && putById.value.has(q.id)) putFor.value = q.id
  else openDetail(q)
}
function openDetail(q: Pick<PlanQueueItem, 'kind' | 'goalId'>) {
  putFor.value = null
  if (q.kind === 'debt') {
    if (canEdit.value) debtEdit.value = plain(finance.debtCard.monthly)
    return
  }
  if (q.goalId) void router.push(`/goals/${q.goalId}`)
}
function onPut(p: PlanPut) {
  putFor.value = null
  savePuts([p])
}
function onUnput(p: PlanPut) {
  putFor.value = null
  if (p.goalId) finance.unputPlan(p.goalId, props.monthKey, p.undo, me.value)
}
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
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Круг месяца — оглавление: обе зарплаты снаружи, платежи · траты · цели внутри; цвет раскрывает раздел -->
    <MonthRing :income="plan.income.byPerson" :parts="parts" :total="plan.income.total" :active="opened" pickable @pick="toggleSection">
      <!-- «из N», «Свободно» по выпискам и дни до зарплаты — в подсказке у слова (Р-116), крупно — одно число. -->
      <span class="relative z-10 flex items-center gap-1" @click.stop>
        <span class="type-section">{{ plan.short > 0 ? 'Не хватает' : 'Остаётся' }}</span>
        <Hint label="Остаётся" data-rest-hint>
          <span class="block num">Из {{ money(plan.income.total) }} дохода месяца.</span>
          <span v-if="free.byFact" class="block num" data-free>Свободно по выпискам — {{ money(free.amount) }}.</span>
          <span v-if="paydayText" class="block" data-payday>{{ paydayText }}.</span>
        </Hint>
      </span>
      <span v-if="plan.short > 0" class="font-num text-[24px] font-bold leading-tight num text-warn">{{ money(plan.short) }}</span>
      <span v-else class="font-num text-[24px] font-bold leading-tight num text-ink" data-rest>{{ money(plan.rest) }}</span>
    </MonthRing>

    <!--
      Зарплаты: ✓ у суммы — пришла, валютная — «1 500 €» под суммой; строка нажимается — лист зарплаты (дата, «хватает
      ли», обмены — там, Р-116); «Обменял» — у своей пришедшей валютной, в строке; «Пришла» — у своей открытой, в
      строке (PN-02, правило 12: действие у предмета; та же отметка, что в листе — `useSalaryTap`).
    -->
    <Card v-if="salaries.length || canEdit" tight class="flex flex-col gap-2.5">
      <template v-for="(s, i) in salaries" :key="s.person">
        <div v-if="i > 0" class="h-px bg-line" />
        <div
          class="press relative flex cursor-pointer items-center gap-2.5"
          :data-salary="s.person"
          :data-can-mark="s.canMark || undefined"
          @click="salaryFor = s.person"
        >
          <Avatar :id="s.person" :name="s.name" />
          <!-- Лист открывает и viewer — только чтение: дата и «хватает» живут лишь там (критик Б17). -->
          <button type="button" class="row-open flex min-w-0 flex-1 flex-col gap-px text-left" data-row-open>
            <span class="truncate text-[16px] font-semibold text-ink">{{ s.name }}</span>
          </button>
          <span v-if="s.came && s.foreign" class="relative z-10 shrink-0" @click.stop>
            <SalaryExchange :person-id="s.person" :period="monthKey" part="button" />
          </span>
          <!--
            Одна отметка на счёт прошлого раза, лист строки не открывает; без прошлого счёта — лист отметки.
            Кнопка — в слоте «Обменял», слева от суммы (/ux Блока 1 «понятность»): суммы строк в одной колонке
            и до, и после отметки, число не прыгает.
          -->
          <span v-if="s.canMark" class="relative z-10 shrink-0" @click.stop>
            <SalaryRow button small :person-id="s.person" :period="monthKey" />
          </span>
          <div class="flex flex-col items-end">
            <b class="font-num text-[16px] num whitespace-nowrap" :class="s.came ? 'text-ink' : 'text-ink-2'">
              <span v-if="s.came" class="font-extrabold text-ok" data-came>✓ </span>{{ money(s.amount) }}
            </b>
            <span v-if="s.fx" class="text-[12.5px] font-semibold text-ink-2 num whitespace-nowrap" data-salary-fx>{{ moneyIn(s.fx.amount, s.fx.currency) }}</span>
          </div>
        </div>
      </template>
      <template v-if="canEdit">
        <div v-if="salaries.length" class="h-px bg-line" />
        <div><Button variant="ghost" size="sm" class="-ml-2" data-extra-income @click="incomeOpen = true">+ Внеплановый доход</Button></div>
      </template>
    </Card>

    <!-- Три раздела: строка — сумма и «N из M»; раскрытие — под кругом, один за раз -->
    <Card flush class="px-3.5 py-0.5" data-sections>
      <template v-for="s in sections" :key="s.key">
        <button
          type="button"
          class="press flex w-full cursor-pointer items-center gap-2.5 border-t border-line py-[13px] text-left first:border-t-0"
          :aria-expanded="opened === s.key"
          :data-section="s.key"
          @click="toggleSection(s.key)"
        >
          <span class="size-3 shrink-0 rounded-full" :style="{ background: `var(${s.color})` }" aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col leading-[1.2]">
            <span class="text-[16.5px] font-bold text-ink">
              {{ s.name
              }}<template v-if="s.dot"><span class="ml-1.5 inline-block size-2 rounded-full bg-brand align-middle" data-section-dot aria-hidden="true" /><span class="sr-only">, есть что сделать</span></template>
            </span>
            <span class="text-[12.5px] text-ink-2 num" data-section-meta>{{ s.meta }}</span>
          </span>
          <span class="font-num text-[16px] font-bold num text-ink">{{ plain(s.total) }}</span>
          <PhCaretRight :size="15" class="shrink-0 text-ink-3 transition-transform" :class="opened === s.key && 'rotate-90'" />
        </button>

        <!-- Платежи: по дням; подписки — одной строкой -->
        <div v-if="opened === 'dues' && s.key === 'dues'" class="pb-2.5" data-dues>
          <p v-if="!dueLines.length" class="py-2 type-meta">Платежей нет</p>
          <template v-for="l in dueLines" :key="l.key">
            <DueRow
              v-if="l.due"
              :id="l.key"
              :due="l.due"
              :mon="mon"
              :payer-name="personName(l.due.payer)"
              :note="dueNote(l.due)"
              :can-edit="canEdit"
              @open="payFor = l.key"
              @payer="askPayer(l.due)"
            />

            <!-- Подписки · N — свёрнуто; ✓ у группы — когда списались все; ручные группы — подзаголовками -->
            <div v-else-if="grouped.subs" class="border-t border-line first:border-t-0" data-subs>
              <button type="button" class="press flex w-full cursor-pointer items-center gap-2.5 py-[11px] text-left" :aria-expanded="subsOpen" @click="subsOpen = !subsOpen">
                <span class="grid w-[38px] shrink-0 place-items-center">
                  <span class="grid size-[30px] place-items-center rounded-[9px] bg-surface-2 text-[15px] text-ink-2" aria-hidden="true">↻</span>
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-[15.5px] font-semibold text-ink">Подписки · {{ grouped.subs.count }}</span>
                  <span class="text-[12.5px] text-ink-2 num" data-subs-status>
                    {{ grouped.subs.allPaid ? 'все списались' : `${grouped.subs.paid} из ${grouped.subs.count} списались` }}
                  </span>
                </span>
                <span class="font-num text-[15px] font-bold num whitespace-nowrap" :class="grouped.subs.allPaid ? 'font-semibold text-ink-2' : 'text-ink'">
                  <span v-if="grouped.subs.allPaid" class="font-extrabold text-ok" data-subs-done>✓ </span>{{ plain(grouped.subs.total) }}
                </span>
                <PhCaretRight :size="15" class="shrink-0 text-ink-3 transition-transform" :class="subsOpen && 'rotate-90'" />
              </button>
              <div v-if="subsOpen" class="mb-2 ml-[18px] border-l-2 border-line pl-3.5">
                <template v-for="g in grouped.subs.parts" :key="g.groupId ?? ''">
                  <p v-if="g.name" class="pb-0.5 pt-2.5 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-2">{{ g.name }}</p>
                  <DueRow
                    v-for="d in g.rows"
                    :id="dueKey(d)"
                    :key="d.targetId"
                    :due="d"
                    :mon="mon"
                    :payer-name="personName(d.payer)"
                    :note="dueNote(d)"
                    :can-edit="canEdit"
                    @open="payFor = dueKey(d)"
                    @payer="askPayer(d)"
                  />
                </template>
              </div>
            </div>

            <!-- «Освободится» — у своего платежа; пока зарплата не отложена, кнопка тихая -->
            <div v-if="extras.freed && freedAt === l.key" class="mb-2.5 flex items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[13.5px] text-ink num" data-freed>
              <span class="min-w-0 flex-1">{{ freedMeta }}</span>
              <Button size="sm" :variant="pending.length ? 'secondary' : 'default'" @click="onFreed">К «{{ extras.freed.name }}»</Button>
            </div>
          </template>
        </div>

        <!-- Траты каждого: план и факт по разделам -->
        <div v-if="opened === 'spend' && s.key === 'spend'" class="pb-1" data-spends>
          <div v-for="sp in plan.spend" :key="sp.by" class="flex flex-col gap-[9px] border-t border-line py-2.5 first:border-t-0" :data-spend="sp.by">
            <div class="flex items-center gap-2">
              <Avatar :id="sp.by" :name="personName(sp.by)" :size="24" />
              <b class="flex-1 text-[15.5px] text-ink">{{ personName(sp.by) }}</b>
              <span class="type-meta num">{{ sp.fact === null ? `план ${plain(sp.plan)}` : `${plain(sp.fact)} из ${plain(sp.plan)}` }}</span>
            </div>
            <component
              :is="canEdit ? 'button' : 'div'"
              v-for="r in sp.rows"
              :key="r.categoryId"
              :type="canEdit ? 'button' : undefined"
              class="flex flex-col gap-1 pl-8 text-left"
              :class="canEdit && 'press cursor-pointer'"
              :data-spend-row="r.categoryId"
              @click="editSpend(sp.by, r.categoryId, r.plan)"
            >
              <span class="flex w-full justify-between gap-2 text-[14px]">
                <span class="text-ink">{{ r.name }}</span>
                <span class="whitespace-nowrap text-ink-2 num"><b v-if="r.fact !== null" class="font-semibold text-ink">{{ plain(r.fact) }}</b>{{ r.fact !== null ? ' из ' : '' }}{{ plain(r.plan) }}</span>
              </span>
              <span class="block h-[5px] w-full overflow-hidden rounded-pill bg-track">
                <i class="block h-full rounded-pill bg-s8" :style="{ width: `${spendShare(r.fact, r.plan)}%` }" />
              </span>
            </component>
            <button v-if="canEdit" type="button" class="press self-start cursor-pointer pl-8 text-[13.5px] font-semibold text-ink-2" @click="editSpend(sp.by)">+ Раздел</button>
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
        </div>

        <!-- Цели и фонды по очереди: короткие строки; ⋮⋮ — выше раньше получает деньги; нажатие — «Отложил» -->
        <div v-if="opened === 'queue' && s.key === 'queue'" class="pb-1" data-queue-list>
          <div v-if="extras.closed" class="mb-2.5 flex items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[13.5px] text-ink num" data-closed>
            <span class="min-w-0 flex-1">{{ extras.closed.name }} закрыт · {{ money(extras.closed.amount) }}</span>
            <Button size="sm" :variant="pending.length ? 'secondary' : 'default'" @click="onClosed">Отложить</Button>
          </div>
          <div v-if="pending.length" class="pb-2 pt-0.5">
            <Button size="sm" data-put-all @click="savePuts(pending)">Отложил всё · {{ money(pendingTotal) }}</Button>
          </div>
          <SortableList
            :ids="queueIds"
            :disabled="!canEdit"
            :label="(id) => `Переставить: ${queueById.get(id)?.name ?? ''}`"
            @move="(id, i) => finance.moveInQueue(id, i)"
          >
            <template #default="{ id }">
              <template v-if="queueById.get(id)">
                <div
                  class="press relative flex cursor-pointer items-center gap-2.5 py-2.5"
                  :data-queue="id"
                  @click="openItem(queueById.get(id)!)"
                >
                  <button type="button" class="row-open flex min-w-0 flex-1 flex-col gap-px text-left" data-row-open>
                    <span class="truncate text-[15.5px] font-semibold" :class="queueById.get(id)!.paused ? 'text-ink-2' : 'text-ink'">{{ queueById.get(id)!.name }}</span>
                    <span v-if="statusOf(queueById.get(id)!)" class="text-[12px] num" :class="statusOf(queueById.get(id)!)!.warn ? 'text-warn' : 'text-ink-2'" data-status>
                      {{ statusOf(queueById.get(id)!)!.text }}
                    </span>
                  </button>
                  <button
                    v-if="canEdit && queueById.get(id)!.payer"
                    type="button"
                    data-no-drag
                    class="press relative z-10 shrink-0 cursor-pointer rounded-full"
                    :aria-label="`Платит ${personName(queueById.get(id)!.payer)}. Сменить`"
                    @click.stop="
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
                  <span
                    class="font-num text-[15px] num whitespace-nowrap"
                    :class="putById.get(id)?.done || queueById.get(id)!.paused ? 'font-semibold text-ink-2' : 'font-bold text-ink'"
                    data-given
                  >
                    <span v-if="putById.get(id)?.done" class="font-extrabold text-ok" data-put-done>✓ </span>{{ plain(queueById.get(id)!.given) }}
                  </span>
                  <span v-if="canEdit" data-no-drag class="relative z-10 shrink-0" @click.stop>
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
            class="press flex w-full cursor-pointer items-center border-t border-line py-2.5 text-left text-[14.5px] font-semibold text-ink-2 first:border-t-0"
            @click="addFund(k)"
          >
            + {{ k === 'reserve' ? 'Запас' : 'Подушка' }}
          </button>
          <p v-if="!queueIds.length && !missingFunds.length" class="py-3 type-meta">Целей нет</p>
        </div>
      </template>
    </Card>

    <!-- Итога «Отложим · Потратим · Остаётся» нет (Р-116): повтор кольца и строк разделов. -->

    <!-- Зарплата: своя и ждём — «Пришла» (и «Другая сумма или счёт»); тихо — отметка пришедшей и «Изменить оклад» -->
    <SalarySheet :month-key="monthKey" :line="salarySheet" @close="salaryFor = null" />
    <ExtraIncomeSheet :open="incomeOpen" @close="incomeOpen = false" />

    <!-- Платёж: одна кнопка «Оплатил»; тихо — «Изменить платёж» -->
    <Sheet :open="!!paySheet" :title="paySheet?.name ?? ''" @close="payFor = null">
      <template v-if="paySheet">
        <p class="type-meta">{{ dayLabel(paySheet.day, monthKey) }}{{ paySheet.payer ? ` · платит ${personName(paySheet.payer)}` : '' }}</p>
        <p class="mb-3 font-num text-[32px] font-bold leading-tight num text-ink">{{ dueNote(paySheet) ? '≈ ' : '' }}{{ money(paySheet.amount) }}</p>
        <div class="flex flex-col gap-1.5">
          <template v-if="paySheet.paid">
            <p class="p-1 text-center text-[14px] font-semibold text-ok" data-paid>{{ givenDue(paySheet) ? '✓ Отдал' : '✓ Оплачено' }}</p>
            <Button variant="ghost" size="md" class="w-full" data-unpay @click="unpay(paySheet)">Не оплачено</Button>
          </template>
          <Button v-else class="w-full" data-pay @click="pay(paySheet)">{{ givenDue(paySheet) ? 'Отдал' : 'Оплатил' }}</Button>
          <Button variant="ghost" size="md" class="w-full" @click="editDue(paySheet)">Изменить платёж</Button>
        </div>
      </template>
    </Sheet>
    <MarkSheet
      v-if="markFor"
      open="mark"
      :kind="markFor.due.kind"
      :target-id="markFor.due.targetId"
      :period="monthKey"
      :title="markFor.due.name"
      :amount="markFor.due.amount"
      :account="markFor.account"
      :first-time="markFor.account === undefined"
      @close="markFor = null"
    />

    <!-- Цель: одна кнопка «Отложил»; отложенное планом — «Не отложено» -->
    <Sheet :open="!!putSheet" :title="putSheet?.name ?? ''" @close="putFor = null">
      <template v-if="putSheet">
        <p class="type-meta">{{ monthName }}{{ putSheet.payer ? ` · откладывает ${personName(putSheet.payer)}` : '' }}</p>
        <p class="mb-3 font-num text-[32px] font-bold leading-tight num text-ink">{{ money(putSheet.amount) }}</p>
        <div class="flex flex-col gap-1.5">
          <template v-if="putSheet.done">
            <p class="p-1 text-center text-[14px] font-semibold text-ok" data-put>✓ Отложено</p>
            <Button v-if="putSheet.undo > 0" variant="ghost" size="md" class="w-full" data-unput @click="onUnput(putSheet)">Не отложено</Button>
          </template>
          <template v-else>
            <p v-if="putSheet.put > 0" class="text-center type-meta num">уже отложено {{ plain(putSheet.put) }}</p>
            <Button class="w-full" data-put-one @click="onPut(putSheet)">Отложил{{ putSheet.put > 0 ? ` · ${money(putSheet.left)}` : '' }}</Button>
          </template>
          <Button variant="ghost" size="md" class="w-full" @click="openDetail(putSheet)">{{ putSheet.kind === 'debt' ? 'Сумма в месяц' : 'Открыть цель' }}</Button>
        </div>
      </template>
    </Sheet>

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
        <p class="text-center text-[12.5px] text-ink-2">С {{ monthFrom(monthKey, false) }} и дальше</p>
      </div>
    </Sheet>

    <!-- Сумма раздела трат -->
    <Sheet :open="!!spendEdit" :title="spendEdit?.fresh ? 'Траты на месяц' : 'Сколько в месяц'" @close="spendEdit = null">
      <template v-if="spendEdit">
        <Field v-if="spendEdit.fresh" label="Раздел" name="category">
          <Select v-model="spendEdit.categoryId" :options="categories.map((c) => ({ value: c.id, label: c.name }))" class="mb-3" />
        </Field>
        <Field :label="`${personName(spendEdit.by)}, ₸ в месяц`">
          <NumField v-model="spendEdit.amount" placeholder="50 000" />
        </Field>
        <Button class="w-full" @click="spendForm.submit(saveSpend)">Готово</Button>
      </template>
    </Sheet>

    <!-- Сумма карточки «закрыть кредит» -->
    <Sheet :open="debtEdit !== null" :title="debtName || 'Закрыть кредит'" @close="debtEdit = null">
      <template v-if="debtEdit !== null">
        <Field label="Сверх графика, ₸ в месяц">
          <NumField v-model="debtEdit" placeholder="50 000" />
        </Field>
        <Button class="w-full" @click="saveDebt">Готово</Button>
      </template>
    </Sheet>

    <!-- «Ближе на N дней» (PN-09): тост после «Отложил», в оболочке — над вкладками -->
    <Toast v-if="closerNote"><span data-closer>{{ closerNote }}</span></Toast>
  </div>
</template>
