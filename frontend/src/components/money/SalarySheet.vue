<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { useOperationsStore } from '@/stores/operations'
import { money, moneyIn, moneySigned, signTone } from '@/lib/money'
import { atLabel, dayLabel, dayWeekdayLabel } from '@/lib/dates'
import { fxYearDelta, type SalaryLine, type SalaryLineEvent } from '@/lib/finance'
import { CURRENCY_WORD } from '@/lib/fx'
import type { PersonId } from '@/types/finance'
import Hint from '@/components/kit/Hint.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import SalaryDialog from '@/components/SalaryDialog.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import FxRateSheet from '@/components/money/FxRateSheet.vue'

/**
 * Лист зарплаты (Р-97, Р-108) — один для «Месяца» и карточки «Зарплаты» «Капитала»: пришла или ждём, сумма, у своей
 * и ждём — «Пришла» (и «Другая сумма или счёт»); тихо — отметка пришедшей и «Изменить оклад». Строка — `monthSalaries`;
 * «Пришла» отмечена — лист закрывается сам (✓ уже у суммы в строке). Viewer открывает лист только для чтения: дата,
 * «хватает» и обмены живут лишь здесь (Р-116), кнопок у него нет. У валютного оклада (пришёл или нет) — строка
 * «евро за год · −134 ₸» (PN-02, хвост 1022: раньше — только внизу листов обменов), нажатие — лист курса (`FxRateSheet`).
 * Аванс и неделя (понятность Б7): вместо одной даты — приходы месяца строками, «Пришла» — у своего открытого прихода,
 * пришедший свой — нажатием «другая сумма или снять» (`MarkSheet` по ключу прихода); «Когда» — «N из M пришли».
 */
const props = defineProps<{ monthKey: string; line: SalaryLine | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const finance = useFinanceStore()
const fx = useFxStore()
const canEdit = computed(() => !auth.isViewer)
// Свою зарплату отмечает только сам участник (Р-13), когда её день настал или близко.
const mine = computed(() => canEdit.value && !!props.line && auth.slot === props.line.person)

/**
 * Пришло пушем банка (бэклог «Apple Pay», Блок 2, Р-22): сумма, банк и день прихода — здесь, у «Пришла» (на строке
 * «Месяца» — только точка, правило 12). «Пришла зарплата» отметит именно его (`useSalaryTap`). Месячный ритм; у аванса
 * и недели точка — у «Пришла» своего прихода в строках выше.
 */
const ops = useOperationsStore()
const BANK_NAMES: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom', halyk: 'Halyk' }
const arrivalText = computed(() => {
  const l = props.line
  if (!l || !mine.value || !l.open || l.rhythm !== 'month' || l.foreign) return ''
  const a = ops.salaryArrival(l.person, props.monthKey)
  if (!a) return ''
  const bank = BANK_NAMES[a.op.bank]
  const day = dayLabel(Number(a.op.date.slice(8, 10)), a.op.date.slice(0, 7))
  return `${money(a.op.amount)}${bank ? ` в ${bank}` : ''} · ${day}`
})

/** Курс за год (Р-76, `fxYearDelta`): тенговый оклад или книга короче года — null, строки нет. */
const year = computed(() => {
  const l = props.line
  if (!l || !l.foreign) return null
  const p = finance.people.find((x) => x.id === l.person && !x.deletedAt)
  return p ? fxYearDelta(p, props.monthKey, fx.book) : null
})
/** «Евро за год» — с заглавной, как подписи «Когда» и «Хватает» в той же карточке (/ux Блока 1). */
const yearLabel = computed(() => {
  if (!year.value) return ''
  const w = CURRENCY_WORD[year.value.currency].nom
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} за год`
})

/** Лист отметки пришедшей своей зарплаты (когда, счёт, другая сумма, снять), лист оклада (сумма, день, валюта), лист курса. */
const paid = ref<{ person: PersonId; name: string; period: string } | null>(null)
const edit = ref<PersonId | null>(null)
const rate = ref<PersonId | null>(null)
function next(to: 'paid' | 'edit' | 'rate') {
  const l = props.line
  emit('close')
  if (!l) return
  if (to === 'paid') paid.value = { person: l.person, name: l.name, period: props.monthKey }
  else if (to === 'edit') edit.value = l.person
  else rate.value = l.person
}
/** Приходы аванса и недели — строками; месячный ритм — одной датой «Когда». */
const events = computed(() => (props.line && props.line.rhythm !== 'month' ? props.line.events : []))
const eventLabel = (e: SalaryLineEvent) =>
  e.kind === 'week' ? dayWeekdayLabel(e.day) : `${e.kind === 'advance' ? 'Аванс' : 'Зарплата'} · ${dayLabel(Number(e.day.slice(8, 10)), e.day.slice(0, 7))}`
/** Свой пришедший приход — лист отметки этого прихода (другая сумма, счёт, снять). */
function openEvent(e: SalaryLineEvent) {
  const l = props.line
  if (!l || !mine.value || !e.came) return
  emit('close')
  paid.value = { person: l.person, name: l.name, period: e.period }
}
watch(
  () => props.line?.came,
  (came, was) => {
    if (came && was === false) emit('close')
  },
)
</script>

<template>
  <Sheet :open="!!line" :title="line ? `Зарплата · ${line.name}` : ''" @close="emit('close')">
    <template v-if="line">
      <p class="font-num text-[28px] font-bold leading-tight num text-ink" data-salary-total>{{ line.floating && !line.came ? "≈ " : "" }}{{ money(line.amount) }}</p>
      <p v-if="line.fx" class="type-meta num">{{ moneyIn(line.fx.amount, line.fx.currency) }}</p>
      <!-- Переехало со строк «Месяца» и «Капитала» (Р-116): дата, «хватает ли», обмены валютной. -->
      <div class="mb-1 mt-3 flex flex-col rounded-[16px] bg-surface-2 px-3.5">
        <div class="flex items-center justify-between gap-3 py-2.5 text-[14.5px]" data-salary-status>
          <span class="text-ink-2">Когда</span>
          <span v-if="events.length" class="font-semibold text-ink num">{{ line.cameCount }} из {{ line.eventCount }} пришли</span>
          <span v-else class="font-semibold text-ink">{{ line.came && line.at ? `пришла ${atLabel(line.at)}` : `ждём ${dayLabel(line.payday, monthKey)}` }}</span>
        </div>
        <!-- Пришло пушем банка (Блок 2): сумма и день — здесь, «Пришла зарплата» ниже отметит этот приход. -->
        <div v-if="arrivalText" class="flex items-center justify-between gap-3 border-t border-line py-2.5 text-[14.5px]" data-salary-arrival>
          <span class="flex items-center gap-1.5 text-ink-2"><span class="size-2 rounded-full bg-brand" aria-hidden="true" />Пришло?</span>
          <b class="font-num text-ink num">{{ arrivalText }}</b>
        </div>
        <!-- Аванс и неделя: приход — строка; «Пришла» — у своего открытого (правило 12: действие у предмета). -->
        <div
          v-for="e in events"
          :key="e.period"
          class="flex items-center justify-between gap-3 border-t border-line py-2.5 text-[14.5px]"
          :class="mine && e.came ? 'press cursor-pointer' : ''"
          :data-pay-event="e.period"
          @click="openEvent(e)"
        >
          <span class="text-ink-2">{{ eventLabel(e) }}</span>
          <span class="flex items-center gap-2">
            <span v-if="mine && e.open" @click.stop><SalaryRow button small :person-id="line.person" :period="e.period" /></span>
            <b class="font-num num" :class="e.came ? 'text-ink' : 'text-ink-2'">
              <span v-if="e.came" class="font-extrabold text-ok" data-event-came>✓ </span>{{ line.floating && !e.came ? '≈ ' : '' }}{{ money(e.amount) }}
            </b>
          </span>
        </div>
        <div class="flex items-center justify-between gap-3 border-t border-line py-2.5 text-[14.5px]">
          <span class="flex items-center gap-1 text-ink-2">Хватает<Hint label="Хватает ли">Зарплата минус свои платежи, траты, цели и фонды</Hint></span>
          <b class="font-num num" :class="line.left >= 0 ? 'text-ok' : 'text-warn'" data-left>{{ line.left > 0 ? `+${money(line.left)}` : money(line.left) }}</b>
        </div>
        <div v-if="line.came && line.foreign" class="border-t border-line py-2.5" data-salary-exchanges>
          <SalaryExchange :person-id="line.person" :period="monthKey" part="line" />
        </div>
        <!-- «Евро за год» — здесь, у оклада (PN-02): сколько курс отнял или добавил за единицу; нажатие — лист курса. -->
        <button
          v-if="year"
          type="button"
          class="press flex w-full cursor-pointer items-center justify-between gap-3 border-t border-line py-2.5 text-[14.5px]"
          data-fx-year
          @click="next('rate')"
        >
          <span class="text-ink-2">{{ yearLabel }}</span>
          <span class="flex items-center gap-1">
            <b class="font-num num" :class="signTone(year.tenge, 'text-ink')">{{ moneySigned(year.perUnit) }}</b>
            <PhCaretRight :size="14" class="text-ink-3" />
          </span>
        </button>
      </div>
      <SalaryRow v-if="mine && line.open && !events.length" button :person-id="line.person" :period="monthKey" />
      <div class="mt-2 flex flex-col gap-1.5">
        <Button v-if="mine && line.came && !events.length" variant="ghost" size="md" class="w-full" data-salary-paid @click="next('paid')">Другая сумма или снять</Button>
        <Button v-if="canEdit" variant="ghost" size="md" class="w-full" data-salary-edit @click="next('edit')">Изменить оклад</Button>
      </div>
    </template>
  </Sheet>
  <MarkSheet
    v-if="paid"
    open="paid"
    kind="salary"
    :target-id="paid.person"
    :period="paid.period"
    :title="`Зарплата · ${paid.name}`"
    @close="paid = null"
  />
  <SalaryDialog v-if="canEdit" :id="edit" @close="edit = null" />
  <FxRateSheet :person-id="rate" @close="rate = null" />
</template>
