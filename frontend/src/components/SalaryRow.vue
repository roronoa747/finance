<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowUp, PhCheck } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { plain } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import { lastAccountFor, paidFor, salaryAt, salaryOpen } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import Row from '@/components/kit/Row.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'

/**
 * «Пришла зарплата» (RP-10, Р-18) — зеркало «Оплатил» для зачисления. Отмечает свою
 * зарплату только сам участник (`member.slot`), viewer не отмечает (Р-13); партнёр видит
 * отметку после синка. Одно нажатие — оклад месяца на счёт, куда зарплата пришла в
 * прошлый раз (Р-5); лист (`MarkSheet`, B2C-15) — только для исключений: первая отметка
 * (счёт спросить один раз), премия, правка и снятие. После отметки — раскладка свободного.
 */
const props = defineProps<{
  personId: PersonId
  /** Месяц зарплаты — месяц её дня. */
  period: string
  /** Подпись неотмеченной: дата, «оклад». */
  note?: string
  /** Строка ведёт дальше: нажатие мимо кнопки — событие open. */
  clickable?: boolean
  /** Без боковых отступов — строка внутри карточки. */
  dense?: boolean
  /** Только кнопка «Пришла зарплата», без строки — карточка «До зарплаты». */
  button?: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
}>()

const router = useRouter()
const finance = useFinanceStore()
const auth = useAuthStore()

const person = computed(() => finance.people.find((p) => p.id === props.personId && !p.deletedAt))
const record = computed(() => paidFor(finance.payments, 'salary', props.personId, props.period))
/** Оклад месяца — сумма по умолчанию. */
const due = computed(() => (person.value ? salaryAt(person.value, props.period) : 0))
/** Сумма в строке: у отмеченной — пришедшая. */
const shown = computed(() => (record.value ? record.value.amount : due.value))

// Свою зарплату отмечает только сам участник; viewer — никогда (Р-13).
const mine = computed(() => !auth.isViewer && auth.slot === props.personId)
const canMark = computed(
  () => mine.value && !!person.value && salaryOpen(person.value, finance.payments, props.period),
)

const toAccount = computed(() => {
  const id = record.value?.accountId
  if (id === null || id === undefined) return 'не зачислено'
  // Личный счёт партнёра на этом телефоне не виден.
  return finance.accounts.find((a) => a.id === id)?.name ?? 'личный счёт'
})

const title = computed(() => `Зарплата · ${person.value?.name ?? ''}`)

const sheet = ref<'mark' | 'paid' | null>(null)
const markAmount = ref(0)
// undefined — счёт ещё не выбран; null — «не зачислять».
const markAccount = ref<string | null | undefined>(undefined)
const firstTime = ref(false)

function openMark(amount: number, account: string | null | undefined) {
  markAmount.value = amount
  markAccount.value = account
  sheet.value = 'mark'
}

/** После отметки — раскладка свободного (бывший Ритуал). */
function toAllocation() {
  void router.push(`/week/salary?from=salary&person=${props.personId}&period=${props.period}`)
}

function mark(amount: number, accountId: string | null) {
  finance.markSalary(props.personId, { period: props.period, amount, accountId })
  sheet.value = null
  toAllocation()
}

/** Главный путь — одно нажатие. Лист — если счёт спросить не у кого. */
function tap() {
  const last = lastAccountFor(finance.payments, props.personId, finance.accounts)
  firstTime.value = last === undefined
  if (last === undefined) openMark(due.value, last)
  else mark(due.value, last)
}

function openMore() {
  const last = lastAccountFor(finance.payments, props.personId, finance.accounts)
  firstTime.value = last === undefined
  openMark(due.value, last)
}
</script>

<template>
  <template v-if="button">
    <Button v-if="canMark" variant="secondary" class="mt-3 w-full" @click="tap">
      Пришла зарплата
    </Button>
    <button
      v-if="canMark"
      type="button"
      class="mt-2 w-full text-center text-[12.5px] text-brand hover:underline cursor-pointer"
      @click="openMore"
    >
      Другая сумма или счёт
    </button>
  </template>

  <Row
    v-else
    :title="title"
    :accent="`var(--p${personId})`"
    :clickable="clickable"
    :dense="dense"
    :muted="!!record"
    @click="clickable && emit('open')"
  >
    <template #icon>
      <PhArrowUp :size="15" weight="bold" />
    </template>

    <template #note>
      <span v-if="record" class="block text-[12.5px] text-ink-3">
        пришла {{ atLabel(record.at) }} · {{ toAccount }}{{ record.source === 'statement' ? ' · из выписки' : '' }}
      </span>
      <span v-else-if="note" class="block text-[12.5px] text-ink-3">{{ note }}</span>
    </template>

    <template #value>
      <span :class="cn('block text-[14.5px] font-semibold num', record ? 'text-ink-3' : 'text-brand')">
        +{{ plain(shown) }}
      </span>
    </template>

    <template v-if="record || canMark" #action>
      <button
        v-if="record && mine"
        type="button"
        aria-label="Пришла — подробнее"
        class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand cursor-pointer"
        @click="sheet = 'paid'"
      >
        <PhCheck :size="15" weight="bold" />
      </button>
      <span
        v-else-if="record"
        aria-label="Пришла"
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
        Пришла
      </button>
    </template>
  </Row>

  <MarkSheet
    :open="sheet"
    kind="salary"
    :target-id="personId"
    :period="period"
    :title="title"
    :amount="markAmount"
    :account="markAccount"
    :first-time="firstTime"
    @close="sheet = null"
    @marked="toAllocation"
  />
</template>
