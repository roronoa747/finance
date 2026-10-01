<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, parseMoney } from '@/lib/money'
import { fxToTenge } from '@/lib/finance'
import type { Account, Currency } from '@/types/finance'
import { cn } from '@/lib/utils'
import { fetchRates, formRate, type FxRates } from '@/lib/fx'

import Field from '@/components/kit/Field.vue'
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
const newAccountRate = ref('')
/** Курс вписан руками — авто-курс его больше не перезаписывает. */
const rateTouched = ref(false)
const newAccountDepositRate = ref('')
const newAccountIsPrivate = ref(false)
const rateInfo = ref<FxRates | null>(null)
const rateBusy = ref(false)
const rateFailed = ref(false)

const accountKinds: { value: Account['kind']; label: string }[] = [
  { value: 'card', label: 'Карта' },
  { value: 'cash', label: 'Наличные' },
  { value: 'deposit', label: 'Вклад' },
  { value: 'envelope', label: 'Конверт' },
]

const isForeign = computed(() => newAccountCurrency.value !== 'KZT')
const parsedAccountAmount = computed(() => parseMoney(newAccountAmount.value))
const rateValue = computed(() => parseFloat(newAccountRate.value.replace(',', '.')))
const accountInTenge = computed(() =>
  isForeign.value
    ? fxToTenge(parsedAccountAmount.value, Number.isFinite(rateValue.value) ? rateValue.value : 0)
    : parsedAccountAmount.value,
)
/** Откуда курс — три состояния запроса (React `AddAccountDialog`). Дата — «25.09.2026». */
const rateNote = computed(() =>
  rateBusy.value
    ? 'Запрашиваем курс Нацбанка…'
    : rateInfo.value
      ? `Курс ${rateInfo.value.source} на ${rateInfo.value.date.split('-').reverse().join('.')}. Можно заменить своим.`
      : rateFailed.value
        ? 'Курс Нацбанка сейчас недоступен — впишите вручную.'
        : '',
)
const canCreateAccount = computed(
  () => parsedAccountAmount.value > 0 && (!isForeign.value || accountInTenge.value > 0),
)

watch([() => props.open, isForeign], async ([open, foreign]) => {
  if (!open || !foreign || rateInfo.value || rateBusy.value) return
  rateBusy.value = true
  try {
    const res = await fetchRates()
    if (res) rateInfo.value = res
    else rateFailed.value = true
  } finally {
    rateBusy.value = false
  }
})

watch(
  () => props.open,
  (open) => {
    if (open) rateTouched.value = false
  },
)

watch([rateInfo, newAccountCurrency], ([info, cur]) => {
  newAccountRate.value = formRate(info, cur, newAccountRate.value, rateTouched.value)
})

function createAccount() {
  if (!canCreateAccount.value) return
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
            rate: rateValue.value,
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
  newAccountRate.value = ''
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
      <div class="grid grid-cols-4 gap-2 mb-3">
        <button
          v-for="c in (['KZT', 'USD', 'EUR', 'RUB'] as Currency[])"
          :key="c"
          type="button"
          :class="cn('rounded-xl border px-3 py-2 text-[13px] transition-colors cursor-pointer', newAccountCurrency === c ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2')"
          @click="newAccountCurrency = c"
        >
          {{ c === 'KZT' ? '₸' : c === 'USD' ? '$' : c === 'EUR' ? '€' : '₽' }}
        </button>
      </div>
    </Field>

    <Field :label="isForeign ? `Сумма в ${newAccountCurrency}` : 'Сумма, ₸'">
      <NumField v-model="newAccountAmount" class="mb-3" />
    </Field>

    <div v-if="isForeign" class="mb-3 flex flex-col gap-2">
      <Field :label="`Курс: сколько тенге за 1 ${newAccountCurrency}`">
        <NumField
          v-model="newAccountRate"
          kind="rate"
          placeholder="533"
          @update:model-value="rateTouched = true"
        />
      </Field>
      <p v-if="rateNote" class="-mt-3 text-[12px] leading-relaxed text-ink-3">{{ rateNote }}</p>
      <div v-if="accountInTenge > 0" class="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px] text-ink-2">
        В капитале это <b class="num text-ink">{{ money(accountInTenge) }}</b>
        <p class="mt-1 text-[12px] leading-relaxed text-ink-3">
          Курс запоминается вместе с датой. Прошлые цифры от скачков курса не поедут — чтобы
          обновить, поменяете курс вручную.
        </p>
      </div>
    </div>

    <Field v-if="newAccountKind === 'deposit'" label="Ставка по вкладу, % годовых — если есть">
      <NumField v-model="newAccountDepositRate" kind="rate" placeholder="16,5" class="mb-3" />
    </Field>

    <Button :disabled="!canCreateAccount" class="w-full mt-2" @click="createAccount">
      Добавить счёт
    </Button>
  </Sheet>
</template>
