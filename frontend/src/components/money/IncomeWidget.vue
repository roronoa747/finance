<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money } from '@/lib/money'
import { monthFrom, monthKey } from '@/lib/dates'
import { budgetAmounts, incomeBreakdownPath, incomeSplit, nextSalaryChange, salaryAt, type IncomePartKey } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Hint from '@/components/kit/Hint.vue'
import StackBar from '@/components/kit/StackBar.vue'
import Tag from '@/components/kit/Tag.vue'
import SalaryDialog from '@/components/SalaryDialog.vue'

/**
 * Виджет «Доход» (пивот 3, Р-33; `pivot-3/index.html`): сумма окладов месяца, тег «нагрузка N %»
 * (жильё и кредиты в доходе), полоса долей обязательное · мечты · траты · свободно с легендой
 * и строки участников — нажатие открывает оклад и день (`SalaryDialog`, как в прежнем Бюджете;
 * viewer — строка без нажатия). Всё считает `incomeSplit` (`finance.ts`). Нажатие на заголовок и сумму —
 * разбор последней пришедшей зарплаты месяца, иначе план месяца (B2C-58).
 */
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const router = useRouter()
const salaryFor = ref<PersonId | null>(null)

const key = computed(() => monthKey())
const split = computed(() => incomeSplit(budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits }, key.value)))
const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))

const LABEL: Record<IncomePartKey, { name: string; color: string }> = {
  must: { name: 'обязательное', color: 'var(--s12)' },
  dreams: { name: 'мечты', color: 'var(--brand)' },
  living: { name: 'траты', color: 'var(--s1)' },
  free: { name: 'остаток по плану', color: 'var(--ok)' },
}
const parts = computed(() => split.value.parts.map((p) => ({ ...p, ...LABEL[p.key] })))
</script>

<template>
  <Card tight class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-1.5 type-label">
        Доход
        <Hint>
          Нагрузка — кредиты и жильё: до 30 % по кредитам комфортно, до 50 % вместе с жильём — ориентир для
          пары. Зарплаты приходят в разные дни, месяц закрывается 1-го.
        </Hint>
      </span>
      <Tag v-if="split.income > 0" class="num">нагрузка {{ split.load }} %</Tag>
    </div>
    <!-- Сумма — вход в разбор месяца (B2C-58): последняя пришедшая зарплата, иначе план -->
    <button
      type="button"
      class="press flex cursor-pointer items-center gap-1 self-start text-left"
      aria-label="Разбор месяца"
      @click="router.push(incomeBreakdownPath(financeStore.payments, key))"
    >
      <span class="type-num num text-ink">{{ money(split.income) }}</span>
      <PhCaretRight :size="16" class="text-ink-3" />
    </button>
    <template v-if="split.income > 0">
      <StackBar :segments="parts.map((p) => ({ key: p.key, share: p.share, color: p.color }))" />
      <div class="flex flex-wrap gap-x-3 gap-y-1.5 text-[12.5px] text-ink-2">
        <span v-for="p in parts" :key="p.key" class="num">
          <i class="mr-[5px] inline-block size-[9px] rounded-full align-[1px]" :style="{ background: p.color }" />{{ p.name }} {{ p.pct }} %
        </span>
      </div>
    </template>
    <p v-if="split.overplanned > 0" class="text-[12.5px] text-warn num">План не сходится: расписано на {{ money(split.overplanned) }} больше, чем приходит</p>

    <div v-if="people.length" class="mt-1 flex flex-col">
      <component
        :is="authStore.isViewer ? 'div' : 'button'"
        v-for="p in people"
        :key="p.id"
        v-bind="authStore.isViewer ? {} : { type: 'button' }"
        :class="['flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0 first:pt-0 last:pb-0', !authStore.isViewer && 'cursor-pointer']"
        @click="!authStore.isViewer && (salaryFor = p.id)"
      >
        <Avatar :id="p.id" :name="p.name" />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium text-ink">{{ p.name }}</span>
          <span class="block type-meta num">
            {{ p.payday }}-го<template v-if="nextSalaryChange(p, key)"> · с {{ monthFrom(nextSalaryChange(p, key)!.from, false) }} — {{ money(nextSalaryChange(p, key)!.amount) }}</template>
          </span>
        </span>
        <span class="shrink-0 font-semibold num text-ink">{{ money(salaryAt(p, key)) }}</span>
        <PhCaretRight v-if="!authStore.isViewer" :size="16" class="shrink-0 text-ink-3" />
      </component>
    </div>
    <SalaryDialog v-if="!authStore.isViewer" :id="salaryFor" @close="salaryFor = null" />
  </Card>
</template>
