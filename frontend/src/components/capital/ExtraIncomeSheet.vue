<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { parseMoney } from '@/lib/money'
import { liveGoals, payableAccounts } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NumField from '@/components/kit/NumField.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/** Внеплановый доход (`?income=1`, бывшее окно Капитала): сумма, кому пришло, в цель или на счёт. */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const people = computed(() => financeStore.people)
const goals = computed(() => liveGoals(financeStore.goals))
// Куда ложится внеплановый доход (как и досрочка калькулятора): у валютного счёта тенге —
// по курсу, и следующая правка курса или суммы в валюте молча стёрла бы сдвиг.
const payAccounts = computed(() => payableAccounts(financeStore.accounts))

const extraIncomeAmount = ref('')
const extraIncomeBy = ref<PersonId>('a')
const extraIncomeTarget = ref('')

const extraIncomeValue = computed(() => parseMoney(extraIncomeAmount.value))
const form = useFormCheck(() => [
  ['amount', extraIncomeValue.value <= 0 && 'Введите сумму'],
  ['target', !extraIncomeTarget.value && 'Выберите, куда'],
])

function applyExtraIncome() {
  const [kind, id] = extraIncomeTarget.value.split(':')
  if (kind === 'goal') {
    financeStore.contribute(id, extraIncomeValue.value, extraIncomeBy.value, 'Внеплановый доход')
  } else {
    // Сдвиг остатка, а не сверка: отметки оплат до дохода продолжают считаться.
    financeStore.shiftAccountAmount(id, extraIncomeValue.value)
  }
  extraIncomeAmount.value = ''
  extraIncomeTarget.value = ''
  emit('close')
}
</script>

<template>
  <Sheet :open="open" title="Внеплановый доход" @close="emit('close')">
    <!-- Три строки пояснения → одна (макет Б17). -->
    <p class="-mt-1 mb-3.5 text-[14px] text-ink-2">Премия, подарок, возврат налога</p>

    <Field label="Сумма, ₸" name="amount">
      <NumField v-model="extraIncomeAmount" placeholder="50 000" />
    </Field>

    <Field v-if="people.length > 1" label="Кому" group>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="p in people"
          :key="p.id"
          type="button"
          :aria-pressed="extraIncomeBy === p.id"
          :class="cn('opt', extraIncomeBy === p.id && 'opt-on')"
          @click="extraIncomeBy = p.id"
        >
          {{ p.name }}
        </button>
      </div>
    </Field>

    <Field label="Куда направить" name="target">
      <Select v-model="extraIncomeTarget">
        <option value="">Выберите…</option>
        <optgroup v-if="goals.length > 0" label="В цель">
          <option v-for="g in goals" :key="g.id" :value="`goal:${g.id}`">
            {{ g.name }}
          </option>
        </optgroup>
        <optgroup v-if="payAccounts.length > 0" label="На счёт">
          <option v-for="a in payAccounts" :key="a.id" :value="`account:${a.id}`">
            {{ a.name }}
          </option>
        </optgroup>
      </Select>
    </Field>

    <p v-if="!goals.length && !payAccounts.length" class="mb-3 text-[12.5px] text-ink-2">
      Сначала заведите цель или счёт — иначе деньги некуда положить.
    </p>

    <Button class="w-full mt-1" @click="form.submit(applyExtraIncome)">
      Записать
    </Button>
  </Sheet>
</template>
