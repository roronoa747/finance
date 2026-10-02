<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney, ratePct } from '@/lib/money'
import { installmentMonths, rateFromSchedule, scheduleMismatch } from '@/lib/finance'
import { plural } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/** Новый долг или рассрочка (бывшее окно Капитала, PV-03): ставка — названная, из срока или без процентов. */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()

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
// Сколько платежей выходит без процентов. С этим числом сверяем срок, названный
// человеком: расхождение почти всегда означает лишний платёж.
const plainMonths = computed(() => installmentMonths(leftPrincipal.value, paymentVal.value))
// Срок назван, а ставка из него не выводится — форма не отказывает, а объясняет.
const mismatch = computed(() =>
  debtMode.value === 'term'
    ? scheduleMismatch(leftPrincipal.value, paymentVal.value, termMonths.value)
    : null,
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
  emit('close')
}
</script>

<template>
  <Sheet :open="open" title="Долг или рассрочка" @close="emit('close')">
    <Field label="Название">
      <Input v-model="debtName" placeholder="Например, рассрочка на телефон" class="mb-3" />
    </Field>
    <Field label="Остаток долга, ₸">
      <NumField v-model="debtPrincipal" placeholder="600 000" class="mb-3" />
    </Field>
    <Field label="Платёж в месяц, ₸">
      <NumField v-model="debtPayment" placeholder="55 000" class="mb-3" />
    </Field>

    <Field label="Проценты" group>
      <Segmented
        v-model="debtMode"
        :options="[
          { value: 'none', label: 'Без них' },
          { value: 'rate', label: 'Знаю ставку' },
          { value: 'term', label: 'Знаю срок' },
        ]"
      />
    </Field>
    <p v-if="debtMode === 'none'" class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-3">
      Рассрочка: платите ровно столько, сколько должны. Приложение посчитает, что долг
      закроется за {{ plainMonths || '—' }} {{ plural(plainMonths, 'платёж', 'платежа', 'платежей') }}.
    </p>

    <Field v-if="debtMode === 'rate'" label="Ставка (ГЭСВ), % годовых">
      <NumField v-model="debtRate" kind="rate" placeholder="23,4" class="mb-3" />
    </Field>
    <Field v-if="debtMode === 'term'" label="Сколько платежей осталось">
      <NumField v-model="debtTerm" kind="int" placeholder="12" class="mb-3" />
    </Field>

    <div
      v-if="debtMode === 'term' && termMonths > 0 && paymentVal > 0 && derivedRate !== null"
      class="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3"
    >
      <span class="text-[12.5px] text-ink-2">Ставка получается</span>
      <div class="font-display text-[20px] font-semibold tracking-[-0.02em] num text-ink">
        {{ ratePct(derivedRate, 1) }} годовых
      </div>
    </div>

    <div v-if="mismatch" class="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3">
      <p class="text-[12.5px] leading-relaxed text-ink-2">
        {{ termMonths }} {{ plural(termMonths, 'платёж', 'платежа', 'платежей') }} по {{ plain(paymentVal) }} — это
        {{ plain(mismatch.paid) }} ₸, а остаток вы указали {{ plain(leftPrincipal) }} ₸.{{
          mismatch.gap > 0
            ? ` Не хватает ${plain(mismatch.gap)} ₸: похоже, платежей ${mismatch.suggest}, а не ${termMonths}.`
            : ' Выходит больше остатка — видимо, в платёж входит что-то ещё.'
        }}
      </p>
      <p class="mt-2 text-[12.5px] leading-relaxed text-ink-3">
        Записать всё равно можно: сохраним как рассрочку без процентов, а ставку
        поправите, когда сверитесь с банком.
      </p>
    </div>

    <Field label="День платежа">
      <NumField v-model="debtDay" kind="int" class="mb-3" />
    </Field>

    <Button :disabled="!canCreateDebt" class="w-full mt-2" @click="createDebt">
      Добавить
    </Button>
  </Sheet>
</template>
