<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { monthKey } from '@/lib/dates'
import { money, parseMoney } from '@/lib/money'
import { canAfford } from '@/lib/finance'
import { plural } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * «Хватит?» (PN-17, Р-11): сумма покупки → живое «Да» / «Нет» с числом. Со счетами — от «до зарплаты», без них — от
 * остатка плана месяца (решает `canAfford`, `finance.ts`). Ничего не пишет — viewer видит так же.
 */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const finance = useFinanceStore()
const sum = ref('')

const result = computed(() => {
  const amount = parseMoney(sum.value)
  if (amount <= 0) return null
  const { state, ctx } = finance.planInput(monthKey())
  // Счета — те же, что у «до зарплаты» на «Месяце».
  return canAfford({ ...state, accounts: finance.householdAccounts }, ctx, amount)
})
const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`
const months = (n: number) => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
</script>

<template>
  <Sheet :open="open" title="Хватит?" @close="emit('close')">
    <Field label="Сколько стоит, ₸">
      <NumField v-model="sum" placeholder="150 000" data-afford-sum />
    </Field>

    <!-- Одна крупная цифра — ответ (правило 12); строки — коротко. -->
    <div v-if="result" class="flex flex-col gap-1.5 rounded-xl border border-card-border bg-surface-2 px-4 py-3.5" data-afford-result>
      <template v-if="result.ok">
        <span class="type-big text-ok" data-afford-yes>Да</span>
        <p class="text-[14px] num text-ink-2" data-afford-left>до зарплаты останется {{ money(result.left) }}</p>
        <p v-if="result.inDays !== null" class="text-[14px] num text-ink-2" data-afford-payday>зарплата через {{ days(result.inDays) }}</p>
      </template>
      <template v-else>
        <span class="type-big text-warn" data-afford-no>Нет</span>
        <p class="text-[14px] num text-ink-2" data-afford-short>не хватает {{ money(result.short) }}</p>
        <p v-if="result.goal && result.months !== null" class="text-[14px] num text-ink-2" data-afford-goal>
          {{ result.goal }} {{ result.months ? `отодвинется на ${months(result.months)}` : 'почти не сдвинется' }}
        </p>
      </template>
    </div>
    <p v-else class="text-[14px] text-ink-2" data-afford-empty>Введите сумму</p>
  </Sheet>
</template>
