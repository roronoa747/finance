<script setup lang="ts">
import { useOperationsStore } from '@/stores/operations'
import { money } from '@/lib/money'
import { dayLabel } from '@/lib/dates'
import { ruleMatchOf } from '@/lib/statements/model'
import type { MerchantRule, Operation } from '@/lib/statements/types'
import Sheet from '@/components/kit/Sheet.vue'
import CategoryChips from '@/components/CategoryChips.vue'

/**
 * Лист операции «<продавец> — куда отнести?» (раздел задним числом): день и сумма, чипы разделов. Ответ — правило по
 * продавцу, итоги и «Свободно» пересчитывает стор (`recategorize`). Один лист на «Историю» и ленту «Недели»; `z` —
 * поверх другого листа (лента).
 */
const props = withDefaults(defineProps<{ op: Operation | null; z?: number }>(), { z: 50 })
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useOperationsStore()
function recategorize(to: MerchantRule['to']) {
  if (props.op) void store.recategorize(ruleMatchOf(props.op), to)
  emit('close')
}
</script>

<template>
  <Sheet :open="!!op" :z="z" :title="op ? `${op.merchant} — куда отнести?` : ''" @close="emit('close')">
    <template v-if="op">
      <p class="mb-3 type-meta num">{{ dayLabel(Number(op.date.slice(8, 10)), op.date.slice(0, 7)) }} · {{ money(Math.abs(op.amount)) }}</p>
      <CategoryChips :counterparty="!!op.counterparty" @choose="recategorize" />
      <p class="mt-3 text-[12px] text-ink-2">Ответ запомним — такие строки разложатся сами.</p>
    </template>
  </Sheet>
</template>
