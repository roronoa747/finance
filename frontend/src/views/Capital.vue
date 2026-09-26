<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  PhBank,
  PhCreditCard,
  PhCoins,
  PhWallet,
  PhHouse,
  PhPlus,
  PhFolderSimple,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import { MONTHS_NOM, atLabel, monthIn, monthKey, parseMonthKey } from '@/lib/dates'
import {
  amountAt,
  costliestCredits,
  creditOutlook,
  fxToTenge,
  goalSavings,
  groupChildren,
  groupTotal,
  halfOverpayExtra,
  installmentMonths,
  isSubscription,
  liveAccounts,
  liveCredits,
  liveGoals,
  liveGroups,
  liveObligations,
  payableAccounts,
  paymentSplit,
  netWorth,
  nextChange,
  nextCreditDue,
  openCredits,
  stepDue,
  prepayOutcome,
  prepaySaved,
  rateFromSchedule,
  scheduleMismatch,
  yearShare,
} from '@/lib/finance'
import type { Account, Credit, Currency, Obligation, Person, PersonId } from '@/types/finance'
import { categoryName, type CategoryKey } from '@/lib/palette'
import { cn, plural } from '@/lib/utils'
import { fetchRates, formRate, type FxRates } from '@/lib/fx'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Button from '@/components/ui/Button.vue'
import StrategyCompare from '@/components/StrategyCompare.vue'
import AccountSheet from '@/components/capital/AccountSheet.vue'
import CreditSheet from '@/components/capital/CreditSheet.vue'
import ObligationSheet from '@/components/capital/ObligationSheet.vue'
import PayoffSheet from '@/components/capital/PayoffSheet.vue'
import PlanStepAction from '@/components/PlanStepAction.vue'
import Input from '@/components/ui/Input.vue'

const props = withDefaults(
  defineProps<{
    /** Вкладка «Что гасить первым» на старте — для SSR-тестов. */
    initialAdvice?: 'order' | 'strategy'
    /** Стартовые поля формы долга — для SSR-тестов (форма открывается по ?add=debt). */
    initialDebt?: { mode?: 'none' | 'rate' | 'term'; principal?: string; payment?: string; term?: string }
  }>(),
  { initialAdvice: 'order' },
)

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const people = computed(() => financeStore.people)
const allAccounts = computed(() => financeStore.accounts)
const accounts = computed(() => liveAccounts(allAccounts.value))
// Куда ложится внеплановый доход (как и досрочка калькулятора): у валютного счёта тенге —
// по курсу, и следующая правка курса или суммы в валюте молча стёрла бы сдвиг.
const payAccounts = computed(() => payableAccounts(allAccounts.value))
const householdAccounts = computed(() => liveAccounts(financeStore.householdAccounts))
const privateAccounts = computed(() => liveAccounts(financeStore.privateAccounts))
const credits = computed(() => liveCredits(financeStore.credits))
const obligations = computed(() => liveObligations(financeStore.obligations))
const goals = computed(() => liveGoals(financeStore.goals))

const totalNetWorth = computed(() => netWorth(accounts.value, credits.value, goals.value))
const totalAccountsAmount = computed(() => accounts.value.reduce((a, x) => a + x.amount, 0))
const totalHouseholdAmount = computed(() => householdAccounts.value.reduce((a, x) => a + x.amount, 0))
const totalPrivateAmount = computed(() => privateAccounts.value.reduce((a, x) => a + x.amount, 0))
const totalSaved = computed(() => goalSavings(goals.value))
const totalDebts = computed(() => credits.value.reduce((a, c) => a + c.principal, 0))
const totalPrepaySaved = computed(() => prepaySaved(financeStore.payments, financeStore.credits))

const groups = computed(() => liveGroups(financeStore.obligations))
// Подписка группы, которой больше нет, показывается сама по себе.
const ungrouped = computed(() =>
  obligations.value.filter((o) => !o.parentId || !groups.value.some((g) => g.id === o.parentId)),
)

function obligationSub(o: Obligation): string {
  if (nextChange(o, key.value)) return 'сумма изменится'
  return o.every === 'year' ? 'в год' : 'в месяц'
}

function groupNote(g: Obligation): string {
  const n = groupChildren(g, financeStore.obligations).length
  return `${n} ${plural(n, 'подписка', 'подписки', 'подписок')}${g.noAsk ? ' · рабочие' : ''}`
}

/**
 * «24 платежа» в строке кредита: сколько осталось при нынешнем платеже. Закрытый и
 * незакрываемый долг — словами, как модалка и калькулятор (`creditOutlook` не
 * различает их сам).
 */
function paymentsLeft(c: Credit): string {
  if (c.principal <= 0) return 'долг закрыт'
  const out = creditOutlook(c)
  if (!out.closes) return 'долг не закрывается'
  return `${out.months} ${plural(out.months, 'платёж', 'платежа', 'платежей')}`
}

/** «переплата 123 456» под суммой строки — только у долга, который закрывается с переплатой. */
function creditSub(c: Credit): string | undefined {
  const out = creditOutlook(c)
  return out.closes && out.overpay > 0 ? `переплата ${plain(out.overpay)}` : undefined
}

/** Строка кредита: ставка, сколько платежей и следующий платёж — в долг и банку (Р-8). */
function creditNote(c: Credit): string {
  const head = `${c.annualRate > 0 ? 'ГЭСВ ' + ratePct(c.annualRate, 1) : 'без процентов'} · ${paymentsLeft(c)}`
  const due = nextCreditDue(c, financeStore.payments)
  if (!due) return head
  const split = paymentSplit(null, c, due.amount)
  return `${head} · платёж ${plain(due.amount)} ₸: в долг ${plain(split.body)}, банку ${plain(split.interest)}`
}

function obligationNote(o: Obligation, members: Person[]): string {
  const parts: string[] = []
  const owner = o.who ? members.find((p) => p.id === o.who)?.name : null
  if (owner) parts.push(owner)
  if (o.every === 'year') parts.push('раз в год')
  if (o.estimate) parts.push('оценка')
  if (o.note && !parts.length) parts.push(o.note)
  return parts.join(' · ')
}

// Dialog States
const accountOpen = ref(false)
const selectedAccountId = ref<string | null>(null)
const addDebtOpen = ref(false)
const selectedCreditId = ref<string | null>(null)
const addObligationOpen = ref(false)
const selectedObligationId = ref<string | null>(null)
const payoffCreditId = ref<string | null>(null)
const extraIncomeOpen = ref(false)
const addGroupOpen = ref(false)
const selectedGroupId = ref<string | null>(null)

// Окна открываются и по адресу: «+» в шапке, строки Бюджета и Обзора.
watch(
  () => route.query,
  (q) => {
    if (q.add === 'debt') addDebtOpen.value = true
    if (q.add === 'payment') addObligationOpen.value = true
    if (typeof q.credit === 'string') selectedCreditId.value = q.credit
    if (typeof q.obligation === 'string') selectedObligationId.value = q.obligation
    if (typeof q.payoff === 'string') payoffCreditId.value = q.payoff
    if (q.income === '1') extraIncomeOpen.value = true
  },
  { immediate: true },
)

/* ------------------ Внеплановый доход ------------------ */
const extraIncomeAmount = ref('')
const extraIncomeBy = ref<PersonId>('a')
const extraIncomeTarget = ref('')

const extraIncomeValue = computed(() => parseMoney(extraIncomeAmount.value))
const canApplyExtraIncome = computed(
  () => extraIncomeValue.value > 0 && Boolean(extraIncomeTarget.value),
)

function applyExtraIncome() {
  if (!canApplyExtraIncome.value) return
  const [kind, id] = extraIncomeTarget.value.split(':')
  if (kind === 'goal') {
    financeStore.contribute(id, extraIncomeValue.value, extraIncomeBy.value, 'Внеплановый доход')
  } else {
    // Сдвиг остатка, а не сверка: отметки оплат до дохода продолжают считаться.
    financeStore.shiftAccountAmount(id, extraIncomeValue.value)
  }
  extraIncomeAmount.value = ''
  extraIncomeTarget.value = ''
  extraIncomeOpen.value = false
}

/* ------------------ Добавление счета ------------------ */
const newAccountKind = ref<Account['kind']>('card')
const newAccountName = ref('')
const newAccountAmount = ref('')
const newAccountCurrency = ref<Currency>('KZT')
const newAccountRate = ref('')
/** Курс вписан руками — авто-курс его больше не перезаписывает. */
const rateTouched = ref(false)
const newAccountDepositRate = ref('')
const newAccountIsPrivate = ref(false)
const rateInfo = ref<FxRates | null>(null)
const rateBusy = ref(false)
const rateFailed = ref(false)

const accountKinds: { value: Account['kind']; label: string }[] = [
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
  { value: 'deposit', label: 'Вклад' },
  { value: 'envelope', label: 'Конверт' },
]

const isForeign = computed(() => newAccountCurrency.value !== 'KZT')
const parsedAccountAmount = computed(() => parseMoney(newAccountAmount.value))
const rateValue = computed(() => parseFloat(newAccountRate.value.replace(',', '.')))
const accountInTenge = computed(() =>
  isForeign.value
    ? fxToTenge(parsedAccountAmount.value, Number.isFinite(rateValue.value) ? rateValue.value : 0)
    : parsedAccountAmount.value,
)
/** Откуда курс — три состояния запроса (React `AddAccountDialog`). Дата — «25.09.2026». */
const rateNote = computed(() =>
  rateBusy.value
    ? 'Запрашиваем курс Нацбанка…'
    : rateInfo.value
      ? `Курс ${rateInfo.value.source} на ${rateInfo.value.date.split('-').reverse().join('.')}. Можно заменить своим.`
      : rateFailed.value
        ? 'Курс Нацбанка сейчас недоступен — впишите вручную.'
        : '',
)
const canCreateAccount = computed(
  () => parsedAccountAmount.value > 0 && (!isForeign.value || accountInTenge.value > 0),
)

watch([accountOpen, isForeign], async ([open, foreign]) => {
  if (!open || !foreign || rateInfo.value || rateBusy.value) return
  rateBusy.value = true
  try {
    const res = await fetchRates()
    if (res) rateInfo.value = res
    else rateFailed.value = true
  } finally {
    rateBusy.value = false
  }
})

watch(accountOpen, (open) => {
  if (open) rateTouched.value = false
})

watch([rateInfo, newAccountCurrency], ([info, cur]) => {
  newAccountRate.value = formRate(info, cur, newAccountRate.value, rateTouched.value)
})

function createAccount() {
  if (!canCreateAccount.value) return
  const annual = parseFloat(newAccountDepositRate.value.replace(',', '.'))
  financeStore.addAccount(
    {
      name:
        newAccountName.value.trim() ||
        accountKinds.find((k) => k.value === newAccountKind.value)!.label,
      note: isForeign.value ? `${plain(parsedAccountAmount.value)} ${newAccountCurrency.value}` : '',
      amount: accountInTenge.value,
      kind: newAccountKind.value,
      ...(isForeign.value
        ? {
            currency: newAccountCurrency.value,
            foreignAmount: parsedAccountAmount.value,
            rate: rateValue.value,
            rateAt: new Date().toISOString(),
          }
        : {}),
      ...(newAccountKind.value === 'deposit' && Number.isFinite(annual) && annual > 0
        ? { deposit: { annualRate: annual / 100, months: 12, monthlyTopUp: 0, capitalize: true } }
        : {}),
    },
    newAccountIsPrivate.value,
  )
  newAccountName.value = ''
  newAccountAmount.value = ''
  newAccountRate.value = ''
  newAccountDepositRate.value = ''
  newAccountIsPrivate.value = false
  accountOpen.value = false
}

/* ------------------ Карточка долга / добавление ------------------ */
const debtName = ref('')
const debtPrincipal = ref(props.initialDebt?.principal ?? '')
const debtPayment = ref(props.initialDebt?.payment ?? '')
const debtMode = ref<'none' | 'rate' | 'term'>(props.initialDebt?.mode ?? 'none')
const debtRate = ref('')
const debtTerm = ref(props.initialDebt?.term ?? '')
const debtDay = ref('12')

const leftPrincipal = computed(() => parseMoney(debtPrincipal.value))
const paymentVal = computed(() => parseMoney(debtPayment.value))
const termMonths = computed(() => parseMoney(debtTerm.value))

const typedRate = computed(() => {
  const v = parseFloat(debtRate.value.replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v / 100 : null
})
const derivedRate = computed(() =>
  debtMode.value === 'term'
    ? rateFromSchedule(leftPrincipal.value, paymentVal.value, termMonths.value)
    : null,
)
const resolvedRate = computed(() =>
  debtMode.value === 'none' ? 0 : debtMode.value === 'rate' ? typedRate.value ?? 0 : derivedRate.value ?? 0,
)
// Сколько платежей выходит без процентов. С этим числом сверяем срок, названный
// человеком: расхождение почти всегда означает лишний платёж.
const plainMonths = computed(() => installmentMonths(leftPrincipal.value, paymentVal.value))
// Срок назван, а ставка из него не выводится — форма не отказывает, а объясняет.
const mismatch = computed(() =>
  debtMode.value === 'term'
    ? scheduleMismatch(leftPrincipal.value, paymentVal.value, termMonths.value)
    : null,
)
const canCreateDebt = computed(() => leftPrincipal.value > 0 && paymentVal.value > 0)

function createDebt() {
  if (!canCreateDebt.value) return
  financeStore.addCredit({
    name: debtName.value.trim() || 'Долг',
    note: resolvedRate.value > 0 ? 'ежемесячный платёж' : 'рассрочка',
    principal: leftPrincipal.value,
    annualRate: resolvedRate.value,
    payment: paymentVal.value,
    day: Math.min(28, Math.max(1, parseMoney(debtDay.value) || 1)),
  })
  debtName.value = ''
  debtPrincipal.value = ''
  debtPayment.value = ''
  debtRate.value = ''
  debtTerm.value = ''
  debtMode.value = 'none'
  addDebtOpen.value = false
}

/* ------------------ Добавление регулярного платежа ------------------ */
const obName = ref('')
const obAmount = ref('')
const obEvery = ref<'month' | 'year'>('month')
const obMonth = ref(String(parseMonthKey(monthKey()).month + 1))
const obDay = ref('10')
const obWho = ref<'all' | PersonId>('all')
const obCategory = ref<CategoryKey>('d4')
const obEstimate = ref(false)

// Разделы, куда кладётся платёж (React `AddObligationDialog`): цели и свободный
// остаток — не корзины. Разделы заводятся лениво — имя берётся из запасных.
const obBuckets = computed(() =>
  (['d1', 'd2', 'd4'] as CategoryKey[]).map((key) => ({ key, name: categoryName(financeStore.categories, key) })),
)

const canCreateObligation = computed(
  () => obName.value.trim().length > 0 && parseMoney(obAmount.value) > 0,
)

function createObligation() {
  if (!canCreateObligation.value) return
  financeStore.addObligation({
    name: obName.value.trim(),
    note: obEvery.value === 'year' ? 'раз в год' : 'ежемесячно',
    day: Math.min(28, Math.max(1, parseMoney(obDay.value) || 1)),
    category: obCategory.value,
    estimate: obEstimate.value,
    every: obEvery.value,
    month: obEvery.value === 'year' ? Math.min(12, Math.max(1, parseMoney(obMonth.value) || 1)) : undefined,
    who: obWho.value === 'all' ? null : obWho.value,
    amount: parseMoney(obAmount.value),
  })
  obName.value = ''
  obAmount.value = ''
  obEstimate.value = false
  addObligationOpen.value = false
}

/* ------------------ Группы подписок (RP-09) ------------------ */
/** Флаг группы: спрашивать ли «оставить?» о её подписках. */
const NO_ASK_OPTIONS = [
  { value: false, label: 'Спрашивать' },
  { value: true, label: 'Рабочие — нет' },
]
const groupName = ref('')
const groupNoAsk = ref(false)

function createGroup() {
  const name = groupName.value.trim()
  if (!name) return
  financeStore.addGroup(name, groupNoAsk.value)
  groupName.value = ''
  groupNoAsk.value = false
  addGroupOpen.value = false
}

const activeGroup = computed(() => groups.value.find((g) => g.id === selectedGroupId.value))
/** Подписки, которые можно положить в открытую группу. */
const groupCandidates = computed(() =>
  obligations.value.filter((o) => isSubscription(o) && o.parentId !== selectedGroupId.value),
)

/* ------------------ Анализ долгов (DebtAdvice) ------------------ */
// «Открыть калькулятор» с экрана плана — сразу на вкладке «Копить или гасить».
const adviceView = ref<'order' | 'strategy'>(route.query.advice === 'strategy' ? 'strategy' : props.initialAdvice)
const rankedDebts = computed(() =>
  costliestCredits(credits.value).map((c) => ({ credit: c, cost: creditOutlook(c) })),
)
const worstDebt = computed(() => rankedDebts.value[0] || null)
const worstHalfExtra = computed(() =>
  worstDebt.value
    ? halfOverpayExtra(
        worstDebt.value.credit.principal,
        worstDebt.value.credit.annualRate,
        worstDebt.value.credit.payment,
      )
    : null,
)
const worstGain = computed(() =>
  worstDebt.value && worstHalfExtra.value
    ? prepayOutcome(worstDebt.value.credit, worstHalfExtra.value, 'monthly')
    : null,
)

/* ------------------ План «Сначала долги» (PV-15) ------------------ */
const plan = computed(() => financeStore.activePlan)
const planNow = computed(() => financeStore.planStepNow())

function choosePlan(opts: { keptGoalIds: string[]; cushionGoalId: string | null; months: 12 | 24 | 36; lump: number }) {
  if (financeStore.choosePlan(opts, authStore.slot ?? 'a')) void router.push('/plan')
}

/** Шаг плана в строке его кредита (PV-16, Р-6): вместо `credits[0]` — долг, который план гасит сейчас. */
function planLine(c: Credit): string {
  const s = planNow.value
  if (s?.kind !== 'prepay' || s.creditId !== c.id) return ''
  if (s.applied) return `внесено по плану · ${plain(s.applied.amount)} ₸ · ${atLabel(s.applied.at)}`
  return planDue(c) ? `шаг плана: ${plain(s.amount)} ₸ в ${monthIn(key.value)}` : ''
}
const planDue = (c: Credit) => {
  const s = stepDue(planNow.value)
  return s?.creditId === c.id ? s : null
}
// «Изменить режим»: окно досрочки с суммой шага — там можно «снизить платёж» (Р-10); запись
// пойдёт с id плана, и план пересчитается от факта.
const payoffPlan = ref<{ id: string; amount: number; creditId: string } | null>(null)
function changePlanMode(c: Credit) {
  const s = planDue(c)
  if (!s || !plan.value) return
  payoffPlan.value = { id: plan.value.id, amount: s.amount, creditId: c.id }
  payoffCreditId.value = c.id
}

/* ------------------ Окна по адресу (Б-15) ------------------ */
/** Параметры адреса, которыми открываются окна. */
const QUERY_KEYS = ['add', 'income', 'credit', 'obligation', 'payoff']
const queryModalOpen = computed(
  () =>
    addDebtOpen.value ||
    addObligationOpen.value ||
    extraIncomeOpen.value ||
    // Окно показано, а не только id в ref: удалённая синком запись закрывает лист,
    // но id остаётся — адрес тогда не очистился бы никогда. Окна — в `components/capital/`
    // и ищут запись среди тех же живых кредитов и обязательств.
    credits.value.some((c) => c.id === selectedCreditId.value || c.id === payoffCreditId.value) ||
    obligations.value.some((o) => o.id === selectedObligationId.value),
)
// Все такие окна закрылись — адрес очищается (React `setParams({}, { replace: true })`),
// каким бы путём их ни закрыли: крестик, фон, Escape, «Готово», запись формы. Иначе
// тот же «+» ведёт на тот же адрес, перехода нет — и окно больше не открывается.
watch(queryModalOpen, (open) => {
  if (open || !QUERY_KEYS.some((k) => k in route.query)) return
  const q = { ...route.query }
  for (const k of QUERY_KEYS) delete q[k]
  void router.replace({ query: q })
})
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1">
    <!-- Чистый капитал (Net Worth) -->
    <Card>
      <div class="flex items-center gap-1.5 text-[13px] text-ink-2">
        Чистый капитал
        <Hint>
          Всё, что есть, минус всё, что должны. Личные счета и накопления по целям тоже считаются:
          это ваши деньги, даже если отдельный счёт под них не заведён.
        </Hint>
      </div>
      <div class="font-display text-[30px] font-semibold tracking-[-0.025em] num text-ink">
        {{ money(totalNetWorth) }}
      </div>

      <div class="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
        <div v-if="accounts.length > 0" class="flex justify-between">
          <span class="text-ink-2">На всех счетах</span>
          <b class="num text-ink">{{ money(totalAccountsAmount) }}</b>
        </div>
        <div v-if="privateAccounts.length > 0" class="flex justify-between text-ink-3">
          <span class="text-ink-3">Семья / Личный кошелёк</span>
          <b class="num text-ink-2">{{ money(totalHouseholdAmount) }} / {{ money(totalPrivateAmount) }}</b>
        </div>
        <div v-if="totalSaved > 0" class="flex justify-between">
          <span class="text-ink-2">Накоплено по целям</span>
          <b class="num text-ink">{{ money(totalSaved) }}</b>
        </div>
        <div v-if="credits.length > 0" class="flex justify-between">
          <span class="text-ink-2">Долги</span>
          <b class="num text-warn">−{{ plain(totalDebts) }} ₸</b>
        </div>
      </div>
    </Card>

    <!-- Счета: общие и личные -->
    <Section title="Где лежат деньги" />
    <Card flush>
      <Row
        v-for="a in accounts"
        :key="a.id"
        :title="a.name"
        :note="
          a.currency
            ? `${plain(a.foreignAmount ?? 0)} ${a.currency} · курс ${String(a.rate).replace('.', ',')}`
            : a.deposit
              ? `${a.note || 'Вклад'} · ${ratePct(a.deposit.annualRate, 1)} годовых`
              : a.note || ''
        "
        :value="money(a.amount)"
        :sub="a.deposit ? 'условия вклада' : undefined"
        clickable
        @click="a.deposit ? router.push(`/capital/${a.id}`) : (selectedAccountId = a.id)"
      >
        <template #icon>
          <PhBank v-if="a.kind === 'deposit'" :size="17" />
          <PhCoins v-else-if="a.kind === 'cash'" :size="17" />
          <PhWallet v-else-if="a.kind === 'envelope'" :size="17" />
          <PhCreditCard v-else :size="17" />
        </template>
        <template #value>
          <div class="flex items-center gap-1.5 justify-end">
            <Tag v-if="privateAccounts.some((p) => p.id === a.id)" tone="brand">Личный</Tag>
            <span class="block text-[14.5px] font-semibold num text-ink">{{ money(a.amount) }}</span>
          </div>
        </template>
      </Row>
      <div v-if="!accounts.length" class="px-4 py-6 text-center text-[13px] text-ink-3">
        Счетов пока нет
      </div>
    </Card>

    <Button variant="outline" class="w-full bg-surface-2" @click="accountOpen = true">
      <PhPlus :size="16" weight="bold" /> Добавить счёт или накопления
    </Button>

    <!-- Обязательства и кредиты -->
    <Section title="Обязательства" />
    <Card flush>
      <!-- Кредиты -->
      <Row
        v-for="c in credits"
        :key="c.id"
        :title="c.name"
        :value="money(c.principal)"
        :sub="creditSub(c)"
        clickable
        @click="selectedCreditId = c.id"
      >
        <template #icon>
          <PhCreditCard :size="17" />
        </template>
        <template #note>
          <span class="block text-[12.5px] text-ink-3">{{ creditNote(c) }}</span>
          <span v-if="planLine(c)" class="block text-[12.5px] font-medium text-brand num">{{ planLine(c) }}</span>
        </template>
        <!-- Под строкой, а не действием справа: на 390px кнопка сжимала подпись кредита в столбик. -->
        <div v-if="planDue(c) && !authStore.isViewer" class="mx-4 -mt-0.5 mb-3 flex items-center gap-3">
          <PlanStepAction />
          <button
            type="button"
            class="text-[12.5px] text-brand hover:underline cursor-pointer"
            @click="changePlanMode(c)"
          >
            Изменить режим
          </button>
        </div>
      </Row>

      <!-- Обязательства вне групп -->
      <Row
        v-for="o in ungrouped"
        :key="o.id"
        :title="o.name"
        :note="obligationNote(o, people)"
        :value="money(amountAt(o, key))"
        :sub="obligationSub(o)"
        clickable
        @click="selectedObligationId = o.id"
      >
        <template #icon>
          <PhHouse :size="17" />
        </template>
      </Row>

      <!-- Группы подписок: итог и подписки внутри (Р-20) -->
      <template v-for="g in groups" :key="g.id">
        <Row
          :title="g.name"
          :note="groupNote(g)"
          :value="money(groupTotal(g, financeStore.obligations, key))"
          sub="в месяц"
          clickable
          @click="selectedGroupId = g.id"
        >
          <template #icon>
            <PhFolderSimple :size="17" />
          </template>
        </Row>
        <div class="border-b border-line pl-6 last:border-b-0">
          <Row
            v-for="o in groupChildren(g, financeStore.obligations)"
            :key="o.id"
            :title="o.name"
            :note="obligationNote(o, people)"
            :value="money(amountAt(o, key))"
            :sub="obligationSub(o)"
            clickable
            @click="selectedObligationId = o.id"
          />
        </div>
      </template>

      <div
        v-if="!credits.length && !obligations.length && !groups.length"
        class="px-4 py-6 text-center text-[13px] text-ink-3"
      >
        Обязательств пока нет
      </div>
    </Card>

    <p v-if="totalPrepaySaved > 0" class="-mt-1 px-1 text-[12.5px] text-ink-2">
      Досрочками уже сэкономили на процентах
      <b class="num text-brand">{{ money(totalPrepaySaved) }}</b>
    </p>

    <div class="flex flex-col gap-2">
      <Button variant="outline" class="w-full bg-surface-2" @click="addObligationOpen = true">
        <PhPlus :size="16" weight="bold" /> Подписка или услуга
      </Button>
      <Button variant="outline" class="w-full bg-surface-2" @click="addDebtOpen = true">
        <PhPlus :size="16" weight="bold" /> Долг или рассрочка
      </Button>
      <Button variant="outline" class="w-full bg-surface-2" @click="addGroupOpen = true">
        <PhFolderSimple :size="16" /> Группа подписок
      </Button>
    </div>

    <!-- Советник: Что гасить первым & Досрочка -->
    <template v-if="worstDebt">
      <Section title="Что гасить первым" />
      <Card>
        <div class="mb-3">
          <Segmented
            v-model="adviceView"
            :options="[
              { value: 'order', label: 'Какой первым' },
              { value: 'strategy', label: 'Копить или гасить' },
            ]"
          />
        </div>

        <div v-if="adviceView === 'order'">
          <div class="text-[13px] text-ink-2">Самая дорогая ставка</div>
          <div class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
            {{ worstDebt.credit.name }}
          </div>

          <div class="mt-3 flex flex-col gap-1.5 border-t border-line pt-3 text-[13px]">
            <div class="flex justify-between">
              <span class="text-ink-2">Ставка</span>
              <b class="num text-ink">{{ ratePct(worstDebt.credit.annualRate, 1) }}</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">Проценты в месяц</span>
              <b class="num text-warn">{{ money(worstDebt.cost.monthlyInterest) }}</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">Доля платежа в проценты</span>
              <b class="num text-ink">{{ worstDebt.cost.sharePct }}%</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">
                {{ worstDebt.cost.closes ? 'Переплата до конца' : 'Долг не закрывается' }}
              </span>
              <b class="num text-warn">
                {{
                  worstDebt.cost.closes
                    ? money(worstDebt.cost.overpay)
                    : 'платёж меньше процентов'
                }}
              </b>
            </div>
          </div>

          <p class="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            {{
              worstDebt.cost.sharePct >= 50
                ? 'Больше половины платежа уходит в проценты, поэтому остаток почти не двигается. Такой долг выгоднее закрыть раньше остальных, даже если он самый маленький.'
                : 'Здесь самая высокая ставка из ваших долгов, поэтому каждый лишний тенге, внесённый сюда, экономит больше, чем в любом другом.'
            }}
          </p>

          <div
            v-if="worstGain && worstHalfExtra"
            class="mt-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3"
          >
            <div class="text-[12.5px] text-ink-2">Половину переплаты снимает добавка в</div>
            <div class="mt-1 font-display text-[19px] font-semibold tracking-[-0.02em] num text-brand">
              {{ money(worstHalfExtra) }} в месяц
            </div>
            <div class="mt-0.5 text-[13px] text-ink-2 num">
              это минус {{ worstGain.monthsSaved }} мес. и экономия {{ money(worstGain.saved) }}
            </div>
          </div>

          <Button
            variant="outline"
            class="mt-3 w-full bg-surface-2"
            @click="payoffCreditId = worstDebt.credit.id"
          >
            Посчитать на свою сумму
          </Button>
        </div>

        <!-- Копить или гасить -->
        <StrategyCompare
          v-else
          :credits="openCredits(credits)"
          :goals="goals"
          :obligations="obligations"
          :month-key="key"
          :payments="financeStore.payments"
          :plan="plan"
          :step="planNow"
          :can-choose="!authStore.isViewer"
          @choose="choosePlan"
        />
      </Card>
    </template>

    <!-- МОДАЛКА: Добавить счет -->
    <Sheet :open="accountOpen" title="Счёт или накопления" @close="accountOpen = false">
      <Field label="Приватность счёта" group>
        <div class="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', !newAccountIsPrivate ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
            @click="newAccountIsPrivate = false"
          >
            Общий (семья)
          </button>
          <button
            type="button"
            :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', newAccountIsPrivate ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
            @click="newAccountIsPrivate = true"
          >
            Личный (только мне)
          </button>
        </div>
      </Field>

      <Field label="Что это" group>
        <div class="grid grid-cols-2 gap-2 mb-3">
          <button
            v-for="k in accountKinds"
            :key="k.value"
            type="button"
            :class="cn('rounded-xl border px-3 py-2 text-[13px] transition-colors cursor-pointer', newAccountKind === k.value ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2')"
            @click="newAccountKind = k.value"
          >
            {{ k.label }}
          </button>
        </div>
      </Field>

      <Field label="Название">
        <Input v-model="newAccountName" placeholder="Например, Kaspi Gold" class="mb-3" />
      </Field>

      <Field label="Валюта" group>
        <div class="grid grid-cols-4 gap-2 mb-3">
          <button
            v-for="c in (['KZT', 'USD', 'EUR', 'RUB'] as Currency[])"
            :key="c"
            type="button"
            :class="cn('rounded-xl border px-3 py-2 text-[13px] transition-colors cursor-pointer', newAccountCurrency === c ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2')"
            @click="newAccountCurrency = c"
          >
            {{ c === 'KZT' ? '₸' : c === 'USD' ? '$' : c === 'EUR' ? '€' : '₽' }}
          </button>
        </div>
      </Field>

      <Field :label="isForeign ? `Сумма в ${newAccountCurrency}` : 'Сумма, ₸'">
        <NumField v-model="newAccountAmount" class="mb-3" />
      </Field>

      <div v-if="isForeign" class="mb-3 flex flex-col gap-2">
        <Field :label="`Курс: сколько тенге за 1 ${newAccountCurrency}`">
          <NumField
            v-model="newAccountRate"
            kind="rate"
            placeholder="533"
            @update:model-value="rateTouched = true"
          />
        </Field>
        <p v-if="rateNote" class="-mt-3 text-[12px] leading-relaxed text-ink-3">{{ rateNote }}</p>
        <div v-if="accountInTenge > 0" class="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-ink-2">
          В капитале это <b class="num text-ink">{{ money(accountInTenge) }}</b>
          <p class="mt-1 text-[12px] leading-relaxed text-ink-3">
            Курс запоминается вместе с датой. Прошлые цифры от скачков курса не поедут — чтобы
            обновить, поменяете курс вручную.
          </p>
        </div>
      </div>

      <Field v-if="newAccountKind === 'deposit'" label="Ставка по вкладу, % годовых — если есть">
        <NumField v-model="newAccountDepositRate" kind="rate" placeholder="16,5" class="mb-3" />
      </Field>

      <Button :disabled="!canCreateAccount" class="w-full mt-2" @click="createAccount">
        Добавить счёт
      </Button>
    </Sheet>

    <!-- МОДАЛКА: Детальный просмотр и правка счета -->
    <AccountSheet :account-id="selectedAccountId" @close="selectedAccountId = null" />

    <!-- МОДАЛКА: Добавить долг или рассрочку -->
    <Sheet :open="addDebtOpen" title="Долг или рассрочка" @close="addDebtOpen = false">
      <Field label="Название">
        <Input v-model="debtName" placeholder="Например, рассрочка на телефон" class="mb-3" />
      </Field>
      <Field label="Остаток долга, ₸">
        <NumField v-model="debtPrincipal" placeholder="600 000" class="mb-3" />
      </Field>
      <Field label="Платёж в месяц, ₸">
        <NumField v-model="debtPayment" placeholder="55 000" class="mb-3" />
      </Field>

      <Field label="Проценты" group>
        <Segmented
          v-model="debtMode"
          :options="[
            { value: 'none', label: 'Без них' },
            { value: 'rate', label: 'Знаю ставку' },
            { value: 'term', label: 'Знаю срок' },
          ]"
        />
      </Field>
      <p v-if="debtMode === 'none'" class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-3">
        Рассрочка: платите ровно столько, сколько должны. Приложение посчитает, что долг
        закроется за {{ plainMonths || '—' }} {{ plural(plainMonths, 'платёж', 'платежа', 'платежей') }}.
      </p>

      <Field v-if="debtMode === 'rate'" label="Ставка (ГЭСВ), % годовых">
        <NumField v-model="debtRate" kind="rate" placeholder="23,4" class="mb-3" />
      </Field>
      <Field v-if="debtMode === 'term'" label="Сколько платежей осталось">
        <NumField v-model="debtTerm" kind="int" placeholder="12" class="mb-3" />
      </Field>

      <div
        v-if="debtMode === 'term' && termMonths > 0 && paymentVal > 0 && derivedRate !== null"
        class="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3"
      >
        <span class="text-[12.5px] text-ink-2">Ставка получается</span>
        <div class="font-display text-[20px] font-semibold tracking-[-0.02em] num text-ink">
          {{ ratePct(derivedRate, 1) }} годовых
        </div>
      </div>

      <div v-if="mismatch" class="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3">
        <p class="text-[12.5px] leading-relaxed text-ink-2">
          {{ termMonths }} {{ plural(termMonths, 'платёж', 'платежа', 'платежей') }} по {{ plain(paymentVal) }} — это
          {{ plain(mismatch.paid) }} ₸, а остаток вы указали {{ plain(leftPrincipal) }} ₸.{{
            mismatch.gap > 0
              ? ` Не хватает ${plain(mismatch.gap)} ₸: похоже, платежей ${mismatch.suggest}, а не ${termMonths}.`
              : ' Выходит больше остатка — видимо, в платёж входит что-то ещё.'
          }}
        </p>
        <p class="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          Записать всё равно можно: сохраним как рассрочку без процентов, а ставку
          поправите, когда сверитесь с банком.
        </p>
      </div>

      <Field label="День платежа">
        <NumField v-model="debtDay" kind="int" class="mb-3" />
      </Field>

      <Button :disabled="!canCreateDebt" class="w-full mt-2" @click="createDebt">
        Добавить
      </Button>
    </Sheet>

    <!-- МОДАЛКА: Детальный просмотр кредита -->
    <CreditSheet
      :credit-id="selectedCreditId"
      @close="selectedCreditId = null"
      @payoff="(id) => { payoffCreditId = id; selectedCreditId = null }"
    />

    <!-- МОДАЛКА: Добавить обязательство / подписку -->
    <Sheet :open="addObligationOpen" title="Регулярный платёж" @close="addObligationOpen = false">
      <Field label="Что оплачиваем">
        <Input v-model="obName" placeholder="Например, интернет или абонемент" class="mb-3" />
      </Field>

      <Field label="Как часто" group>
        <Segmented
          v-model="obEvery"
          :options="[
            { value: 'month', label: 'Каждый месяц' },
            { value: 'year', label: 'Раз в год' },
          ]"
          class="mb-3"
        />
      </Field>

      <Field :label="obEvery === 'year' ? 'Сумма за год, ₸' : 'Сумма в месяц, ₸'">
        <NumField v-model="obAmount" placeholder="5 000" class="mb-3" />
      </Field>

      <p v-if="obEvery === 'year' && parseMoney(obAmount) > 0" class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
        В плане месяца это займёт {{ money(yearShare(parseMoney(obAmount))) }} — годовая сумма
        делится на двенадцать, чтобы не завышать одиннадцать месяцев и не удивляться на двенадцатый.
      </p>

      <Field v-if="obEvery === 'year'" label="Месяц списания" group>
        <div class="grid grid-cols-4 gap-1.5">
          <button
            v-for="(m, i) in MONTHS_NOM"
            :key="m"
            type="button"
            :aria-pressed="parseMoney(obMonth) === i + 1"
            :class="cn('rounded-lg border px-1 py-1.5 text-[12px] cursor-pointer', parseMoney(obMonth) === i + 1 ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2')"
            @click="obMonth = String(i + 1)"
          >
            {{ m.slice(0, 3) }}
          </button>
        </div>
      </Field>

      <Field label="День платежа">
        <NumField v-model="obDay" kind="int" class="mb-3" />
      </Field>

      <Field v-if="people.length > 1" label="Чьё это" group>
        <div class="flex gap-1.5 mb-3">
          <button
            type="button"
            :class="cn('rounded-lg border px-3 py-1.5 text-[12.5px] cursor-pointer', obWho === 'all' ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
            @click="obWho = 'all'"
          >
            Общее
          </button>
          <button
            v-for="p in people"
            :key="p.id"
            type="button"
            :class="cn('rounded-lg border px-3 py-1.5 text-[12.5px] cursor-pointer', obWho === p.id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
            @click="obWho = p.id"
          >
            {{ p.name }}
          </button>
        </div>
      </Field>

      <Field label="В какой раздел бюджета" group>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="c in obBuckets"
            :key="c.key"
            type="button"
            :aria-pressed="obCategory === c.key"
            :class="cn('rounded-lg border px-2.5 py-1.5 text-[12.5px] cursor-pointer', obCategory === c.key ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2')"
            @click="obCategory = c.key"
          >
            {{ c.name }}
          </button>
        </div>
      </Field>

      <label class="mb-3 flex items-center gap-2.5 text-[13.5px] text-ink">
        <input v-model="obEstimate" type="checkbox" class="size-4 accent-[var(--brand)]" />
        Сумма плавает — показывать как оценку
      </label>

      <Button :disabled="!canCreateObligation" class="w-full mt-2" @click="createObligation">
        Добавить
      </Button>
    </Sheet>

    <!-- МОДАЛКА: Обязательство (правка и запланированное изменение) -->
    <ObligationSheet :obligation-id="selectedObligationId" @close="selectedObligationId = null" />

    <!-- МОДАЛКА: Новая группа подписок -->
    <Sheet :open="addGroupOpen" title="Группа подписок" @close="addGroupOpen = false">
      <Field label="Название">
        <Input v-model="groupName" placeholder="Рабочие, досуг, для дома…" class="mb-3" />
      </Field>
      <Field label="Спрашивать «оставить?»" group>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="opt in NO_ASK_OPTIONS"
            :key="opt.label"
            type="button"
            :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', groupNoAsk === opt.value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
            @click="groupNoAsk = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </Field>
      <Button :disabled="!groupName.trim()" class="w-full" @click="createGroup">Создать группу</Button>
    </Sheet>

    <!-- МОДАЛКА: Группа подписок — название, флаг, подписки -->
    <Sheet :open="!!activeGroup" :title="activeGroup?.name ?? ''" @close="selectedGroupId = null">
      <template v-if="activeGroup" #default="{ close }">
        <Field label="Название">
          <Input
            :default-value="activeGroup.name"
            class="mb-3"
            @blur="(e: Event) => {
              const v = (e.target as HTMLInputElement).value.trim()
              if (v && v !== activeGroup!.name) financeStore.updateObligation(activeGroup!.id, { name: v })
            }"
          />
        </Field>

        <Field label="Спрашивать «оставить?»" group>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="opt in NO_ASK_OPTIONS"
              :key="opt.label"
              type="button"
              :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', !!activeGroup.noAsk === opt.value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
              @click="!!activeGroup.noAsk !== opt.value && financeStore.updateObligation(activeGroup.id, { noAsk: opt.value })"
            >
              {{ opt.label }}
            </button>
          </div>
        </Field>

        <div class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
          <div class="mb-1 flex justify-between">
            <span class="text-ink-2">Итого</span>
            <b class="num text-ink">{{ money(groupTotal(activeGroup, financeStore.obligations, key)) }} в месяц</b>
          </div>
          <div
            v-for="o in groupChildren(activeGroup, financeStore.obligations)"
            :key="o.id"
            class="flex items-center gap-2 border-t border-line py-1.5"
          >
            <span class="min-w-0 flex-1 truncate text-ink-2">{{ o.name }}</span>
            <span class="num text-ink">{{ plain(amountAt(o, key)) }} {{ o.every === 'year' ? 'в год' : 'в месяц' }}</span>
            <button
              type="button"
              class="text-[12.5px] text-ink-3 hover:underline cursor-pointer"
              @click="financeStore.moveToGroup(o.id, null)"
            >
              Вынуть
            </button>
          </div>
        </div>

        <Field v-if="groupCandidates.length" label="Добавить подписку">
          <Select
            model-value=""
            :options="[{ value: '', label: 'Выберите…' }, ...groupCandidates.map((o) => ({ value: o.id, label: o.name }))]"
            @update:model-value="(v) => v && financeStore.moveToGroup(v, activeGroup!.id)"
          />
        </Field>

        <Button class="w-full mb-3" @click="close">Готово</Button>

        <DangerZone
          label="Удалить группу"
          warning="Группа исчезнет, подписки останутся — просто без группы."
          @confirm="() => { financeStore.removeGroup(activeGroup!.id); selectedGroupId = null }"
        />
      </template>
    </Sheet>

    <!-- МОДАЛКА: Калькулятор досрочного погашения (Payoff) -->
    <PayoffSheet
      :credit-id="payoffCreditId"
      :plan="payoffPlan"
      @close="
        payoffCreditId = null;
        payoffPlan = null;
      "
    />

    <!-- МОДАЛКА: Внеплановый доход -->
    <Sheet :open="extraIncomeOpen" title="Внеплановый доход" @close="extraIncomeOpen = false">
      <p class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-2">
        Премия, подарок, возврат налога — то, чего нет в плане месяца. Направьте сразу,
        пока деньги не разошлись по мелочам.
      </p>

      <Field label="Сумма, ₸">
        <NumField v-model="extraIncomeAmount" placeholder="50 000" class="mb-3" />
      </Field>

      <Field v-if="people.length > 1" label="Кому пришло" group>
        <div class="flex gap-2 mb-3">
          <button
            v-for="p in people"
            :key="p.id"
            type="button"
            :class="cn('rounded-xl border px-3 py-2 text-[13px] flex-1 cursor-pointer', extraIncomeBy === p.id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
            @click="extraIncomeBy = p.id"
          >
            {{ p.name }}
          </button>
        </div>
      </Field>

      <Field label="Куда направить">
        <Select v-model="extraIncomeTarget" class="mb-3">
          <option value="">Выберите…</option>
          <optgroup v-if="goals.length > 0" label="В цель">
            <option v-for="g in goals" :key="g.id" :value="`goal:${g.id}`">
              {{ g.name }}
            </option>
          </optgroup>
          <optgroup v-if="payAccounts.length > 0" label="На счёт">
            <option v-for="a in payAccounts" :key="a.id" :value="`account:${a.id}`">
              {{ a.name }}
            </option>
          </optgroup>
        </Select>
      </Field>

      <p v-if="!goals.length && !payAccounts.length" class="mb-3 text-[12.5px] text-ink-3">
        Сначала заведите цель или счёт — иначе деньги некуда положить.
      </p>

      <Button :disabled="!canApplyExtraIncome" class="w-full mt-1" @click="applyExtraIncome">
        Записать
      </Button>
    </Sheet>
  </div>
</template>
