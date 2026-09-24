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
  PhX,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import {
  addMonths,
  monthFrom,
  monthKey,
  monthTitle,
} from '@/lib/dates'
import {
  amountAt,
  annuityMonths,
  annuityTotal,
  debtCost,
  goalSavings,
  halfOverpayExtra,
  liveAccounts,
  liveCredits,
  liveGoals,
  liveObligations,
  lumpSum,
  monthlyAmount,
  netWorth,
  nextChange,
  prepayment,
  rateFromSchedule,
  simulateStrategy,
  type StrategyResult,
} from '@/lib/finance'
import type { Account, Currency, Obligation, Person, PersonId } from '@/types/finance'
import type { CategoryKey } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { fetchRates, type FxRates } from '@/lib/fx'

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
import Input from '@/components/ui/Input.vue'

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()

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

// Check query params on mount/update
watch(
  () => route.query,
  (q) => {
    if (q.add === 'debt') addDebtOpen.value = true
    if (q.add === 'payment') addObligationOpen.value = true
    if (typeof q.credit === 'string') selectedCreditId.value = q.credit
    if (typeof q.obligation === 'string') selectedObligationId.value = q.obligation
    if (typeof q.payoff === 'string') payoffCreditId.value = q.payoff
  },
  { immediate: true },
)

/* ------------------ Добавление счета ------------------ */
const newAccountKind = ref<Account['kind']>('card')
const newAccountName = ref('')
const newAccountAmount = ref('')
const newAccountCurrency = ref<Currency>('KZT')
const newAccountRate = ref('')
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

watch([rateInfo, newAccountCurrency], ([info, cur]) => {
  const auto = info?.rates?.[cur]
  if (auto && !newAccountRate.value) newAccountRate.value = String(auto)
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
const debtPrincipal = ref('')
const debtPayment = ref('')
const debtMode = ref<'none' | 'rate' | 'term'>('none')
const debtRate = ref('')
const debtTerm = ref('')
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
const plainMonths = computed(() =>
  paymentVal.value > 0 ? Math.ceil(leftPrincipal.value / paymentVal.value) : 0,
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
const obMonth = ref(String(new Date().getMonth() + 1))
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

/* ------------------ Анализ долгов (DebtAdvice) ------------------ */
const adviceView = ref<'order' | 'strategy'>('order')
const rankedDebts = computed(() =>
  credits.value
    .map((c) => ({ credit: c, cost: debtCost(c.principal, c.annualRate, c.payment) }))
    .filter((x) => x.credit.annualRate > 0 && x.credit.principal > 0)
    .sort(
      (a, b) =>
        b.credit.annualRate - a.credit.annualRate ||
        b.cost.monthlyInterest - a.cost.monthlyInterest,
    ),
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

/* ------------------ Симулятор стратегий ------------------ */
const stratMonths = ref<12 | 24 | 36>(36)
const stratCushion = ref(true)

const stratDebts = computed(() =>
  credits.value.map((c) => ({
    principal: c.principal,
    annualRate: c.annualRate,
    payment: c.payment,
  })),
)
const stratSaving = computed(() => goals.value.reduce((a, g) => a + g.monthly, 0))
const stratStart = computed(() => goals.value.reduce((a, g) => a + Math.max(0, g.have), 0))
const stratMandatory = computed(
  () =>
    obligations.value.reduce((a, o) => a + monthlyAmount(o, key.value), 0) +
    credits.value.reduce((a, c) => a + c.payment, 0),
)
const stratBuffer = computed(() =>
  stratCushion.value ? Math.round(stratMandatory.value / 1000) * 1000 : 0,
)

const stratA = computed<StrategyResult>(() =>
  simulateStrategy({
    debts: stratDebts.value,
    saving: stratSaving.value,
    keep: stratSaving.value,
    payDebts: false,
    start: stratStart.value,
    months: stratMonths.value,
  }),
)
const stratB = computed<StrategyResult>(() =>
  simulateStrategy({
    debts: stratDebts.value,
    saving: stratSaving.value,
    keep: 0,
    payDebts: true,
    start: stratStart.value,
    months: stratMonths.value,
    buffer: stratBuffer.value,
    lump: 0,
  }),
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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    accountOpen.value = false
    selectedAccountId.value = null
    addDebtOpen.value = false
    selectedCreditId.value = null
    addObligationOpen.value = false
    selectedObligationId.value = null
    payoffCreditId.value = null
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
        :note="`${c.annualRate > 0 ? 'ГЭСВ ' + ratePct(c.annualRate, 1) : 'рассрочка'} · ${Math.ceil(annuityMonths(c.principal, c.annualRate, c.payment))} платежей`"
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

      <!-- Обязательства -->
      <Row
        v-for="o in obligations.filter((x) => !x.parentId)"
        :key="o.id"
        :title="o.name"
        :note="obligationNote(o, people)"
        :value="money(amountAt(o, key))"
        :sub="nextChange(o, key) ? 'сумма изменится' : 'в месяц'"
        clickable
        @click="selectedObligationId = o.id"
      >
        <template #icon>
          <PhHouse :size="17" />
        </template>
      </Row>

      <div
        v-if="!credits.length && !obligations.length"
        class="px-4 py-6 text-center text-[13px] text-ink-3"
      >
        Обязательств пока нет
      </div>
    </Card>

    <div class="flex flex-col gap-2">
      <Button variant="outline" class="w-full bg-surface-2" @click="addObligationOpen = true">
        <PhPlus :size="16" weight="bold" /> Подписка или услуга
      </Button>
      <Button variant="outline" class="w-full bg-surface-2" @click="addDebtOpen = true">
        <PhPlus :size="16" weight="bold" /> Долг или рассрочка
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
        <div v-else class="flex flex-col gap-3">
          <div class="flex gap-2">
            <div class="flex-1 rounded-xl border border-line bg-surface-2 p-3 text-left">
              <div class="text-[12px] font-medium text-ink-3">Копить как сейчас</div>
              <div class="mt-1 font-display text-[16px] font-semibold num text-ink">
                {{ money(Math.round(stratA.savings)) }}
              </div>
              <div class="text-[11.5px] text-ink-3 mt-1">долг: {{ money(Math.round(stratA.debtLeft)) }}</div>
              <div class="text-[11.5px] text-warn">проценты: {{ money(Math.round(stratA.interestTotal)) }}</div>
            </div>
            <div class="flex-1 rounded-xl border border-brand bg-brand-soft p-3 text-left">
              <div class="text-[12px] font-medium text-brand">Сначала гасить</div>
              <div class="mt-1 font-display text-[16px] font-semibold num text-brand">
                {{ money(Math.round(stratB.savings)) }}
              </div>
              <div class="text-[11.5px] text-ink-3 mt-1">долг: {{ money(Math.round(stratB.debtLeft)) }}</div>
              <div class="text-[11.5px] text-warn">проценты: {{ money(Math.round(stratB.interestTotal)) }}</div>
            </div>
          </div>

          <div
            v-if="stratB.net - stratA.net > 0"
            class="rounded-xl border border-brand/40 bg-brand-soft/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2"
          >
            При стратегии «сначала гасить» чистая выгода составит
            <b class="text-brand">{{ money(Math.round(stratB.net - stratA.net)) }}</b>
            за {{ stratMonths }} мес.
          </div>
        </div>
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
            <NumField v-model="newAccountRate" kind="rate" placeholder="533" />
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
          <div class="grid grid-cols-3 gap-1.5 mb-3">
            <button
              v-for="m in [
                { value: 'none', label: 'Без них' },
                { value: 'rate', label: 'Ставка' },
                { value: 'term', label: 'Срок' },
              ]"
              :key="m.value"
              type="button"
              :class="cn('rounded-xl border px-2 py-2 text-[12.5px] transition-colors cursor-pointer', debtMode === m.value ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2')"
              @click="debtMode = m.value as 'none' | 'rate' | 'term'"
            >
              {{ m.label }}
            </button>
          </div>
          <p v-if="debtMode === 'none' && plainMonths > 0" class="mt-2 text-[12px] text-ink-3">
            Рассрочка закроется примерно за {{ plainMonths }} платежей.
          </p>
        </Field>

        <Field v-if="debtMode === 'rate'" label="Ставка (ГЭСВ), % годовых">
          <NumField v-model="debtRate" kind="rate" placeholder="23,4" class="mb-3" />
        </Field>
        <Field v-if="debtMode === 'term'" label="Срок в месяцах">
          <NumField v-model="debtTerm" kind="int" placeholder="12" class="mb-3" />
        </Field>

        <Field label="День списания">
          <NumField v-model="debtDay" kind="int" class="mb-3" />
        </Field>

        <Button :disabled="!canCreateDebt" class="w-full mt-2" @click="createDebt">
          Добавить долг
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
  </div>
</template>
