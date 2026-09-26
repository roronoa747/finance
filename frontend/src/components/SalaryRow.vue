<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowUp, PhCheck } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import { afterAnchor, lastAccountFor, paidFor, payableAccounts, salaryAt, salaryOpen } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import NumField from '@/components/kit/NumField.vue'
import Button from '@/components/ui/Button.vue'
import AccountChoice from '@/components/AccountChoice.vue'

/**
 * «Пришла зарплата» (RP-10, Р-18) — зеркало «Оплатил» для зачисления. Отмечает свою
 * зарплату только сам участник (`member.slot`), viewer не отмечает (Р-13); партнёр видит
 * отметку после синка. Одно нажатие — оклад месяца на счёт, куда зарплата пришла в
 * прошлый раз (Р-5); лист — только для исключений: первая отметка (счёт спросить один
 * раз), премия, правка и снятие. После отметки — раскладка свободного в `/ritual`.
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
  /** Только кнопка «Пришла зарплата», без строки — карточка «До зарплаты» на Обзоре. */
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

/** Счета, куда можно зачислить: в тенге (валюта зарплаты — не-скоуп, Р-1). */
const choices = computed(() => payableAccounts(finance.accounts))

const sheet = ref<'mark' | 'paid' | null>(null)
const amountText = ref('')
// undefined — счёт ещё не выбран; null — «не зачислять».
const chosen = ref<string | null | undefined>(undefined)
const firstTime = ref(false)
const confirmUnmark = ref(false)

function openMark(amount: number, account: string | null | undefined) {
  amountText.value = plain(amount)
  chosen.value = account
  confirmUnmark.value = false
  sheet.value = 'mark'
}

function mark(amount: number, accountId: string | null) {
  finance.markSalary(props.personId, { period: props.period, amount, accountId })
  sheet.value = null
  void router.push(`/ritual?from=salary&person=${props.personId}&period=${props.period}`)
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

function confirmMark() {
  const amount = parseMoney(amountText.value)
  if (chosen.value === undefined || amount <= 0) return
  // Правка отмеченной — новая запись с тем же моментом (стор, Р-7); раскладка уже была.
  if (record.value) {
    finance.editPaid(record.value, { amount, accountId: chosen.value })
    sheet.value = null
  } else mark(amount, chosen.value)
}

function unmark() {
  finance.unmarkPaid('salary', props.personId, props.period)
  sheet.value = null
}

// Отметка до ручной сверки остатка в нём уже учтена: снятие остаток не тронет — не обещаем.
const unmarkNote = computed(() => {
  const r = record.value
  const acc = r?.accountId ? finance.accounts.find((a) => a.id === r.accountId) : undefined
  const back = !!r?.accountId && (!acc || afterAnchor(r, acc.amountSetAt))
  return `Зарплата снова станет неотмеченной${back ? ', сумма уйдёт со счёта' : ''}.`
})
</script>

<template>
  <template v-if="button">
    <Button v-if="canMark" variant="outline" class="mt-3 w-full bg-surface-2" @click="tap">
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
    :title="`Зарплата · ${person?.name ?? ''}`"
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
        пришла {{ atLabel(record.at) }} · {{ toAccount }}
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
        class="shrink-0 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[12.5px] font-medium text-ink active:translate-y-px cursor-pointer"
        @click="tap"
      >
        Пришла
      </button>
    </template>
  </Row>

  <Sheet :open="sheet !== null" :title="`Зарплата · ${person?.name ?? ''}`" :z="60" @close="sheet = null">
    <template v-if="sheet === 'paid' && record">
      <div class="mb-3 flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Пришла</span>
          <b class="num text-ink">{{ atLabel(record.at) }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Сумма</span>
          <b class="num text-ink">{{ money(record.amount) }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Счёт</span>
          <b class="truncate text-ink">{{ toAccount }}</b>
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
        <span class="text-[12px] leading-relaxed text-ink-3">
          Оклад месяца — {{ money(due) }}. С премией впишите всю сумму: премия целиком ляжет в свободное.
        </span>
      </Field>

      <AccountChoice v-model="chosen" :accounts="choices" label="На какой счёт" none="Не зачислять — только отметить">
        <p v-if="firstTime" class="text-[12px] leading-relaxed text-ink-3">
          Спрашиваем один раз: дальше зарплата отметится одним нажатием на тот же счёт.
        </p>
      </AccountChoice>

      <Button
        class="w-full"
        :disabled="chosen === undefined || parseMoney(amountText) <= 0"
        @click="confirmMark"
      >
        {{ record ? 'Сохранить' : 'Отметить зарплату' }}
      </Button>
    </template>
  </Sheet>
</template>
