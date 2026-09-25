<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  PhBank,
  PhCreditCard,
  PhCoins,
  PhWallet,
  PhHouse,
  PhPlus,
  PhCalendarPlus,
  PhFolderSimple,
  PhX,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import {
  MONTHS_NOM,
  addMonths,
  atLabel,
  dayLabel,
  monthFrom,
  monthKey,
  monthTitle,
  parseMonthKey,
} from '@/lib/dates'
import {
  afterAnchor,
  amountAt,
  annuityMonths,
  annuityTotal,
  costliestCredits,
  debtCost,
  goalSavings,
  groupChildren,
  groupTotal,
  halfOverpayExtra,
  installmentMonths,
  isSubscription,
  lastAccountFor,
  liveAccounts,
  liveCredits,
  liveGoals,
  liveGroups,
  liveObligations,
  payableAccounts,
  lumpPlan,
  lumpSum,
  netWorth,
  nextChange,
  nextCreditDue,
  nextObligationDue,
  openCredits,
  prepaySaved,
  prepayment,
  rateFromSchedule,
  scheduleMismatch,
  type Due,
  type LumpMode,
} from '@/lib/finance'
import type { Account, Credit, Currency, Obligation, Payment, Person, PersonId } from '@/types/finance'
import type { CategoryKey } from '@/lib/palette'
import { cn, plural } from '@/lib/utils'
import { fetchRates, formRate, type FxRates } from '@/lib/fx'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Tag from '@/components/kit/Tag.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Button from '@/components/ui/Button.vue'
import PaidRow from '@/components/PaidRow.vue'
import StrategyCompare from '@/components/StrategyCompare.vue'
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

/** «24 платежа» в строке кредита: сколько осталось при нынешнем платеже. */
function paymentsLeft(c: Credit): string {
  const n = Math.ceil(annuityMonths(c.principal, c.annualRate, c.payment))
  return `${n} ${plural(n, 'платёж', 'платежа', 'платежей')}`
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

// Check query params on mount/update
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
  if (route.query.income) {
    const q = { ...route.query }
    delete q.income
    void router.replace({ query: q })
  }
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
    ? Math.round(parsedAccountAmount.value * (Number.isFinite(rateValue.value) ? rateValue.value : 0))
    : parsedAccountAmount.value,
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
const adviceView = ref<'order' | 'strategy'>(props.initialAdvice)
const rankedDebts = computed(() =>
  costliestCredits(credits.value).map((c) => ({
    credit: c,
    cost: debtCost(c.principal, c.annualRate, c.payment),
  })),
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
    ? prepayment(
        worstDebt.value.credit.principal,
        worstDebt.value.credit.annualRate,
        worstDebt.value.credit.payment,
        worstHalfExtra.value,
      )
    : null,
)

/* ------------------ Модалка детального счета ------------------ */
const activeAccount = computed(() =>
  allAccounts.value.find((a) => a.id === selectedAccountId.value),
)
const activeAccountSaved = ref(false)

function onAccountNameBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (activeAccount.value && v && v !== activeAccount.value.name) {
    financeStore.updateAccount(activeAccount.value.id, { name: v })
    activeAccountSaved.value = true
  }
}

function onAccountNoteBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (activeAccount.value && v !== activeAccount.value.note) {
    financeStore.updateAccount(activeAccount.value.id, { note: v })
    activeAccountSaved.value = true
  }
}

/* ------------------ Модалка кредита ------------------ */
const activeCredit = computed(() =>
  credits.value.find((c) => c.id === selectedCreditId.value),
)

/* ------------------ Модалка обязательства ------------------ */
const activeObligation = computed(() =>
  obligations.value.find((o) => o.id === selectedObligationId.value),
)

// Платёж, который модалка предлагает отметить, берётся при открытии: после
// «Оплатил» строка остаётся на этом месяце и показывает следующий платёж, а не
// перескакивает на следующий месяц с новой кнопкой.
const creditDue = ref<Due | null>(null)
watch(
  () => activeCredit.value?.id,
  () => {
    creditDue.value = activeCredit.value ? nextCreditDue(activeCredit.value, financeStore.payments) : null
  },
  { immediate: true },
)
const obligationDue = ref<Due | null>(null)
watch(
  () => activeObligation.value?.id,
  () => {
    obligationDue.value = activeObligation.value
      ? nextObligationDue(activeObligation.value, financeStore.payments)
      : null
  },
  { immediate: true },
)
const obEditAmount = ref('')
const obPlanning = ref(false)
const obNewAmount = ref('')
const obFromMonth = ref(addMonths(key.value, 1))
const obReason = ref('')

watch(activeObligation, (ob) => {
  if (ob) {
    obEditAmount.value = plain(amountAt(ob, key.value))
    obPlanning.value = false
    obNewAmount.value = ''
    obReason.value = ''
    obFromMonth.value = addMonths(key.value, 1)
  }
})

const plannedObligationMonths = computed(() =>
  Array.from({ length: 13 }, (_, i) => addMonths(key.value, i)),
)
const plannedDelta = computed(() => {
  const p = parseMoney(obNewAmount.value)
  const cur = activeObligation.value ? amountAt(activeObligation.value, key.value) : 0
  return p > 0 ? p - cur : 0
})

/* ------------------ Калькулятор досрочки (Payoff) ------------------ */
const activePayoffCredit = computed(() =>
  credits.value.find((c) => c.id === payoffCreditId.value),
)
const payoffMode = ref<'monthly' | 'once'>('monthly')
const payoffAmount = ref('')

const payoffCost = computed(() =>
  activePayoffCredit.value
    ? debtCost(
        activePayoffCredit.value.principal,
        activePayoffCredit.value.annualRate,
        activePayoffCredit.value.payment,
      )
    : null,
)
const payoffHalf = computed(() =>
  activePayoffCredit.value
    ? halfOverpayExtra(
        activePayoffCredit.value.principal,
        activePayoffCredit.value.annualRate,
        activePayoffCredit.value.payment,
      )
    : null,
)
const payoffChips = computed(() => {
  if (!activePayoffCredit.value) return []
  const pay = activePayoffCredit.value.payment
  return Array.from(
    new Set(
      [
        Math.round(pay / 2 / 1000) * 1000,
        Math.round(pay / 1000) * 1000,
        ...(payoffHalf.value ? [payoffHalf.value] : []),
      ].filter((v) => v > 0),
    ),
  ).sort((a, b) => a - b)
})
const payoffResult = computed(() => {
  if (!activePayoffCredit.value) return null
  const v = parseMoney(payoffAmount.value)
  if (v <= 0) return null
  const p = activePayoffCredit.value.principal
  const r = activePayoffCredit.value.annualRate
  const pay = activePayoffCredit.value.payment
  return payoffMode.value === 'monthly' ? prepayment(p, r, pay, v) : lumpSum(p, r, pay, v)
})

const payoffLadder = computed(() => {
  if (!activePayoffCredit.value || !payoffCost.value?.closes) return []
  const p = activePayoffCredit.value.principal
  const r = activePayoffCredit.value.annualRate
  const pay = activePayoffCredit.value.payment
  return [0.5, 1, 2, 4]
    .map((k) => {
      const extra = Math.round((pay * k) / 1000) * 1000
      return { extra, ...prepayment(p, r, pay, extra) }
    })
    .filter((res) => res.extra > 0 && Number.isFinite(res.monthsAfter))
})

/* ------------------ Применить досрочку (RP-08) ------------------ */
const applyMode = ref<LumpMode>('term')
// '' — счёт не выбран, 'none' — «не списывать», иначе id счёта.
const applyAccount = ref('')
const applyDone = ref<Payment | null>(null)
const removingPrepay = ref<string | null>(null)

const applyAccounts = computed(() => payableAccounts(allAccounts.value))
const applyPlan = computed(() => {
  const c = activePayoffCredit.value
  const v = parseMoney(payoffAmount.value)
  return c && v > 0 ? lumpPlan(c.principal, c.annualRate, c.payment, v, applyMode.value) : null
})
const creditPrepays = computed(() =>
  financeStore.payments
    .filter((p) => p.kind === 'prepay' && !p.deletedAt && p.targetId === payoffCreditId.value)
    .sort((a, b) => b.at.localeCompare(a.at)),
)

// Счёт по умолчанию — прошлой оплаты этого кредита (Р-5).
watch(
  payoffCreditId,
  (id) => {
    applyDone.value = null
    removingPrepay.value = null
    const last = id ? lastAccountFor(financeStore.payments, id, financeStore.accounts) : undefined
    applyAccount.value = last === undefined ? '' : (last ?? 'none')
  },
  { immediate: true },
)

// Снятие обещает только то, что сделает стор (как `unmarkNote` у отметок): остаток
// и счёт возвращаются, если досрочка после их ручной сверки, платёж — если его с
// тех пор не меняли.
function prepayUndoNote(p: Payment): string {
  const c = activePayoffCredit.value
  const acc = p.accountId ? financeStore.accounts.find((a) => a.id === p.accountId) : undefined
  const parts = ['Досрочка уйдёт из списка и счётчика']
  if (c && afterAnchor(p, c.principalSetAt)) parts.push('остаток долга — к прежнему')
  if (p.accountId && (!acc || afterAnchor(p, acc.amountSetAt))) parts.push('деньги вернутся на счёт')
  if (p.prevPayment !== undefined && c?.payment === p.newPayment) parts.push('платёж — к прежнему')
  return parts.join(', ') + '.'
}

function applyPrepay() {
  const c = activePayoffCredit.value
  if (!c || !applyPlan.value || !applyAccount.value) return
  applyDone.value = financeStore.applyPrepayment(c.id, authStore.slot ?? 'a', {
    amount: parseMoney(payoffAmount.value),
    mode: applyMode.value,
    accountId: applyAccount.value === 'none' ? null : applyAccount.value,
  })
  payoffAmount.value = ''
}


function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    accountOpen.value = false
    selectedAccountId.value = null
    addDebtOpen.value = false
    selectedCreditId.value = null
    addObligationOpen.value = false
    selectedObligationId.value = null
    payoffCreditId.value = null
    extraIncomeOpen.value = false
    addGroupOpen.value = false
    selectedGroupId.value = null
  }
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onKeydown)
  }
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
        :note="`${c.annualRate > 0 ? 'ГЭСВ ' + ratePct(c.annualRate, 1) : 'рассрочка'} · ${paymentsLeft(c)}`"
        :value="money(c.principal)"
        :sub="
          annuityTotal(c.principal, c.annualRate, c.payment) - c.principal > 0
            ? `переплата ${plain(Math.round(annuityTotal(c.principal, c.annualRate, c.payment) - c.principal))}`
            : undefined
        "
        clickable
        @click="selectedCreditId = c.id"
      >
        <template #icon>
          <PhCreditCard :size="17" />
        </template>
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
              <b class="num text-warn">{{ money(Math.round(worstDebt.cost.monthlyInterest)) }}</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">Доля платежа в проценты</span>
              <b class="num text-ink">{{ Math.round(worstDebt.cost.interestShare * 100) }}%</b>
            </div>
            <div class="flex justify-between">
              <span class="text-ink-2">
                {{ worstDebt.cost.closes ? 'Переплата до конца' : 'Долг не закрывается' }}
              </span>
              <b class="num text-warn">
                {{
                  worstDebt.cost.closes
                    ? money(Math.round(worstDebt.cost.overpay))
                    : 'платёж меньше процентов'
                }}
              </b>
            </div>
          </div>

          <p class="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            {{
              Math.round(worstDebt.cost.interestShare * 100) >= 50
                ? 'Больше половины платежа уходит в проценты, поэтому остаток почти не двигается. Такой долг выгоднее закрыть раньше остальных, даже если он самый маленький.'
                : 'Здесь самая высокая ставка из ваших долгов, поэтому каждый лишний тенге, внесённый сюда, экономит больше, чем в любом другом.'
            }}
          </p>

          <div
            v-if="worstGain && worstHalfExtra && Number.isFinite(worstGain.monthsSaved)"
            class="mt-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3"
          >
            <div class="text-[12.5px] text-ink-2">Половину переплаты снимает добавка в</div>
            <div class="mt-1 font-display text-[19px] font-semibold tracking-[-0.02em] num text-brand">
              {{ money(worstHalfExtra) }} в месяц
            </div>
            <div class="mt-0.5 text-[13px] text-ink-2 num">
              это минус {{ Math.round(worstGain.monthsSaved) }} мес. и экономия {{ money(Math.round(worstGain.saved)) }}
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
        />
      </Card>
    </template>

    <!-- МОДАЛКА: Добавить счет -->
    <div
      v-if="accountOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="accountOpen = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Счёт или накопления</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="accountOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Приватность счёта">
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

        <Field label="Что это">
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

        <Field label="Валюта">
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
          <div v-if="accountInTenge > 0" class="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px]">
            В капитале это: <b class="num text-ink">{{ money(accountInTenge) }}</b>
          </div>
        </div>

        <Field v-if="newAccountKind === 'deposit'" label="Ставка по вкладу, % годовых">
          <NumField v-model="newAccountDepositRate" kind="rate" placeholder="16,5" class="mb-3" />
        </Field>

        <Button :disabled="!canCreateAccount" class="w-full mt-2" @click="createAccount">
          Добавить счёт
        </Button>
      </div>
    </div>

    <!-- МОДАЛКА: Детальный просмотр и правка счета -->
    <div
      v-if="activeAccount"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="selectedAccountId = null"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
            {{ activeAccount.name }}
            <SavedMark :on="activeAccountSaved" />
          </h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="selectedAccountId = null"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Название">
          <Input :default-value="activeAccount.name" class="mb-3" @blur="onAccountNameBlur" />
        </Field>

        <Field label="Сумма на счёте, ₸">
          <NumFieldBlur
            :initial="plain(activeAccount.amount)"
            class="mb-3"
            @commit="(text) => { financeStore.setAccountAmount(activeAccount!.id, parseMoney(text)); activeAccountSaved = true }"
          />
        </Field>

        <Field label="Примечание">
          <Input :default-value="activeAccount.note" class="mb-3" @blur="onAccountNoteBlur" />
        </Field>

        <Button class="w-full mb-3" @click="selectedAccountId = null">
          Готово
        </Button>

        <DangerZone
          label="Удалить счёт"
          warning="Счёт будет удален. Это действие нельзя отменить."
          @confirm="() => { financeStore.removeAccount(activeAccount!.id); selectedAccountId = null }"
        />
      </div>
    </div>

    <!-- МОДАЛКА: Добавить долг или рассрочку -->
    <div
      v-if="addDebtOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="addDebtOpen = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Долг или рассрочка</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="addDebtOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Название">
          <Input v-model="debtName" placeholder="Например, рассрочка на телефон" class="mb-3" />
        </Field>
        <Field label="Остаток долга, ₸">
          <NumField v-model="debtPrincipal" placeholder="600 000" class="mb-3" />
        </Field>
        <Field label="Платёж в месяц, ₸">
          <NumField v-model="debtPayment" placeholder="55 000" class="mb-3" />
        </Field>

        <Field label="Проценты">
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
      </div>
    </div>

    <!-- МОДАЛКА: Детальный просмотр кредита -->
    <div
      v-if="activeCredit"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="selectedCreditId = null"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">{{ activeCredit.name }}</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="selectedCreditId = null"
          >
            <PhX :size="16" />
          </button>
        </div>

        <div class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1.5">
          <div class="flex justify-between">
            <span class="text-ink-2">Остаток долга</span>
            <b class="num text-ink">{{ money(activeCredit.principal) }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Ежемесячный платёж</span>
            <b class="num text-ink">{{ money(activeCredit.payment) }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Ставка</span>
            <b class="num text-ink">{{ activeCredit.annualRate > 0 ? ratePct(activeCredit.annualRate, 1) : '0%' }}</b>
          </div>
        </div>

        <div v-if="creditDue" class="mb-3 rounded-xl border border-line px-3">
          <PaidRow
            dense
            more
            kind="credit"
            :target-id="activeCredit.id"
            :period="creditDue.period"
            :title="`Платёж ${dayLabel(creditDue.day, creditDue.period)}`"
            note="по графику"
          />
        </div>

        <Button
          class="w-full mb-3"
          @click="
            payoffCreditId = activeCredit.id;
            selectedCreditId = null;
          "
        >
          Симулятор досрочного погашения
        </Button>

        <DangerZone
          label="Удалить долг"
          warning="Долг исчезнет из бюджета и графика выплат."
          @confirm="() => { financeStore.removeCredit(activeCredit!.id); selectedCreditId = null }"
        />
      </div>
    </div>

    <!-- МОДАЛКА: Добавить обязательство / подписку -->
    <div
      v-if="addObligationOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="addObligationOpen = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Регулярный платёж</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="addObligationOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Что оплачиваем">
          <Input v-model="obName" placeholder="Интернет, абонемент, страховка…" class="mb-3" />
        </Field>

        <Field label="Как часто">
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

        <Field v-if="obEvery === 'year'" label="Месяц списания">
          <select
            v-model="obMonth"
            class="mb-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink"
          >
            <option v-for="(m, i) in MONTHS_NOM" :key="m" :value="String(i + 1)">{{ m }}</option>
          </select>
        </Field>

        <Field label="День платежа">
          <NumField v-model="obDay" kind="int" class="mb-3" />
        </Field>

        <Field v-if="people.length > 1" label="Чьё это">
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

        <Button :disabled="!canCreateObligation" class="w-full mt-2" @click="createObligation">
          Добавить платёж
        </Button>
      </div>
    </div>

    <!-- МОДАЛКА: Обязательство (правка и запланированное изменение) -->
    <div
      v-if="activeObligation"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="selectedObligationId = null"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">{{ activeObligation.name }}</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="selectedObligationId = null"
          >
            <PhX :size="16" />
          </button>
        </div>

        <div v-if="obligationDue" class="mb-3 rounded-xl border border-line px-3">
          <PaidRow
            dense
            more
            kind="obligation"
            :target-id="activeObligation.id"
            :period="obligationDue.period"
            :title="`Платёж ${dayLabel(obligationDue.day, obligationDue.period)}`"
            :note="activeObligation.every === 'year' ? 'раз в год' : 'по графику'"
          />
        </div>

        <div v-if="isSubscription(activeObligation) && groups.length" class="mb-3.5 flex flex-col gap-1.5">
          <span class="text-[12.5px] font-medium text-ink-3">Группа</span>
          <select
            :value="activeObligation.parentId ?? ''"
            class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink"
            @change="(e) => financeStore.moveToGroup(activeObligation!.id, (e.target as HTMLSelectElement).value || null)"
          >
            <option value="">Без группы</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
        </div>

        <Field label="Сумма сейчас, ₸">
          <NumField
            v-model="obEditAmount"
            class="mb-1"
            @blur="() => {
              const v = parseMoney(obEditAmount)
              if (v > 0) financeStore.correctObligation(activeObligation!.id, v)
            }"
          />
        </Field>
        <p class="mb-3 text-[12px] leading-relaxed text-ink-3">
          Это исправление: сумма была введена неверно. Если платёж меняется с какого-то месяца —
          запланируйте изменение ниже.
        </p>

        <div v-if="!obPlanning" class="mb-3">
          <Button variant="outline" class="w-full bg-surface-2" @click="obPlanning = true">
            <PhCalendarPlus :size="16" /> Запланировать изменение
          </Button>
        </div>
        <div v-else class="mb-3 rounded-xl border border-brand p-3.5 flex flex-col gap-2.5">
          <Field label="Новая сумма, ₸">
            <NumField v-model="obNewAmount" placeholder="Новая сумма" />
          </Field>
          <Field label="С какого месяца">
            <select
              v-model="obFromMonth"
              class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink"
            >
              <option v-for="m in plannedObligationMonths" :key="m" :value="m">
                {{ monthTitle(m) }}
              </option>
            </select>
          </Field>
          <Field label="Причина">
            <Input v-model="obReason" placeholder="Переезд, индексация…" />
          </Field>

          <div
            v-if="parseMoney(obNewAmount) > 0 && plannedDelta !== 0"
            :class="cn('rounded-xl px-3 py-2 text-[12.5px]', plannedDelta < 0 ? 'bg-brand-soft text-brand' : 'bg-warn-soft text-ink-2')"
          >
            <span v-if="plannedDelta < 0">
              С {{ monthFrom(obFromMonth) }} освободится <b>{{ money(-plannedDelta) }}</b> в месяц!
            </span>
            <span v-else>
              С {{ monthFrom(obFromMonth) }} платёж вырастет на <b>{{ money(plannedDelta) }}</b> в месяц.
            </span>
          </div>

          <div class="flex gap-2 mt-1">
            <Button variant="outline" class="flex-1" @click="obPlanning = false">Отмена</Button>
            <Button
              class="flex-1"
              :disabled="parseMoney(obNewAmount) <= 0"
              @click="() => {
                financeStore.amendObligation(activeObligation!.id, obFromMonth, parseMoney(obNewAmount), obReason.trim() || undefined)
                obPlanning = false
              }"
            >
              Запланировать
            </Button>
          </div>
        </div>

        <Button class="w-full mb-3" @click="selectedObligationId = null">Готово</Button>

        <DangerZone
          label="Удалить обязательство"
          warning="Обязательство исчезнет из бюджета и планов."
          @confirm="() => { financeStore.removeObligation(activeObligation!.id); selectedObligationId = null }"
        />
      </div>
    </div>

    <!-- МОДАЛКА: Новая группа подписок -->
    <div
      v-if="addGroupOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="addGroupOpen = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Группа подписок</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="addGroupOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>
        <Field label="Название">
          <Input v-model="groupName" placeholder="Рабочие, досуг, для дома…" class="mb-3" />
        </Field>
        <div class="mb-3.5 flex flex-col gap-1.5">
          <span class="text-[12.5px] font-medium text-ink-3">Спрашивать «оставить?»</span>
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
        </div>
        <Button :disabled="!groupName.trim()" class="w-full" @click="createGroup">Создать группу</Button>
      </div>
    </div>

    <!-- МОДАЛКА: Группа подписок — название, флаг, подписки -->
    <div
      v-if="activeGroup"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="selectedGroupId = null"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">{{ activeGroup.name }}</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="selectedGroupId = null"
          >
            <PhX :size="16" />
          </button>
        </div>

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

        <div class="mb-3.5 flex flex-col gap-1.5">
          <span class="text-[12.5px] font-medium text-ink-3">Спрашивать «оставить?»</span>
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
        </div>

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

        <div v-if="groupCandidates.length" class="mb-3.5 flex flex-col gap-1.5">
          <span class="text-[12.5px] font-medium text-ink-3">Добавить подписку</span>
          <select
            value=""
            class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink"
            @change="(e) => { const el = e.target as HTMLSelectElement; if (el.value) financeStore.moveToGroup(el.value, activeGroup!.id); el.value = '' }"
          >
            <option value="">Выберите…</option>
            <option v-for="o in groupCandidates" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>

        <Button class="w-full mb-3" @click="selectedGroupId = null">Готово</Button>

        <DangerZone
          label="Удалить группу"
          warning="Группа исчезнет, подписки останутся — просто без группы."
          @confirm="() => { financeStore.removeGroup(activeGroup!.id); selectedGroupId = null }"
        />
      </div>
    </div>

    <!-- МОДАЛКА: Калькулятор досрочного погашения (Payoff) -->
    <div
      v-if="activePayoffCredit"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="payoffCreditId = null"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Досрочное погашение</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="payoffCreditId = null"
          >
            <PhX :size="16" />
          </button>
        </div>

        <div class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1">
          <div class="font-medium text-ink">{{ activePayoffCredit.name }}</div>
          <div class="flex justify-between">
            <span class="text-ink-2">Осталось платежей</span>
            <b class="num text-ink">{{ payoffCost?.closes ? Math.ceil(payoffCost.months) : '—' }}</b>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-2">Переплата без досрочки</span>
            <b class="num text-warn">
              {{ payoffCost?.closes ? money(Math.round(payoffCost.overpay)) : '—' }}
            </b>
          </div>
        </div>

        <Field label="Как вносите">
          <Segmented
            v-model="payoffMode"
            :options="[
              { value: 'monthly', label: 'Каждый месяц' },
              { value: 'once', label: 'Разово' },
            ]"
            class="mb-3"
          />
        </Field>

        <Field :label="payoffMode === 'monthly' ? 'Сколько добавите к платежу, ₸' : 'Сколько внесёте разом, ₸'">
          <NumField v-model="payoffAmount" placeholder="5 000" class="mb-2" />
        </Field>

        <div v-if="payoffChips.length > 0 && payoffMode === 'monthly'" class="mb-3 flex flex-wrap gap-1.5">
          <button
            v-for="v in payoffChips"
            :key="v"
            type="button"
            :class="cn('rounded-lg border px-2.5 py-1 text-[12px] num transition-colors cursor-pointer', parseMoney(payoffAmount) === v ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
            @click="payoffAmount = plain(v)"
          >
            +{{ plain(v) }}
            <span v-if="v === payoffHalf" class="ml-1 text-[10.5px]">½ переплаты</span>
          </button>
        </div>

        <div v-if="payoffResult && Number.isFinite(payoffResult.monthsAfter)" class="mb-3 rounded-xl border border-brand bg-brand-soft p-3.5">
          <div class="font-display text-[18px] font-semibold text-brand">
            {{
              payoffResult.monthsSaved >= 1
                ? `Закроется на ${Math.round(payoffResult.monthsSaved)} мес. раньше`
                : 'Срок почти не изменится'
            }}
          </div>
          <div class="mt-0.5 text-[13px] font-medium text-ink num">
            Экономия: {{ money(Math.max(0, Math.round(payoffResult.saved))) }}
          </div>
          <div class="mt-1 text-[12px] text-ink-2">
            Останется платежей: {{ Math.max(0, Math.ceil(payoffResult.monthsAfter)) }} вместо {{ Math.ceil(payoffResult.monthsNow) }}.
          </div>
        </div>

        <!-- Применить разовую досрочку (Р-6) -->
        <div
          v-if="payoffMode === 'once' && applyPlan && !authStore.isViewer"
          class="mb-3 rounded-xl border border-line p-3.5"
        >
          <div class="mb-2 text-[13px] font-medium text-ink">Применить к кредиту</div>
          <Segmented
            v-model="applyMode"
            :options="[
              { value: 'term', label: 'Сократить срок' },
              { value: 'payment', label: 'Снизить платёж' },
            ]"
            class="mb-3"
          />
          <div class="mb-3 flex flex-col gap-1.5 text-[13px]">
            <div class="flex justify-between">
              <span class="text-ink-2">Остаток долга</span>
              <b class="num text-ink">{{ money(applyPlan.left) }}</b>
            </div>
            <div v-if="applyPlan.left === 0" class="text-ink-2">Долг закроется этим взносом.</div>
            <div v-else-if="applyMode === 'term'" class="flex justify-between">
              <span class="text-ink-2">Платежей останется</span>
              <b class="num text-ink">{{ applyPlan.months }} вместо {{ applyPlan.monthsBefore }}</b>
            </div>
            <div v-else class="flex justify-between">
              <span class="text-ink-2">Платёж</span>
              <b class="num text-ink">{{ money(applyPlan.payment) }} вместо {{ money(activePayoffCredit.payment) }}</b>
            </div>
          </div>
          <div class="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-[13px] text-ink-2">
            Не отдадим банку <b class="num text-brand">{{ money(applyPlan.saved) }}</b>
          </div>
          <Field label="Откуда списать">
            <select
              v-model="applyAccount"
              class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink"
            >
              <option value="" disabled>Выберите счёт…</option>
              <option v-for="a in applyAccounts" :key="a.id" :value="a.id">
                {{ a.name }} · {{ money(a.amount) }}
              </option>
              <option value="none">Не списывать — только отметить</option>
            </select>
          </Field>
          <Button class="w-full" :disabled="!applyAccount" @click="applyPrepay">Применить досрочку</Button>
        </div>

        <div
          v-if="applyDone"
          class="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3 text-[13px] text-ink-2"
        >
          Досрочка применена: не отдадим банку
          <b class="num text-brand">{{ money(applyDone.saved ?? 0) }}</b>.
        </div>

        <div v-if="creditPrepays.length > 0" class="mb-3">
          <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
            Применённые досрочки
          </div>
          <div
            v-for="p in creditPrepays"
            :key="p.id"
            class="border-b border-line py-2 text-[12.5px] last:border-b-0"
          >
            <div class="flex items-baseline gap-2">
              <span class="text-ink-2">
                {{ atLabel(p.at) }} · {{ p.mode === 'payment' ? 'снизили платёж' : 'сократили срок' }}
              </span>
              <b class="ml-auto num text-ink">{{ money(p.amount) }}</b>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-brand">не отдадим банку <span class="num">{{ money(p.saved ?? 0) }}</span></span>
              <button
                v-if="!authStore.isViewer && removingPrepay !== p.id"
                type="button"
                class="ml-auto text-ink-3 hover:underline cursor-pointer"
                @click="removingPrepay = p.id"
              >
                Снять
              </button>
            </div>
            <div v-if="removingPrepay === p.id" class="mt-2 rounded-xl border border-line bg-surface-2 p-3">
              <p class="mb-2 leading-relaxed text-ink-2">{{ prepayUndoNote(p) }}</p>
              <div class="flex gap-2">
                <Button variant="outline" class="flex-1 bg-surface" @click="removingPrepay = null">Отмена</Button>
                <Button
                  class="flex-1"
                  @click="() => { financeStore.removePrepayment(p.id); removingPrepay = null; applyDone = null }"
                >
                  Снять
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- Лесенка отдачи -->
        <div v-if="payoffLadder.length > 0" class="mb-3">
          <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
            Отдача падает с ростом суммы
          </div>
          <div class="flex flex-col gap-1 text-[12.5px]">
            <div
              v-for="item in payoffLadder"
              :key="item.extra"
              class="flex items-center justify-between border-b border-line/60 py-1"
            >
              <span class="num text-ink-2">+{{ plain(item.extra) }} ₸</span>
              <span class="num text-ink-3">−{{ Math.round(item.monthsSaved) }} мес.</span>
              <span class="num font-medium text-brand">{{ money(Math.max(0, Math.round(item.saved))) }}</span>
            </div>
          </div>
        </div>

        <Button class="w-full" @click="payoffCreditId = null">Закрыть</Button>
      </div>
    </div>

    <!-- МОДАЛКА: Внеплановый доход -->
    <div
      v-if="extraIncomeOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="extraIncomeOpen = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Внеплановый доход</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="extraIncomeOpen = false"
          >
            <PhX :size="16" />
          </button>
        </div>
        <p class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-2">
          Премия, подарок, возврат налога — то, чего нет в плане месяца. Направьте сразу,
          пока деньги не разошлись по мелочам.
        </p>

        <Field label="Сумма, ₸">
          <NumField v-model="extraIncomeAmount" placeholder="50 000" class="mb-3" />
        </Field>

        <Field v-if="people.length > 1" label="Кому пришло">
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
          <select
            v-model="extraIncomeTarget"
            class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-ink mb-3"
          >
            <option value="">Выберите…</option>
            <optgroup v-if="goals.length > 0" label="В цель">
              <option v-for="g in goals" :key="g.id" :value="`goal:${g.id}`">
                {{ g.name }}
              </option>
            </optgroup>
            <optgroup v-if="accounts.length > 0" label="На счёт">
              <option v-for="a in accounts" :key="a.id" :value="`account:${a.id}`">
                {{ a.name }}
              </option>
            </optgroup>
          </select>
        </Field>

        <p v-if="!goals.length && !accounts.length" class="mb-3 text-[12.5px] text-ink-3">
          Сначала заведите цель или счёт — иначе деньги некуда положить.
        </p>

        <Button :disabled="!canApplyExtraIncome" class="w-full mt-1" @click="applyExtraIncome">
          Записать
        </Button>
      </div>
    </div>
  </div>
</template>
