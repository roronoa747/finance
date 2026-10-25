<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { lastAccountFor, liveCredits, lumpPlan, NO_SAVING, payableAccounts, prepayBeforeAfter, type LumpMode } from '@/lib/finance'
import type { Payment } from '@/types/finance'
import { plural, sentence } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import AccountChoice from '@/components/AccountChoice.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * «Внёс досрочно» (F2-04, Р-3): сумма, «Сократить срок / Снизить платёж», счёт — одна главная, долг пересчитывает
 * `applyPrepayment` стора. Лист поверх листа кредита или калькулятора (`z` 60); калькулятор — тихим «Подробнее»
 * (`payoff`). После взноса вместо формы — итог.
 */
const props = defineProps<{ creditId: string | null; amount?: number }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'payoff', id: string): void
}>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()

// Без ставки экономия по `lumpPlan` врёт (B2C-19), долг человеку досрочки не знает — лист не открывается.
const credit = computed(() =>
  liveCredits(financeStore.credits).find((c) => c.id === props.creditId && !c.rateUnknown && !c.person),
)
// Досрочка — тенговая сумма (как в калькуляторе): у валютного счёта сдвиг стёрла бы правка курса.
const payAccounts = computed(() => payableAccounts(financeStore.accounts))

const amountText = ref('')
const mode = ref<LumpMode>('term')
// Счёт — как у отметок (`AccountChoice`): не выбран (undefined), «только отметить» (null) или id.
const account = ref<string | null | undefined>(undefined)
const done = ref<Payment | null>(null)

const form = useFormCheck(() => [
  ['amount', parseMoney(amountText.value) <= 0 && 'Впишите сумму'],
  ['account', account.value === undefined && 'Выберите счёт'],
])

// Открыли заново — чистая форма; счёт по умолчанию — прошлой оплаты этого кредита (Р-5).
watch(
  () => [props.creditId, props.amount] as const,
  ([id, amount]) => {
    amountText.value = amount ? plain(amount) : ''
    mode.value = 'term'
    done.value = null
    account.value = id ? lastAccountFor(financeStore.payments, id, financeStore.accounts) : undefined
    form.reset()
  },
  { immediate: true },
)

const plan = computed(() => {
  const c = credit.value
  const v = parseMoney(amountText.value)
  return c && v > 0 ? lumpPlan(c.principal, c.annualRate, c.payment, v, mode.value) : null
})
// Предпросмотр — одна строка; подробности — в калькуляторе.
const preview = computed(() => {
  const p = plan.value
  const c = credit.value
  if (!p || !c) return ''
  if (p.left === 0) return 'Долг закроется этим взносом'
  if (p.openEnded) return sentence(NO_SAVING)
  if (mode.value === 'term') return `Останется ${p.months} ${plural(p.months, 'платёж', 'платежа', 'платежей')} вместо ${p.monthsBefore}`
  return `Платёж ${money(p.payment)} вместо ${money(c.payment)}`
})

// «Было → стало» всех долгов (F2-05, Р-4) — числа только из `finance.ts`.
const result = computed(() => (done.value ? prepayBeforeAfter(financeStore.credits, done.value) : null))

function apply() {
  const c = credit.value
  // Второе касание по кнопке до перерисовки не пишет вторую досрочку.
  if (!c || done.value || account.value === undefined) return
  done.value = financeStore.applyPrepayment(c.id, authStore.slot ?? 'a', {
    amount: parseMoney(amountText.value),
    mode: mode.value,
    accountId: account.value,
  })
}
</script>

<template>
  <Sheet :open="!!credit && !authStore.isViewer" title="Внёс досрочно" :z="60" @close="emit('close')">
    <!-- Итог (F2-05): одна крупная цифра — «стало», «было» — зачёркнутым под ней; без механики. -->
    <template v-if="credit && result" #default="{ close }">
      <div class="mb-4 flex flex-col gap-1" data-prepay-done>
        <span class="text-[15px] font-semibold text-ok">Молодец!</span>
        <span v-if="result.after > 0" class="font-num text-[34px] font-bold leading-none num text-ink" data-prepay-after>{{ money(result.after) }}</span>
        <span v-else class="type-num text-[24px] text-ok" data-prepay-after>Долг закрыт</span>
        <span class="type-meta num">все долги, было <s data-prepay-before>{{ money(result.before) }}</s></span>
        <span v-if="result.saved > 0" class="mt-2 text-[13.5px] text-ink-2" data-prepay-saved>
          Не отдадите банку <b class="num text-brand">{{ money(result.saved) }}</b>
        </span>
      </div>
      <Button class="w-full" @click="close">Готово</Button>
    </template>
    <template v-else-if="credit" #default>
      <Field label="Сколько внесли, ₸" name="amount">
        <NumField v-model="amountText" data-prepay-amount />
      </Field>
      <Segmented
        v-model="mode"
        :options="[
          { value: 'term', label: 'Сократить срок' },
          { value: 'payment', label: 'Снизить платёж' },
        ]"
        class="mb-2"
      />
      <p v-if="preview" class="mb-3.5 text-[13px] text-ink-2 num" data-prepay-preview>{{ preview }}</p>
      <AccountChoice v-model="account" :accounts="payAccounts" label="Откуда списать" name="account" />
      <Button class="w-full" data-prepay-apply @click="form.submit(apply)">Внёс</Button>
      <Button variant="ghost" size="md" class="mt-2 w-full" data-prepay-more @click="emit('payoff', credit.id)">Подробнее</Button>
    </template>
  </Sheet>
</template>
