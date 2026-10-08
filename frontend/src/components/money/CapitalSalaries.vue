<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, moneyIn } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { monthSalaries } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import SalarySheet from '@/components/money/SalarySheet.vue'

/**
 * Зарплаты этого месяца в «Капитале» — для справки (Р-108, макет money-b16.html): участник, ✓ и сумма — пришла,
 * серая — ждём (дата — в листе зарплаты, Р-116); валютный оклад — мини-подписью в валюте. Нажатие — тот же лист зарплаты, что в «Месяце» (`SalarySheet`); viewer — строки
 * без нажатия. Строки — `monthSalaries`, как в «Месяце».
 */
const finance = useFinanceStore()
const auth = useAuthStore()

const key = computed(() => monthKey())
const canEdit = computed(() => !auth.isViewer)
const lines = computed(() => monthSalaries(finance.monthPlanOf(key.value), { people: finance.people, payments: finance.payments }))
const open = ref<PersonId | null>(null)
const line = computed(() => lines.value.find((s) => s.person === open.value) ?? null)
</script>

<template>
  <Card v-if="lines.length" tight class="flex flex-col gap-2.5" data-capital-salaries>
    <template v-for="(s, i) in lines" :key="s.person">
      <div v-if="i > 0" class="h-px bg-line" />
      <component
        :is="canEdit ? 'button' : 'div'"
        :type="canEdit ? 'button' : undefined"
        class="flex w-full items-center gap-2.5 text-left"
        :class="canEdit && 'press cursor-pointer'"
        :data-salary="s.person"
        @click="canEdit && (open = s.person)"
      >
        <Avatar :id="s.person" :name="s.name" />
        <span class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="text-[15px] font-semibold text-ink">{{ s.name }}</span>
        </span>
        <span class="flex shrink-0 flex-col items-end gap-px">
          <b class="font-num text-[16px] num whitespace-nowrap" :class="s.came ? 'text-ink' : 'text-ink-2'">
            <span v-if="s.came" class="font-extrabold text-ok" data-came>✓ </span>{{ money(s.amount) }}
          </b>
          <span v-if="s.fx" class="type-meta num whitespace-nowrap" data-salary-fx>{{ moneyIn(s.fx.amount, s.fx.currency) }}</span>
        </span>
      </component>
    </template>
  </Card>
  <SalarySheet v-if="canEdit" :month-key="key" :line="line" @close="open = null" />
</template>
