<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCheck, PhX } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { addMonths, dayLabel, today } from '@/lib/dates'
import {
  amountAt,
  creditDueAmount,
  lastAccountFor,
  liveAccounts,
  nextCreditDue,
  nextObligationDue,
  paidFor,
  type ScheduledKind,
} from '@/lib/finance'
import { cn } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Button from '@/components/ui/Button.vue'

/**
 * «Оплатил» — одна строка для всего, что платится по графику (Р-3): обязательства
 * и кредита, везде, где платёж виден. Одно нажатие отмечает месяц суммой по графику
 * со счёта прошлой оплаты (Р-5). Другая сумма, другой счёт и «не списывать» — в
 * листе, который открывается только для исключений: первая оплата (счёт спросить
 * один раз), сумма-оценка, правка отмеченного. Неотмеченный платёж нейтрален в любой
 * день — без красного и «просрочено».
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
  /** Сумма плавает (коммуналка): нажатие сразу спрашивает сумму. */
  estimate?: boolean
  /** Строка ведёт дальше: нажатие мимо кнопки — событие open. */
  clickable?: boolean
  /** Под строкой — «Другая сумма или счёт» (модалки Капитала). */
  more?: boolean
  /** Без боковых отступов — строка внутри карточки. */
  dense?: boolean
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

/** Сколько платить за этот месяц по графику. */
const due = computed(() => {
  if (obligation.value) return amountAt(obligation.value, props.period)
  if (credit.value) return creditDueAmount(credit.value)
  return 0
})

/** Следующий неоплаченный платёж после этого месяца. */
const next = computed(() => {
  const after = { day: 1, key: addMonths(props.period, 1) }
  if (obligation.value) return nextObligationDue(obligation.value, finance.payments, after)
  if (credit.value) return nextCreditDue(credit.value, finance.payments, after)
  return null
})

// Viewer видит отметки, но не ставит их (Р-13): сервер и так отверг бы push.
const canMark = computed(() => !auth.isViewer)

const paidOn = computed(() => {
  if (!record.value) return ''
  const d = today(new Date(record.value.at))
  return dayLabel(d.day, d.key)
})

const fromAccount = computed(() => {
  const id = record.value?.accountId
  if (id === null || id === undefined) return 'не списано'
  // Личный счёт партнёра на этом телефоне не виден.
  return finance.accounts.find((a) => a.id === id)?.name ?? 'личный счёт'
})

/** Счета, с которых можно списать: платежи в тенге (валюта платежей — не-скоуп). */
const choices = computed(() =>
  liveAccounts(finance.accounts).filter((a) => (a.currency ?? 'KZT') === 'KZT'),
)

const sheet = ref<'mark' | 'paid' | null>(null)
const amountText = ref('')
// undefined — счёт ещё не выбран; null — «не списывать».
const chosen = ref<string | null | undefined>(undefined)
const firstTime = ref(false)
const confirmUnmark = ref(false)

function openMark(amount: number, account: string | null | undefined) {
  amountText.value = plain(amount)
  chosen.value = account
  confirmUnmark.value = false
  sheet.value = 'mark'
}

/** Главный путь — одно нажатие. Лист — если счёт спросить не у кого или сумма плавает. */
function tap() {
  const last = lastAccountFor(finance.payments, props.targetId, finance.accounts)
  firstTime.value = last === undefined
  if (last === undefined || props.estimate) openMark(due.value, last)
  else finance.markPaid(props.kind, props.targetId, auth.slot ?? 'a', { period: props.period, accountId: last })
}

function openMore() {
  const last = lastAccountFor(finance.payments, props.targetId, finance.accounts)
  firstTime.value = last === undefined
  openMark(due.value, last)
}

function confirmMark() {
  const amount = parseMoney(amountText.value)
  if (chosen.value === undefined || amount <= 0) return
  // Правка отмеченного — снять и отметить заново: запись неизменна (Р-7).
  if (record.value) finance.unmarkPaid(props.kind, props.targetId, props.period)
  finance.markPaid(props.kind, props.targetId, auth.slot ?? 'a', {
    period: props.period,
    amount,
    accountId: chosen.value,
  })
  sheet.value = null
}

function unmark() {
  finance.unmarkPaid(props.kind, props.targetId, props.period)
  sheet.value = null
}

const unmarkNote = computed(() => {
  const parts = ['Платёж снова станет неоплаченным']
  if (record.value?.accountId) parts.push('деньги вернутся на счёт')
  if (credit.value) parts.push('остаток долга — к прежнему')
  return parts.join(', ') + '.'
})
</script>

<template>
  <div :class="cn('border-b border-line last:border-b-0', dense ? 'py-2.5' : 'px-4 py-3')">
    <div class="flex w-full items-center gap-3">
      <component
        :is="clickable ? 'button' : 'div'"
        :type="clickable ? 'button' : undefined"
        :class="cn('flex min-w-0 flex-1 items-center gap-3 text-left', clickable && 'cursor-pointer')"
        @click="clickable && emit('open')"
      >
        <div
          v-if="$slots.icon"
          class="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-surface-3"
          :style="accent ? { color: accent, background: 'transparent', border: '1px solid var(--line)' } : undefined"
        >
          <slot name="icon" />
        </div>

        <span class="min-w-0 flex-1">
          <span :class="cn('block truncate text-[14.5px] font-medium', record ? 'text-ink-2' : 'text-ink')">
            {{ title }}
          </span>
          <template v-if="record">
            <span class="block text-[12.5px] text-ink-3">
              оплачено{{ next ? ` · дальше ${dayLabel(next.day, next.period)} · ${plain(next.amount)} ₸` : '' }}
            </span>
            <span v-if="credit" class="block text-[12.5px] text-ink-3 num">
              {{ credit.principal > 0 ? `остаток ${plain(credit.principal)} ₸` : 'долг закрыт' }}
            </span>
          </template>
          <span v-else-if="note" class="block text-[12.5px] text-ink-3">{{ note }}</span>
        </span>

        <span class="shrink-0 text-right">
          <span :class="cn('block text-[14.5px] font-semibold num', record ? 'text-ink-3' : 'text-ink')">
            {{ money(record ? record.amount : due) }}
          </span>
          <span v-if="estimate && !record" class="block text-[12px] text-ink-3">оценка</span>
        </span>
      </component>

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
        v-else-if="canMark && due > 0"
        type="button"
        class="shrink-0 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[12.5px] font-medium text-ink active:translate-y-px cursor-pointer"
        @click="tap"
      >
        Оплатил
      </button>
    </div>

    <button
      v-if="more && canMark && !record && due > 0"
      type="button"
      class="mt-2 text-[12.5px] text-brand hover:underline cursor-pointer"
      @click="openMore"
    >
      Другая сумма или счёт
    </button>

    <Teleport to="body">
      <div
        v-if="sheet"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
        @click.self="sheet = null"
      >
        <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="font-display text-[17px] font-semibold text-ink">{{ title }}</h3>
            <button
              type="button"
              aria-label="Закрыть"
              class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
              @click="sheet = null"
            >
              <PhX :size="16" />
            </button>
          </div>

          <template v-if="sheet === 'paid' && record">
            <div class="mb-3 flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
              <div class="flex justify-between gap-3">
                <span class="text-ink-2">Оплачено</span>
                <b class="num text-ink">{{ paidOn }}</b>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-ink-2">Сумма</span>
                <b class="num text-ink">{{ money(record.amount) }}</b>
              </div>
              <div class="flex justify-between gap-3">
                <span class="text-ink-2">Счёт</span>
                <b class="truncate text-ink">{{ fromAccount }}</b>
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

            <div v-if="confirmUnmark" class="rounded-xl border border-line bg-surface-2 p-3">
              <p class="mb-2 text-[12.5px] leading-relaxed text-ink-2">{{ unmarkNote }}</p>
              <div class="flex gap-2">
                <Button variant="outline" class="flex-1 bg-surface" @click="confirmUnmark = false">Отмена</Button>
                <Button class="flex-1" @click="unmark">Снять</Button>
              </div>
            </div>
            <div v-else class="flex flex-col gap-2">
              <Button variant="outline" class="w-full bg-surface-2" @click="openMark(record.amount, record.accountId)">
                Другая сумма или счёт
              </Button>
              <Button variant="outline" class="w-full bg-surface-2" @click="confirmUnmark = true">
                Снять отметку
              </Button>
            </div>
          </template>

          <template v-else-if="sheet === 'mark'">
            <Field label="Сумма, ₸">
              <NumField v-model="amountText" />
            </Field>

            <div class="mb-3.5 flex flex-col gap-1.5">
              <span class="text-[12.5px] font-medium text-ink-3">С какого счёта</span>
              <button
                v-for="a in choices"
                :key="a.id"
                type="button"
                :class="
                  cn(
                    'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13.5px] transition-colors cursor-pointer',
                    chosen === a.id ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2',
                  )
                "
                @click="chosen = a.id"
              >
                <span class="truncate">{{ a.name }}</span>
                <span class="shrink-0 num">{{ money(a.amount) }}</span>
              </button>
              <button
                type="button"
                :class="
                  cn(
                    'rounded-xl border px-3 py-2.5 text-left text-[13.5px] transition-colors cursor-pointer',
                    chosen === null ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2',
                  )
                "
                @click="chosen = null"
              >
                Не списывать — только отметить
              </button>
              <p v-if="firstTime" class="text-[12px] leading-relaxed text-ink-3">
                Спрашиваем один раз: дальше этот платёж отметится одним нажатием с того же счёта.
              </p>
            </div>

            <Button
              class="w-full"
              :disabled="chosen === undefined || parseMoney(amountText) <= 0"
              @click="confirmMark"
            >
              {{ record ? 'Сохранить' : 'Отметить оплату' }}
            </Button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>
