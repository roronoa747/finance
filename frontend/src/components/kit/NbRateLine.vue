<script setup lang="ts">
import { money } from '@/lib/money'
import { CURRENCY_SIGN } from '@/lib/fx'
import type { Currency } from '@/types/finance'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import type { NbRate } from '@/components/kit/useNbRate'

/**
 * Курс под суммой в валюте (Р-70, Р-73, Р-75) — одна разметка для форм оклада, платежа и счёта:
 * курс Нацбанка есть — тихая строка «≈ N ₸ по курсу Нацбанка» (сумма > 0); нет — поле курса руками.
 * Тенге — `nb.tenge` (`fxToTenge`). У тенговой суммы ничего не показывает.
 */
const props = defineProps<{ amount: number; currency: Currency; nb: NbRate }>()
const setManual = (v: string) => (props.nb.manual.value = v)
</script>

<template>
  <template v-if="nb.foreign.value">
    <p v-if="nb.auto.value && amount > 0" class="-mt-2.5 mb-3 text-[12px] text-ink-3 num">
      ≈ {{ money(nb.tenge(amount)) }} по курсу Нацбанка
    </p>
    <Field v-else-if="!nb.auto.value" :label="`Курс, ₸ за 1 ${CURRENCY_SIGN[currency]}`">
      <NumField :model-value="nb.manual.value" kind="rate" placeholder="505" @update:model-value="setManual" />
    </Field>
  </template>
</template>
