<script setup lang="ts">
import { computed } from 'vue'
import { PhArrowUp, PhCheck } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { moneyIn, plain } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import { memberColor } from '@/lib/palette'
import Row from '@/components/kit/Row.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import { useSalaryTap } from '@/components/useSalaryTap'

/**
 * «Пришла зарплата» (RP-10, Р-18) — зеркало «Оплатил» для зачисления. Отмечает свою
 * зарплату только сам участник (`member.slot`), viewer не отмечает (Р-13); партнёр видит
 * отметку после синка. Одно нажатие — оклад месяца на счёт, куда зарплата пришла в
 * прошлый раз (Р-5); лист (`MarkSheet`, B2C-15) — только для исключений: первая отметка
 * (счёт спросить один раз), премия, правка и снятие. После отметки — разбор этой зарплаты.
 * Сама отметка — `useSalaryTap` (PN-02): одна на строку «Месяца»/«Капитала» и лист зарплаты.
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
  /**
   * С `button`: маленькая «Пришла» у своей строки зарплаты в «Месяце» и «Капитале» (PN-02, правило 12 — действие у
   * предмета), без «Другая сумма или счёт» (он — в листе, который открывает сама строка). Ничего не рендерит, пока
   * отметить нельзя.
   */
  small?: boolean
}>()

const emit = defineEmits<{
  (e: 'open'): void
}>()

const finance = useFinanceStore()

const { record, own, fxSalary, due, mine, canMark, title, sheet, markAmount, markAccount, firstTime, tap, openMore, onMarked, toAllocation } = useSalaryTap(
  () => props.personId,
  () => props.period,
)

/** Сумма в строке: у отмеченной — пришедшая. */
const shown = computed(() => (record.value ? (record.value.foreign ?? record.value.amount) : due.value))
const shownText = computed(() => (fxSalary.value || record.value?.foreign ? moneyIn(shown.value, record.value?.currency ?? own.value!.currency) : plain(shown.value)))

const toAccount = computed(() => {
  const id = record.value?.accountId
  if (id === null || id === undefined) return 'не зачислено'
  // Личный счёт партнёра на этом телефоне не виден.
  return finance.accounts.find((a) => a.id === id)?.name ?? 'личный счёт'
})
</script>

<template>
  <template v-if="button && small">
    <Button v-if="canMark" variant="soft" size="sm" data-salary-came-btn @click="tap">Пришла</Button>
  </template>
  <template v-else-if="button">
    <Button v-if="canMark" :variant="quiet ? 'secondary' : 'default'" class="mt-3 w-full" @click="tap">
      Пришла зарплата
    </Button>
    <!-- Тихая 44, как «Другая сумма или снять» и «Изменить оклад» в том же листе (/ux Блока 1: один размер на уровень). -->
    <Button v-if="canMark" variant="ghost" size="md" class="mt-2 w-full" @click="openMore">
      Другая сумма или счёт
    </Button>
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
      <span v-if="record" class="block text-[12.5px] text-ink-2">
        пришла {{ atLabel(record.at) }} · {{ toAccount }}{{ record.source === 'statement' ? ' · из выписки' : '' }}
      </span>
      <span v-else-if="note" class="block text-[12.5px] text-ink-2">{{ note }}</span>
    </template>

    <template #value>
      <span :class="cn('block text-[14.5px] font-semibold num', record ? 'text-ink-2' : 'text-brand')">
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
  <!-- Валютная: строка обменов — и у пришедшей, и после снятой отметки, пока живы обмены месяца (Н-6). -->
  <SalaryExchange v-if="!button && (record?.foreign || fxSalary)" class="pb-2" :person-id="personId" :period="period" />

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
