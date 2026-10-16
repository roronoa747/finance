<script setup lang="ts">
import { earlierLabel, type SpendCompareRow } from '@/lib/finance'
import { RK_SPEND_GROUPS } from '@/lib/statements/dictionary'
import { money, plain } from '@/lib/money'
import type { PersonId } from '@/types/finance'
import Hint from '@/components/kit/Hint.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Лист раздела трат на «Месяце» (Р-5, AU-02): крупно — факт месяца семьи, под ним коротко — % дохода, «обычно у вас»,
 * план, «до плана» в мечту, справка РК мелко с `Hint`; план по участникам — строками с тихим «Изменить» (member).
 * Брендовой кнопки нет (правило 12: действия плана — тихие). Все числа — из `spendCompare` / `rkShare`, лист не считает.
 */
defineProps<{
  row: SpendCompareRow | null
  /** Доля группы раздела в тратах семьи за месяц (`rkShare`); нет группы или выписок — null. */
  rk: number | null
  /** План участников по разделу (траты плана месяца, `PlanSpend.rows`); без плана — 0. */
  plans: { by: PersonId; name: string; amount: number }[]
  canEdit: boolean
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'edit', by: PersonId, amount: number): void
}>()
</script>

<template>
  <Sheet :open="!!row" :title="row?.name ?? ''" @close="$emit('close')">
    <template v-if="row">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-cat-amount>
        {{ money(row.amount ?? row.plan ?? 0) }}<span v-if="row.amount === null" class="ml-1.5 text-[15px] font-semibold text-ink-2">план</span>
      </p>
      <div class="mt-1 flex flex-col gap-0.5 text-[14px] text-ink-2 num">
        <span v-if="row.share" data-cat-share>{{ row.share }} % дохода</span>
        <span data-cat-usual>{{ row.usual !== null ? `обычно у вас ${plain(row.usual)}` : 'обычно — когда будет 2 месяца выписок' }}</span>
        <span data-cat-plan>{{ row.plan !== null ? `план ${plain(row.plan)}` : 'плана нет' }}</span>
      </div>
      <p v-if="row.advice" class="mt-3 rounded-[14px] bg-surface-2 px-3 py-[9px] text-[14px] font-semibold text-ink num" data-cat-advice>
        до плана: +{{ plain(row.advice.amount) }} в мечту{{ row.advice.goalName ? ` «${row.advice.goalName}»` : '' }}<template v-if="row.advice.days"> · <span class="whitespace-nowrap">на {{ earlierLabel(row.advice.days) }} раньше</span></template>
      </p>
      <p v-if="row.group && rk !== null" class="mt-2 flex items-center gap-1 text-[12.5px] text-ink-2 num" data-cat-rk>
        {{ RK_SPEND_GROUPS[row.group].name }}: у вас {{ rk }} % · в Алматы {{ RK_SPEND_GROUPS[row.group].share }} %
        <Hint label="Справка">Доля {{ RK_SPEND_GROUPS[row.group].label }} в тратах семей Алматы, {{ RK_SPEND_GROUPS[row.group].source }}, {{ RK_SPEND_GROUPS[row.group].period }}</Hint>
      </p>
      <p v-if="plans.length" class="mt-4 text-[13px] font-semibold text-ink-2" data-cat-plans-title>План каждого</p>
      <div class="mt-1.5 flex flex-col border-t border-line">
        <div v-for="p in plans" :key="p.by" class="flex items-center gap-2 border-b border-line py-2" :data-cat-person="p.by">
          <span class="min-w-0 flex-1 truncate text-[15px] text-ink">{{ p.name }}</span>
          <span class="text-[15px] font-semibold text-ink num">{{ p.amount > 0 ? plain(p.amount) : '—' }}</span>
          <Button v-if="canEdit" variant="ghost" size="sm" data-cat-edit @click="$emit('edit', p.by, p.amount)">Изменить</Button>
        </div>
      </div>
    </template>
  </Sheet>
</template>
