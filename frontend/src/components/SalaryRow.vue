<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowUp, PhCheck } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { moneyIn, plain } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import { lastAccountFor, liveAccounts, paidFor, salaryAt, salaryBreakdownPath, salaryOf, salaryOpen } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import { memberColor } from '@/lib/palette'
import Row from '@/components/kit/Row.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'

/**
 * «Пришла зарплата» (RP-10, Р-18) — зеркало «Оплатил» для зачисления. Отмечает свою
 * зарплату только сам участник (`member.slot`), viewer не отмечает (Р-13); партнёр видит
 * отметку после синка. Одно нажатие — оклад месяца на счёт, куда зарплата пришла в
 * прошлый раз (Р-5); лист (`MarkSheet`, B2C-15) — только для исключений: первая отметка
 * (счёт спросить один раз), премия, правка и снятие. После отметки — разбор этой зарплаты.
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
  /** Кнопка тихая: на экране уже есть главное действие (правило 12 — одна брендовая). */
  quiet?: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
}>()

const router = useRouter()
const finance = useFinanceStore()
const auth = useAuthStore()

const person = computed(() => finance.people.find((p) => p.id === props.personId && !p.deletedAt))
const record = computed(() => paidFor(finance.payments, 'salary', props.personId, props.period))
/**
 * Оклад в валюте (B2C-79, Р-73): приходит на валютный счёт суммой в валюте, после — «Обменял»
 * (`SalaryExchange`); в разбор сразу не ведёт — сначала обмен.
 */
const own = computed(() => (person.value ? salaryOf(person.value, props.period) : null))
const fxSalary = computed(() => !!own.value && own.value.currency !== 'KZT')
/** Оклад месяца — сумма по умолчанию (валютный — в валюте). */
const due = computed(() => (!person.value ? 0 : fxSalary.value ? own.value!.amount : salaryAt(person.value, props.period)))
/** Сумма в строке: у отмеченной — пришедшая. */
const shown = computed(() => (record.value ? (record.value.foreign ?? record.value.amount) : due.value))
const shownText = computed(() => (fxSalary.value || record.value?.foreign ? moneyIn(shown.value, record.value?.currency ?? own.value!.currency) : plain(shown.value)))

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

/** После отметки — разбор этой зарплаты (B2C-58). */
function toAllocation() {
  void router.push(salaryBreakdownPath(props.personId, props.period))
}

function mark(amount: number, accountId: string | null | undefined) {
  if (fxSalary.value) {
    finance.markSalary(props.personId, { period: props.period, foreign: amount, accountId })
    sheet.value = null
    return
  }
  finance.markSalary(props.personId, { period: props.period, amount, accountId: accountId ?? null })
  sheet.value = null
  toAllocation()
}

/** Отмечено в листе: тенговая — в разбор; валютная — остаёмся, дальше «Обменял». */
function onMarked() {
  if (!fxSalary.value) toAllocation()
}

/** Главный путь — одно нажатие. Лист — если счёт спросить не у кого. */
function tap() {
  // Валютная: одним нажатием, когда есть валютный счёт той же валюты (стор выберет); иначе лист с «Евро-счётом».
  if (fxSalary.value) {
    const has = liveAccounts(finance.accounts).some((a) => a.currency === own.value!.currency)
    firstTime.value = !has
    if (has) mark(due.value, undefined)
    else openMark(due.value, undefined)
    return
  }
  const last = lastAccountFor(finance.payments, props.personId, finance.accounts)
  firstTime.value = last === undefined
  if (last === undefined) openMark(due.value, last)
  else mark(due.value, last)
}

function openMore() {
  if (fxSalary.value) return openMark(due.value, undefined)
  const last = lastAccountFor(finance.payments, props.personId, finance.accounts)
  firstTime.value = last === undefined
  openMark(due.value, last)
}
</script>

<template>
  <template v-if="button">
    <Button v-if="canMark" :variant="quiet ? 'secondary' : 'default'" class="mt-3 w-full" @click="tap">
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
    :accent="memberColor(finance.people, personId)"
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
        +{{ shownText }}
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
  <SalaryExchange v-if="!button && record?.foreign" class="pb-2" :person-id="personId" :period="period" />

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
    @marked="onMarked"
    @allocate="toAllocation"
  />
</template>
