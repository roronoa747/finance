<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, moneyIn, plain, parseMoney } from '@/lib/money'
import { CURRENCY_SIGN, FX_ACCOUNT_NAME } from '@/lib/fx'
import { addMonths, atLabel, dayLabel } from '@/lib/dates'
import {
  afterAnchor,
  amountAt,
  creditDueAmount,
  nextCreditDue,
  nextObligationDue,
  paidFor,
  payableAccounts,
  paymentSplit,
  liveAccounts,
  salaryAt,
  salaryOf,
  salaryToAllocate,
  type MonthlyKind,
  type ScheduledKind,
} from '@/lib/finance'
import type { Payment, PersonId } from '@/types/finance'
import Field from '@/components/kit/Field.vue'
import Sheet from '@/components/kit/Sheet.vue'
import NumField from '@/components/kit/NumField.vue'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'

/**
 * Лист отметки (B2C-15, хвост RP «SalaryRow повторяет PaidRow»): один для платежа по графику,
 * зарплаты и строки выписки. `open: 'paid'` — детали отмеченного (когда, сумма, в долг и банку,
 * счёт, следующий платёж, источник «из выписки»), «Другая сумма или счёт», «Снять отметку»;
 * `open: 'mark'` — форма отметки: сумма и счёт (первая оплата, оценка, правка). Запись пишет
 * стор (`markPaid` / `markSalary` / `editPaid` / `unmarkPaid`); ничего не считает сам.
 */
const props = withDefaults(
  defineProps<{
    open: 'mark' | 'paid' | null
    kind: MonthlyKind
    targetId: string
    /** Месяц платежа по графику (у зарплаты — месяц её дня). */
    period: string
    title: string
    /** Форма отметки: начальная сумма и счёт (`undefined` — спросить, `null` — не списывать). */
    amount?: number
    account?: string | null
    /** Счёт спрашивается впервые — подсказка «спрашиваем один раз». */
    firstTime?: boolean
  }>(),
  { amount: 0, account: undefined, firstTime: false },
)

const emit = defineEmits<{
  (e: 'close'): void
  /** Отметка записана (не правка) — родитель может повести дальше (разбор зарплаты). */
  (e: 'marked', record: Payment): void
  /** «Разложить» у пришедшей по выписке и не разложенной зарплаты — родитель ведёт на разбор. */
  (e: 'allocate'): void
}>()

const finance = useFinanceStore()
const auth = useAuthStore()

const salary = computed(() => props.kind === 'salary')
const obligation = computed(() => (props.kind === 'obligation' ? finance.obligations.find((o) => o.id === props.targetId) : undefined))
const credit = computed(() => (props.kind === 'credit' ? finance.credits.find((c) => c.id === props.targetId) : undefined))
const person = computed(() => (salary.value ? finance.people.find((p) => p.id === props.targetId && !p.deletedAt) : undefined))

const record = computed(() => paidFor(finance.payments, props.kind, props.targetId, props.period))
/** Оклад в валюте (B2C-79): сумма отметки — в валюте, счёт — только валютный той же валюты. */
const own = computed(() => (person.value ? salaryOf(person.value, props.period) : null))
const fxSalary = computed(() => !!own.value && own.value.currency !== 'KZT')
const sign = computed(() => (own.value ? CURRENCY_SIGN[own.value.currency] : '₸'))
/** Своя зарплата, отмеченная по выписке, без записи разбора — «Разложить» (возврат приёмки п. 2). */
const canAllocate = computed(
  () => salary.value && !!record.value && !!salaryToAllocate({ ...finance.householdDoc, credits: finance.credits }, auth.slot, undefined, record.value),
)

/** Сколько платить (у зарплаты — оклад) за этот месяц по графику. */
const due = computed(() => {
  if (obligation.value) return amountAt(obligation.value, props.period)
  if (credit.value) return creditDueAmount(credit.value)
  if (person.value) return fxSalary.value ? own.value!.amount : salaryAt(person.value, props.period)
  return 0
})

/** Кредит: сколько из суммы в долг и сколько банку — у отмеченного по записи (Р-8); без ставки «банку 0» врёт (B2C-19). */
const split = computed(() => (credit.value && !credit.value.rateUnknown && record.value ? paymentSplit(record.value, credit.value, due.value) : null))

/** Следующий неоплаченный платёж после этого месяца (зарплате не нужен). */
const next = computed(() => {
  const after = { day: 1, key: addMonths(props.period, 1) }
  if (obligation.value) return nextObligationDue(obligation.value, finance.payments, after)
  if (credit.value) return nextCreditDue(credit.value, finance.payments, after)
  return null
})

const accountName = computed(() => {
  const id = record.value?.accountId
  if (id === null || id === undefined) return salary.value ? 'не зачислено' : 'не списано'
  // Личный счёт партнёра на этом телефоне не виден.
  return finance.accounts.find((a) => a.id === id)?.name ?? 'личный счёт'
})

/** Счета в тенге; валютная зарплата — валютные счета своей валюты (Р-73). */
const choices = computed(() =>
  fxSalary.value ? liveAccounts(finance.accounts).filter((a) => a.currency === own.value!.currency) : payableAccounts(finance.accounts),
)

/** «Евро-счёт» одним нажатием — валютного счёта этой валюты ещё нет. */
function createFxAccount() {
  if (own.value) chosen.value = finance.addFxAccount(own.value.currency)
}

const amountText = ref('')
// undefined — счёт ещё не выбран; null — «не списывать».
const chosen = ref<string | null | undefined>(undefined)
const confirmUnmark = ref(false)

watch(
  () => [props.open, props.amount, props.account] as const,
  ([open]) => {
    confirmUnmark.value = false
    if (open === 'mark') {
      amountText.value = plain(props.amount)
      chosen.value = props.account
    }
  },
  { immediate: true },
)

function editFromRecord() {
  const r = record.value
  if (!r) return
  amountText.value = plain(r.amount)
  chosen.value = r.accountId
  confirmUnmark.value = false
  mode.value = 'mark'
}

// Открытый «paid» может перейти в форму правки внутри листа, не трогая родителя.
const mode = ref<'mark' | 'paid' | null>(props.open)
watch(
  () => props.open,
  (v) => (mode.value = v),
)

function confirmMark() {
  const amount = parseMoney(amountText.value)
  if (chosen.value === undefined || amount <= 0) return
  const r = record.value
  if (r) {
    // Правка отмеченного — новая запись с тем же моментом оплаты (стор, Р-7).
    finance.editPaid(r, { amount, accountId: chosen.value })
    emit('close')
    return
  }
  const written = fxSalary.value
    ? finance.markSalary(props.targetId as PersonId, { period: props.period, foreign: amount, accountId: chosen.value })
    : salary.value
    ? finance.markSalary(props.targetId as PersonId, { period: props.period, amount, accountId: chosen.value })
    : finance.markPaid(props.kind as ScheduledKind, props.targetId, auth.slot ?? 'a', { period: props.period, amount, accountId: chosen.value })
  emit('close')
  if (written) emit('marked', written)
}

function unmark() {
  finance.unmarkPaid(props.kind, props.targetId, props.period)
  emit('close')
}

// Отметка до ручной сверки остатка в нём уже учтена: снятие её не вернёт — не обещаем.
const unmarkNote = computed(() => {
  const r = record.value
  const acc = r?.accountId ? finance.accounts.find((a) => a.id === r.accountId) : undefined
  const back = !!r?.accountId && (!acc || afterAnchor(r, acc.amountSetAt))
  if (salary.value) return `Зарплата снова станет неотмеченной${back ? ', сумма уйдёт со счёта' : ''}.`
  const parts = ['Платёж снова станет неоплаченным']
  if (back) parts.push('деньги вернутся на счёт')
  if (r && credit.value && afterAnchor(r, credit.value.principalSetAt)) parts.push('остаток долга — к прежнему')
  return parts.join(', ') + '.'
})
</script>

<template>
  <Sheet :open="open !== null" :title="title" :z="60" @close="emit('close')">
    <template v-if="mode === 'paid' && record">
      <div class="mb-3 flex flex-col gap-1.5 rounded-inner bg-surface-2 p-3 text-[13px]">
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">{{ salary ? 'Пришла' : 'Оплачено' }}</span>
          <b class="num text-ink">{{ atLabel(record.at) }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Сумма</span>
          <b class="num text-ink">{{ record.foreign && record.currency ? `${moneyIn(record.foreign, record.currency)} · ≈ ${money(record.amount)}` : money(record.amount) }}</b>
        </div>
        <div v-if="split" class="flex justify-between gap-3">
          <span class="text-ink-2">Из них</span>
          <b class="num text-ink">в долг {{ plain(split.body) }} · банку {{ plain(split.interest) }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Счёт</span>
          <b class="truncate text-ink">{{ accountName }}</b>
        </div>
        <div v-if="record.source === 'statement'" class="flex justify-between gap-3">
          <span class="text-ink-2">Источник</span>
          <b class="text-ink">из выписки</b>
        </div>
        <div v-if="next" class="flex justify-between gap-3">
          <span class="text-ink-2">Следующий платёж</span>
          <b class="num text-ink">{{ dayLabel(next.day, next.period) }} · {{ money(next.amount) }}</b>
        </div>
        <div v-if="credit" class="flex justify-between gap-3">
          <span class="text-ink-2">Остаток долга</span>
          <b class="num text-ink">{{ money(credit.principal) }}</b>
        </div>
      </div>

      <div v-if="confirmUnmark" class="rounded-inner bg-surface-2 p-3">
        <p class="mb-2 text-[12.5px] leading-relaxed text-ink-2">{{ unmarkNote }}</p>
        <div class="flex gap-2">
          <Button variant="secondary" class="flex-1" @click="confirmUnmark = false">Отмена</Button>
          <Button class="flex-1" @click="unmark">Снять</Button>
        </div>
      </div>
      <div v-else class="flex flex-col gap-2">
        <Button v-if="canAllocate" class="w-full" @click="emit('close'); emit('allocate')">Разложить</Button>
        <!-- Валютная зарплата правится снятием и новой отметкой: сумма в валюте, тенге — по курсу дня -->
        <Button v-if="!record.foreign" variant="secondary" class="w-full" @click="editFromRecord">Другая сумма или счёт</Button>
        <Button variant="secondary" class="w-full" @click="confirmUnmark = true">Снять отметку</Button>
      </div>
    </template>

    <template v-else-if="mode === 'mark'">
      <Field :label="`Сумма, ${salary ? sign : '₸'}`">
        <NumField v-model="amountText" />
        <span v-if="salary" class="text-[12px] leading-relaxed text-ink-3">
          Оклад месяца — {{ fxSalary ? moneyIn(due, own!.currency) : money(due) }}. С премией впишите всю сумму: премия целиком ляжет в остаток.
        </span>
      </Field>

      <Button v-if="fxSalary && !choices.length" variant="secondary" class="mb-3.5 w-full" @click="createFxAccount">
        {{ FX_ACCOUNT_NAME[own!.currency] }}
      </Button>

      <AccountChoice
        v-model="chosen"
        :accounts="choices"
        :label="salary ? 'На какой счёт' : undefined"
        :none="salary ? 'Не зачислять — только отметить' : undefined"
      >
        <p v-if="firstTime" class="text-[12px] leading-relaxed text-ink-3">
          {{ salary ? 'Спрашиваем один раз: дальше зарплата отметится одним нажатием на тот же счёт.' : 'Спрашиваем один раз: дальше этот платёж отметится одним нажатием с того же счёта.' }}
        </p>
      </AccountChoice>

      <Button class="w-full" :disabled="chosen === undefined || parseMoney(amountText) <= 0" @click="confirmMark">
        {{ record ? 'Сохранить' : salary ? 'Отметить зарплату' : 'Отметить оплату' }}
      </Button>
    </template>
  </Sheet>
</template>
