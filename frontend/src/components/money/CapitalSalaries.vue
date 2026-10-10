<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { money, moneyIn } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { monthSalaries } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import SalarySheet from '@/components/money/SalarySheet.vue'

/**
 * Зарплаты этого месяца в «Капитале» — для справки (Р-108, макет money-b16.html): участник, ✓ и сумма — пришла,
 * серая — ждём (дата — в листе зарплаты, Р-116); валютный оклад — мини-подписью в валюте. Нажатие — тот же лист зарплаты, что в «Месяце» (`SalarySheet`); у viewer —
 * только чтение (дата и «хватает» — только там, критик Б17). Строки — `monthSalaries`, как в «Месяце».
 * «Пришла» — у своей открытой строки (PN-02, правило 12: действие у предмета), та же отметка, что в листе
 * (`useSalaryTap`); строка — `div` с кнопкой имени (`data-row-open`), не кнопка в кнопке (ревью Н-7).
 */
const auth = useAuthStore()
const finance = useFinanceStore()

const key = computed(() => monthKey())
const lines = computed(() =>
  monthSalaries(finance.monthPlanOf(key.value), { people: finance.people, payments: finance.payments }).map((s) => ({
    ...s,
    // Свою зарплату отмечает только сам участник (Р-13), когда её день настал или близко.
    canMark: !auth.isViewer && auth.slot === s.person && s.open,
  })),
)
const open = ref<PersonId | null>(null)
const line = computed(() => lines.value.find((s) => s.person === open.value) ?? null)
</script>

<template>
  <Card v-if="lines.length" tight class="flex flex-col gap-2.5" data-capital-salaries>
    <template v-for="(s, i) in lines" :key="s.person">
      <div v-if="i > 0" class="h-px bg-line" />
      <div
        class="press relative flex cursor-pointer items-center gap-2.5"
        :data-salary="s.person"
        :data-can-mark="s.canMark || undefined"
        @click="open = s.person"
      >
        <Avatar :id="s.person" :name="s.name" />
        <button type="button" class="row-open flex min-w-0 flex-1 flex-col gap-px text-left" data-row-open>
          <span class="text-[15px] font-semibold text-ink">{{ s.name }}</span>
        </button>
        <!--
          Одна отметка на счёт прошлого раза, лист строки не открывает; без прошлого счёта — лист отметки.
          Кнопка — слева от суммы, как «Обменял» в «Месяце» (/ux Блока 1): суммы строк в одной колонке до и после отметки.
        -->
        <span v-if="s.canMark" class="relative z-10 shrink-0" @click.stop>
          <SalaryRow button small :person-id="s.person" :period="key" />
        </span>
        <span class="flex shrink-0 flex-col items-end gap-px">
          <b class="font-num text-[16px] num whitespace-nowrap" :class="s.came ? 'text-ink' : 'text-ink-2'">
            <span v-if="s.came" class="font-extrabold text-ok" data-came>✓ </span>{{ money(s.amount) }}
          </b>
          <span v-if="s.fx" class="type-meta num whitespace-nowrap" data-salary-fx>{{ moneyIn(s.fx.amount, s.fx.currency) }}</span>
        </span>
      </div>
    </template>
  </Card>
  <SalarySheet :month-key="key" :line="line" @close="open = null" />
</template>
