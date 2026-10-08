<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney, ratePct } from '@/lib/money'
import { installmentMonths, rateFromSchedule, scheduleMismatch } from '@/lib/finance'
import { plural } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Новый долг (бывшее окно Капитала, PV-03): «Банку» — кредит или рассрочка, ставка — названная, из срока или без
 * процентов; «Человеку» (мелочи Р-5) — займ без процентов с именем, путь расчёта — рассрочки.
 */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()

const debtKind = ref<'bank' | 'person'>('bank')
const person = computed(() => debtKind.value === 'person')
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
  person.value || debtMode.value === 'none' ? 0 : debtMode.value === 'rate' ? typedRate.value ?? 0 : derivedRate.value ?? 0,
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
const form = useFormCheck(() => [
  ['name', person.value && !debtName.value.trim() && 'Введите, кому'],
  ['principal', leftPrincipal.value <= 0 && 'Введите остаток'],
  ['payment', paymentVal.value <= 0 && 'Введите платёж'],
])

function createDebt() {
  financeStore.addCredit({
    name: debtName.value.trim() || 'Долг',
    note: person.value ? '' : resolvedRate.value > 0 ? 'ежемесячный платёж' : 'рассрочка',
    principal: leftPrincipal.value,
    annualRate: resolvedRate.value,
    payment: paymentVal.value,
    day: Math.min(28, Math.max(1, parseMoney(debtDay.value) || 1)),
    person: person.value,
  })
  debtKind.value = 'bank'
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
  <Sheet :open="open" title="Новый долг" @close="emit('close')">
    <Segmented
      v-model="debtKind"
      :options="[
        { value: 'bank', label: 'Банку' },
        { value: 'person', label: 'Человеку' },
      ]"
      class="mb-3.5"
    />

    <template v-if="person">
      <Field label="Кому" name="name">
        <Input v-model="debtName" placeholder="Например, брату" />
      </Field>
      <Field label="Сколько осталось, ₸" name="principal">
        <NumField v-model="debtPrincipal" placeholder="500 000" />
      </Field>
      <Field label="Сколько в месяц, ₸" name="payment">
        <template #hint>
          <Hint label="Сколько в месяц">
            Без процентов<template v-if="plainMonths"> — закроется за {{ plainMonths }}
              {{ plural(plainMonths, 'платёж', 'платежа', 'платежей') }}</template>.
          </Hint>
        </template>
        <NumField v-model="debtPayment" placeholder="50 000" />
      </Field>
      <Field label="День">
        <NumField v-model="debtDay" kind="int" />
      </Field>
    </template>

    <template v-else>
      <Field label="Название">
        <Input v-model="debtName" placeholder="Например, рассрочка на телефон" />
      </Field>
      <Field label="Остаток долга, ₸" name="principal">
        <NumField v-model="debtPrincipal" placeholder="600 000" />
      </Field>
      <Field label="Платёж в месяц, ₸" name="payment">
        <NumField v-model="debtPayment" placeholder="55 000" />
      </Field>

      <Field label="Проценты" group>
        <!-- Пояснение рассрочки — в подсказке (макет Б17), не абзацем под переключателем. -->
        <template #hint>
          <Hint label="Проценты">
            Без процентов — рассрочка: платите ровно столько, сколько должны.<template v-if="plainMonths">
              Долг закроется за {{ plainMonths }} {{ plural(plainMonths, 'платёж', 'платежа', 'платежей') }}.</template>
          </Hint>
        </template>
        <Segmented
          v-model="debtMode"
          :options="[
            { value: 'none', label: 'Без них' },
            { value: 'rate', label: 'Знаю ставку' },
            { value: 'term', label: 'Знаю срок' },
          ]"
        />
      </Field>

      <Field v-if="debtMode === 'rate'" label="Ставка (ГЭСВ), % годовых">
        <NumField v-model="debtRate" kind="rate" placeholder="23,4" />
      </Field>
      <Field v-if="debtMode === 'term'" label="Сколько платежей осталось">
        <NumField v-model="debtTerm" kind="int" placeholder="12" />
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
        <p class="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          Записать всё равно можно: сохраним как рассрочку без процентов, а ставку
          поправите, когда сверитесь с банком.
        </p>
      </div>

      <Field label="День платежа">
        <NumField v-model="debtDay" kind="int" />
      </Field>
    </template>

    <Button class="w-full" @click="form.submit(createDebt)">
      Добавить
    </Button>
  </Sheet>
</template>
