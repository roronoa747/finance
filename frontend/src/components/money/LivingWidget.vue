<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { money, parseMoney, plain } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { livingPlanFact } from '@/lib/finance'
import { cn } from '@/lib/utils'
import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'

/**
 * Виджет «Еда и быт» (пивот 3, Р-33, Р-38): факт — траты по выпискам обоих за месяц без разделов,
 * учтённых планом (та же сумма, что вычитает «Свободно», — `monthSpentByFact`), план — база
 * раздела, как в прежнем Бюджете: правится в листе по нажатию на «план» (viewer — только текст).
 * Нет загрузок за месяц — факт «—», тега нет.
 */
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()
const editing = ref(false)

const living = computed(() =>
  livingPlanFact(
    financeStore.categories,
    financeStore.householdDoc.spendTotals ?? [],
    financeStore.householdDoc.spendCategories ?? [],
    monthKey(),
    ops.uploads,
  ),
)

function commit(text: string) {
  financeStore.setCategoryAmount('d4', parseMoney(text))
}
</script>

<template>
  <Card tight class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">
        Еда и быт
        <Hint label="Откуда эти суммы">
          Факт — траты по выпискам обоих за месяц, кроме кредитов, аренды, связи и подписок: они в
          платежах. План — сумма, которую вы задаёте сами.
        </Hint>
      </span>
      <Tag v-if="living.pct !== null" :tone="living.over ? 'warn' : 'ok'" class="num">по выпискам {{ living.pct }} %</Tag>
    </div>
    <div class="flex items-center justify-between gap-3">
      <span class="font-num text-[24px] font-bold leading-[1.05] tracking-[-0.01em] num text-ink">{{ living.spent === null ? '—' : money(living.spent) }}</span>
      <button v-if="!authStore.isViewer" type="button" class="type-meta num cursor-pointer" @click="editing = true">план {{ plain(living.plan) }}</button>
      <span v-else class="type-meta num">план {{ plain(living.plan) }}</span>
    </div>
    <div v-if="living.spent !== null" class="h-1.5 overflow-hidden rounded-[3px] bg-track" aria-hidden="true">
      <i :class="cn('block h-full rounded-[3px]', living.over ? 'bg-destructive' : 'bg-ok')" :style="{ width: `${living.share * 100}%` }" />
    </div>
  </Card>

  <Sheet v-if="!authStore.isViewer" :open="editing" title="Еда и быт" @close="editing = false">
    <Field label="План на месяц">
      <NumFieldBlur :initial="plain(living.plan)" aria-label="Еда и быт — план на месяц" class-name="bg-surface-2" @commit="commit" />
    </Field>
  </Sheet>
</template>
