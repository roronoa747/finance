<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCheck } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain } from '@/lib/money'
import { addMonths, dayLabel } from '@/lib/dates'
import {
  amountAt,
  creditDueAmount,
  lastAccountFor,
  nextCreditDue,
  nextObligationDue,
  paidFor,
  paymentSplit,
  type ScheduledKind,
} from '@/lib/finance'
import { cn } from '@/lib/utils'
import Row from '@/components/kit/Row.vue'
import MarkSheet from '@/components/MarkSheet.vue'

/**
 * «Оплатил» — одна строка для всего, что платится по графику (Р-3): обязательства
 * и кредита, везде, где платёж виден. Одно нажатие отмечает месяц суммой по графику
 * со счёта прошлой оплаты (Р-5). Другая сумма, другой счёт и «не списывать» — в
 * листе (`MarkSheet`, B2C-15), который открывается только для исключений: первая оплата
 * (счёт спросить один раз), сумма-оценка, правка отмеченного. Неотмеченный платёж
 * нейтрален в любой день — без красного и «просрочено».
 */
const props = defineProps<{
  kind: ScheduledKind
  targetId: string
  /** Месяц платежа по графику. */
  period: string
  title: string
  /** Подпись неоплаченного: дата, частота. */
  note?: string
  accent?: string
  /** Строка ведёт дальше: нажатие мимо кнопки — событие open. */
  clickable?: boolean
  /** Под строкой — «Другая сумма или счёт» (модалки Капитала). */
  more?: boolean
  /** Без боковых отступов — строка внутри карточки. */
  dense?: boolean
  /** Расход в списке Бюджета — «−N», как соседние строки. */
  minus?: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
}>()

const finance = useFinanceStore()
const auth = useAuthStore()

const obligation = computed(() =>
  props.kind === 'obligation' ? finance.obligations.find((o) => o.id === props.targetId) : undefined,
)
const credit = computed(() =>
  props.kind === 'credit' ? finance.credits.find((c) => c.id === props.targetId) : undefined,
)

const record = computed(() => paidFor(finance.payments, props.kind, props.targetId, props.period))

/** Сумма плавает (коммуналка): нажатие сразу спрашивает сумму — на любом экране. */
const estimate = computed(() => !!obligation.value?.estimate)

/** Сколько платить за этот месяц по графику. */
const due = computed(() => {
  if (obligation.value) return amountAt(obligation.value, props.period)
  if (credit.value) return creditDueAmount(credit.value)
  return 0
})

/** Сумма в строке: у отмеченного — из отметки. */
const shown = computed(() => (record.value ? record.value.amount : due.value))

/** Кредит: сколько из суммы в долг и сколько банку — у отмеченного по записи (Р-8); без ставки «банку 0» врёт (B2C-19). */
const split = computed(() => (credit.value && !credit.value.rateUnknown && shown.value > 0 ? paymentSplit(record.value, credit.value, due.value) : null))

/** Следующий неоплаченный платёж после этого месяца. */
const next = computed(() => {
  const after = { day: 1, key: addMonths(props.period, 1) }
  if (obligation.value) return nextObligationDue(obligation.value, finance.payments, after)
  if (credit.value) return nextCreditDue(credit.value, finance.payments, after)
  return null
})

// Viewer видит отметки, но не ставит их (Р-13): сервер и так отверг бы push.
const canMark = computed(() => !auth.isViewer)

const sheet = ref<'mark' | 'paid' | null>(null)
const markAmount = ref(0)
// undefined — счёт ещё не выбран; null — «не списывать».
const markAccount = ref<string | null | undefined>(undefined)
const firstTime = ref(false)

function openMark(amount: number, account: string | null | undefined) {
  markAmount.value = amount
  markAccount.value = account
  sheet.value = 'mark'
}

/** Главный путь — одно нажатие. Лист — если счёт спросить не у кого или сумма плавает. */
function tap() {
  const last = lastAccountFor(finance.payments, props.targetId, finance.accounts)
  firstTime.value = last === undefined
  if (last === undefined || estimate.value) openMark(due.value, last)
  else finance.markPaid(props.kind, props.targetId, auth.slot ?? 'a', { period: props.period, accountId: last })
}

function openMore() {
  const last = lastAccountFor(finance.payments, props.targetId, finance.accounts)
  firstTime.value = last === undefined
  openMark(due.value, last)
}
</script>

<template>
  <Row :title="title" :accent="accent" :clickable="clickable" :dense="dense" :muted="!!record" @click="clickable && emit('open')">
    <template v-if="$slots.icon" #icon>
      <slot name="icon" />
    </template>

    <template #note>
      <template v-if="record">
        <span class="block text-[12.5px] text-ink-3">
          оплачено{{ next ? ` · дальше ${dayLabel(next.day, next.period)} · ${plain(next.amount)} ₸` : '' }}{{ record.source === 'statement' ? ' · из выписки' : '' }}
        </span>
        <span v-if="credit" class="block text-[12.5px] text-ink-3 num">
          {{ credit.principal > 0 ? `остаток ${plain(credit.principal)} ₸` : 'долг закрыт' }}
        </span>
      </template>
      <span v-else-if="note" class="block text-[12.5px] text-ink-3">{{ note }}</span>
    </template>

    <template #value>
      <span :class="cn('block text-[14.5px] font-semibold num', record ? 'text-ink-3' : 'text-ink')">
        {{ minus ? `−${plain(shown)}` : money(shown) }}
      </span>
      <span v-if="estimate && !record" class="block text-[12px] text-ink-3">оценка</span>
      <template v-if="split">
        <span class="block text-[11.5px] text-ink-3 num">в долг {{ plain(split.body) }}</span>
        <span class="block text-[11.5px] text-ink-3 num">банку {{ plain(split.interest) }}</span>
      </template>
    </template>

    <template v-if="record || (canMark && due > 0)" #action>
      <button
        v-if="record && canMark"
        type="button"
        aria-label="Оплачено — подробнее"
        class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand cursor-pointer"
        @click="sheet = 'paid'"
      >
        <PhCheck :size="15" weight="bold" />
      </button>
      <span
        v-else-if="record"
        aria-label="Оплачено"
        class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"
      >
        <PhCheck :size="15" weight="bold" />
      </span>
      <button
        v-else
        type="button"
        class="shrink-0 rounded-pill border border-line-strong bg-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-ink active:translate-y-px cursor-pointer"
        @click="tap"
      >
        Оплатил
      </button>
    </template>

    <button
      v-if="more && canMark && !record && due > 0"
      type="button"
      :class="cn('-mt-0.5 mb-2.5 text-[12.5px] text-brand hover:underline cursor-pointer', !dense && 'mx-4')"
      @click="openMore"
    >
      Другая сумма или счёт
    </button>
  </Row>

  <MarkSheet
    :open="sheet"
    :kind="kind"
    :target-id="targetId"
    :period="period"
    :title="title"
    :amount="markAmount"
    :account="markAccount"
    :first-time="firstTime"
    @close="sheet = null"
  />
</template>
