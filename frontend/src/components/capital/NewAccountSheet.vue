<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { plain, parseMoney } from '@/lib/money'
import type { Account, Currency } from '@/types/finance'
import { cn } from '@/lib/utils'
import { CURRENCY_SIGN } from '@/lib/fx'

import CurrencyChips from '@/components/kit/CurrencyChips.vue'
import NbRateLine from '@/components/kit/NbRateLine.vue'
import { useNbRate } from '@/components/kit/useNbRate'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/** Новый счёт или накопления (бывшее окно Капитала): общий/личный, вид (и вклад), валюта с курсом Нацбанка. */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()

const newAccountKind = ref<Account['kind']>('card')
const newAccountName = ref('')
const newAccountAmount = ref('')
const newAccountCurrency = ref<Currency>('KZT')
const newAccountDepositRate = ref('')
const newAccountIsPrivate = ref(false)
/** Курс Нацбанка сегодня: книга, иначе публичная ручка; нет — поле курса руками (`useNbRate`, как в формах оклада и платежа). */
const nb = useNbRate(newAccountCurrency, () => props.open)

const accountKinds: { value: Account['kind']; label: string }[] = [
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
  { value: 'deposit', label: 'Вклад' },
  { value: 'envelope', label: 'Конверт' },
]

const isForeign = nb.foreign
const parsedAccountAmount = computed(() => parseMoney(newAccountAmount.value))
const accountInTenge = computed(() =>
  isForeign.value ? nb.tenge(parsedAccountAmount.value) : parsedAccountAmount.value,
)
const form = useFormCheck(() => [
  [
    'amount',
    parsedAccountAmount.value <= 0
      ? 'Введите сумму'
      : isForeign.value && accountInTenge.value <= 0 && 'Нет курса — попробуйте позже',
  ],
])

function createAccount() {
  const annual = parseFloat(newAccountDepositRate.value.replace(',', '.'))
  financeStore.addAccount(
    {
      name:
        newAccountName.value.trim() ||
        accountKinds.find((k) => k.value === newAccountKind.value)!.label,
      note: isForeign.value ? `${plain(parsedAccountAmount.value)} ${newAccountCurrency.value}` : '',
      amount: accountInTenge.value,
      kind: newAccountKind.value,
      ...(isForeign.value
        ? {
            currency: newAccountCurrency.value,
            foreignAmount: parsedAccountAmount.value,
            rate: nb.rate.value,
            rateAt: new Date().toISOString(),
          }
        : {}),
      ...(newAccountKind.value === 'deposit' && Number.isFinite(annual) && annual > 0
        ? { deposit: { annualRate: annual / 100, months: 12, monthlyTopUp: 0, capitalize: true } }
        : {}),
    },
    newAccountIsPrivate.value,
  )
  newAccountName.value = ''
  newAccountAmount.value = ''
  nb.manual.value = ''
  newAccountDepositRate.value = ''
  newAccountIsPrivate.value = false
  emit('close')
}
</script>

<template>
  <Sheet :open="open" title="Счёт или накопления" @close="emit('close')">
    <Field label="Приватность счёта" group>
      <div class="grid grid-cols-2 gap-2 mb-3">
        <button
          type="button"
          :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', !newAccountIsPrivate ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
          @click="newAccountIsPrivate = false"
        >
          Общий (семья)
        </button>
        <button
          type="button"
          :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', newAccountIsPrivate ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
          @click="newAccountIsPrivate = true"
        >
          Личный (только мне)
        </button>
      </div>
    </Field>

    <Field label="Что это" group>
      <div class="grid grid-cols-2 gap-2 mb-3">
        <button
          v-for="k in accountKinds"
          :key="k.value"
          type="button"
          :class="cn('rounded-xl border px-3 py-2 text-[13px] transition-colors cursor-pointer', newAccountKind === k.value ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2')"
          @click="newAccountKind = k.value"
        >
          {{ k.label }}
        </button>
      </div>
    </Field>

    <Field label="Название">
      <Input v-model="newAccountName" placeholder="Например, Kaspi Gold" class="mb-3" />
    </Field>

    <Field label="Валюта" group>
      <CurrencyChips v-model="newAccountCurrency" class="mb-3" />
    </Field>

    <Field :label="`Сумма, ${CURRENCY_SIGN[newAccountCurrency]}`" name="amount">
      <NumField v-model="newAccountAmount" class="mb-3" />
    </Field>

    <NbRateLine :amount="parsedAccountAmount" :currency="newAccountCurrency" :nb="nb" />

    <Field v-if="newAccountKind === 'deposit'" label="Ставка по вкладу, % годовых — если есть">
      <NumField v-model="newAccountDepositRate" kind="rate" placeholder="16,5" class="mb-3" />
    </Field>

    <Button class="w-full mt-2" @click="form.submit(createAccount)">
      Добавить счёт
    </Button>
  </Sheet>
</template>
