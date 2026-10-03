<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn, plain, parseMoney } from '@/lib/money'
import { monthKey, monthTitle, monthFrom, addMonths } from '@/lib/dates'
import { fxToTenge, salaryAt, salaryOf } from '@/lib/finance'
import { CURRENCY_SIGN } from '@/lib/fx'
import type { Currency, PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import CurrencyChips from '@/components/kit/CurrencyChips.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import { useNbRate } from '@/components/kit/useNbRate'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Оклад участника: имя, исправление текущего оклада, день зарплаты и новая версия оклада с
 * месяца — в том числе задним числом (до 24 месяцев) и в валюте (Р-70, B2C-78): чипы валют,
 * сумма в валюте, под ней тихая строка «≈ N ₸ по курсу Нацбанка». Курс версии — сегодняшний
 * из книги (нет — публичная `/api/fx-rate`, нет и её — поле курса руками, как у счёта).
 */
const props = defineProps<{
  id: PersonId | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const financeStore = useFinanceStore()
const fx = useFxStore()
const key = computed(() => monthKey())

const person = computed(() => financeStore.people.find((p) => p.id === props.id))

const planning = ref(false)
const newAmount = ref('')
const fromMonth = ref(addMonths(monthKey(), 1))
const reason = ref('')
const personName = ref(person.value?.name ?? '')
const newCurrency = ref<Currency>('KZT')
/** Курс Нацбанка на сегодня: книга, иначе публичная ручка; нет — поле курса руками (`useNbRate`). */
const { foreign: isForeign, auto: autoRate, manual: manualRate, rate, ok: rateOk } = useNbRate(newCurrency, planning)

watch(
  () => person.value?.name,
  (name) => {
    if (name !== undefined) personName.value = name
  },
  { immediate: true },
)

const saved = useSavedMark(
  () => props.id ?? undefined,
  () => person.value?.updatedAt,
)

// Другой человек — чистая форма.
watch(
  () => props.id,
  () => {
    planning.value = false
    newAmount.value = ''
    reason.value = ''
    manualRate.value = ''
    fromMonth.value = addMonths(monthKey(), 1)
    personName.value = person.value?.name ?? ''
  },
)

/** Оклад этого месяца в своей валюте и в тенге (валютный — по курсу дня зарплаты). */
const current = computed(() => (person.value ? salaryOf(person.value, key.value) : { amount: 0, currency: 'KZT' as Currency }))
const currentTenge = computed(() => (person.value ? salaryAt(person.value, key.value, fx.book) : 0))
const sign = computed(() => CURRENCY_SIGN[current.value.currency])

/** Месяцы версии: 24 назад (задним числом, Р-70) … 12 вперёд. */
const months = computed(() =>
  Array.from({ length: 37 }, (_, i) => addMonths(key.value, i - 24)).map((m) => ({ value: m, label: monthTitle(m) })),
)
const planned = computed(() => parseMoney(newAmount.value))
const plannedTenge = computed(() => (rateOk.value ? fxToTenge(planned.value, rate.value) : 0))
const delta = computed(() => (planned.value > 0 && rateOk.value ? plannedTenge.value - currentTenge.value : 0))
const history = computed(() =>
  [...(person.value?.salaryVersions ?? [])].sort((a, b) => b.from.localeCompare(a.from)),
)

function onNameBlur() {
  if (!person.value) return
  const v = personName.value.trim()
  if (v && v !== person.value.name) {
    financeStore.setPerson(person.value.id, { name: v })
  }
}

function onSalaryCommit(text: string) {
  if (!person.value) return
  const v = parseMoney(text)
  if (v > 0 && v !== current.value.amount) {
    financeStore.correctSalary(person.value.id, v)
  }
}

function onPaydayCommit(text: string) {
  if (!person.value) return
  const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
  if (v !== person.value.payday) {
    financeStore.setPerson(person.value.id, { payday: v })
  }
}

// «Новый оклад» — сразу под пальцем (React `Budget.tsx:426-427` `autoFocus`), как PV-11; валюта — нынешняя.
const planRef = ref<HTMLElement | null>(null)
function startPlanning() {
  planning.value = true
  newCurrency.value = current.value.currency
  void nextTick(() => planRef.value?.querySelector<HTMLInputElement>('input[inputmode]')?.focus())
}

function handlePlanSubmit() {
  if (!person.value || planned.value <= 0 || !rateOk.value) return
  financeStore.amendSalary(
    person.value.id,
    fromMonth.value,
    planned.value,
    reason.value.trim() || undefined,
    isForeign.value ? { currency: newCurrency.value, rate: rate.value } : undefined,
  )
  planning.value = false
  newAmount.value = ''
  reason.value = ''
  manualRate.value = ''
}
</script>

<template>
  <Sheet :open="!!person" :title="person?.name ?? ''" @close="emit('close')">
    <template #mark><SavedMark :on="saved" /></template>
    <template v-if="person">
      <Field label="Имя">
        <Input v-model="personName" @blur="onNameBlur" />
      </Field>

      <Field :label="`Оклад сейчас, ${sign}`">
        <NumFieldBlur :initial="plain(current.amount)" @commit="onSalaryCommit" />
      </Field>
      <p class="-mt-1 mb-3 flex items-center gap-1 text-[12px] text-ink-3 num">
        <template v-if="current.currency !== 'KZT'">≈ {{ money(currentTenge) }} по курсу Нацбанка ·</template>
        только исправить ошибку
        <Hint>Оклад был введён неверно. Если зарплата действительно меняется — не трогайте это поле, а измените оклад с нужного месяца ниже.</Hint>
      </p>

      <Field label="День зарплаты">
        <NumFieldBlur :initial="String(person.payday)" kind="int" @commit="onPaydayCommit" />
      </Field>

      <div v-if="!planning" class="mb-3">
        <Button variant="outline" class="w-full bg-surface-2" @click="startPlanning">
          Изменить оклад
        </Button>
      </div>

      <div v-else ref="planRef" class="mb-3 rounded-xl border border-brand p-3.5">
        <Field label="Валюта" group>
          <CurrencyChips v-model="newCurrency" />
        </Field>

        <Field :label="`Новый оклад, ${CURRENCY_SIGN[newCurrency]}`">
          <NumField v-model="newAmount" :placeholder="plain(current.currency === newCurrency ? current.amount : 0)" />
        </Field>
        <p v-if="isForeign && autoRate && planned > 0" class="-mt-2.5 mb-3 text-[12px] text-ink-3 num">
          ≈ {{ money(plannedTenge) }} по курсу Нацбанка
        </p>
        <Field v-if="isForeign && !autoRate" :label="`Курс: сколько тенге за 1 ${newCurrency}`">
          <NumField v-model="manualRate" kind="rate" placeholder="505" />
        </Field>

        <Field label="С какого месяца">
          <Select v-model="fromMonth" :options="months" />
        </Field>

        <Field label="Причина">
          <Input v-model="reason" placeholder="Повышение, смена работы…" />
        </Field>

        <div
          v-if="planned > 0 && delta !== 0"
          :class="
            cn(
              'mb-3 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed',
              delta > 0 ? 'bg-brand-soft text-ink-2' : 'bg-warn-soft text-ink-2',
            )
          "
        >
          <template v-if="delta > 0">
            С {{ monthFrom(fromMonth) }} доход вырастет на <b>{{ money(delta) }}</b> в месяц —
            {{ money(delta * 12) }} за год.
          </template>
          <template v-else>
            С {{ monthFrom(fromMonth) }} доход снизится на <b>{{ money(-delta) }}</b> в месяц.
            Остаток по плану пересчитается сам.
          </template>
        </div>

        <div class="flex gap-2">
          <Button variant="outline" class="flex-1" @click="planning = false">Отмена</Button>
          <Button class="flex-1" :disabled="planned <= 0 || !rateOk" @click="handlePlanSubmit">
            Сохранить
          </Button>
        </div>
      </div>

      <div v-if="history.length > 1" class="mt-4 border-t border-line pt-3">
        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          История оклада
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="v in history" :key="v.from" class="flex items-baseline gap-2 text-[13px]">
            <span class="text-ink-3">
              {{ v.from <= key ? 'с' : 'станет с' }} {{ monthFrom(v.from) }}
            </span>
            <b class="ml-auto num font-semibold text-ink">{{ moneyIn(v.amount, v.currency) }}</b>
            <span v-if="v.reason" class="text-[12px] text-ink-3">{{ v.reason }}</span>
          </div>
        </div>
      </div>
    </template>
  </Sheet>
</template>
