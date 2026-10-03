<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn } from '@/lib/money'
import { monthFrom, monthKey } from '@/lib/dates'
import { budgetAmounts, fxYearDelta, incomeBreakdownPath, incomeSplit, loadTag, nextSalaryChange, salaryCtxOf, salaryOf, salaryTenge, type IncomePartKey } from '@/lib/finance'
import { CURRENCY_WORD } from '@/lib/fx'
import type { PersonId } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Hint from '@/components/kit/Hint.vue'
import StackBar from '@/components/kit/StackBar.vue'
import Tag from '@/components/kit/Tag.vue'
import SalaryDialog from '@/components/SalaryDialog.vue'
import FxRateSheet from '@/components/money/FxRateSheet.vue'

/**
 * Виджет «Доход» (пивот 3, Р-33; `pivot-3/index.html`): сумма окладов месяца, тег нагрузки словом (B2C-59, `loadTag`; проценты — в подсказке)
 * (жильё и кредиты в доходе), полоса долей обязательное · мечты · траты · свободно с легендой
 * и строки участников — нажатие открывает оклад и день (`SalaryDialog`, как в прежнем Бюджете;
 * viewer — строка без нажатия). Всё считает `incomeSplit` (`finance.ts`). Нажатие на заголовок и сумму —
 * разбор последней пришедшей зарплаты месяца, иначе план месяца (B2C-58). Под валютным участником — одна
 * строка «евро −134 ₸ за год · −201 000 ₸» (B2C-82, Р-76; минус — `--destructive`, плюс — `--ok`), нажатие —
 * лист «Курс евро» (`FxRateSheet`, и у viewer).
 */
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()
const router = useRouter()
const salaryFor = ref<PersonId | null>(null)
const rateFor = ref<PersonId | null>(null)

const key = computed(() => monthKey())
const state = computed(() => ({ ...financeStore.householdDoc, credits: financeStore.credits, book: fx.book }))
const split = computed(() => incomeSplit(budgetAmounts(state.value, key.value)))
/** Строки участников: оклад в своей валюте, тенге зарплаты месяца (B2C-80, `salaryTenge`: обмены + курс), ближайшее изменение. */
const people = computed(() =>
  financeStore.people
    .filter((p) => !p.deletedAt)
    .map((p) => ({ p, own: salaryOf(p, key.value), tenge: salaryTenge(p, key.value, salaryCtxOf(state.value)).tenge, next: nextSalaryChange(p, key.value, fx.book), year: fxYearDelta(p, key.value, fx.book) })),
)

const LABEL: Record<IncomePartKey, { name: string; color: string }> = {
  must: { name: 'обязательное', color: 'var(--s12)' },
  dreams: { name: 'мечты', color: 'var(--brand)' },
  living: { name: 'траты', color: 'var(--s1)' },
  free: { name: 'остаток по плану', color: 'var(--ok)' },
}
const parts = computed(() => split.value.parts.map((p) => ({ ...p, ...LABEL[p.key] })))
const signed = (v: number) => (v > 0 ? `+${money(v)}` : money(v))
</script>

<template>
  <Card tight class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-1.5 type-label">
        Доход
        <Hint>Кредиты и жильё — {{ split.load }} % дохода. До 30 % — низкая нагрузка, до 50 % — средняя.</Hint>
      </span>
      <Tag v-if="split.income > 0" :tone="loadTag(split.load).tone">{{ loadTag(split.load).text }}</Tag>
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
      <template v-for="{ p, own, tenge, next, year } in people" :key="p.id">
      <component
        :is="authStore.isViewer ? 'div' : 'button'"
        v-bind="authStore.isViewer ? {} : { type: 'button' }"
        :class="['flex w-full items-center gap-3 border-t border-line py-2.5 text-left first:border-t-0 first:pt-0 last:pb-0', !authStore.isViewer && 'cursor-pointer']"
        @click="!authStore.isViewer && (salaryFor = p.id)"
      >
        <Avatar :id="p.id" :name="p.name" />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium text-ink">{{ p.name }}</span>
          <span class="block type-meta num">
            {{ p.payday }}-го<template v-if="next"> · с {{ monthFrom(next.from, false) }} — {{ moneyIn(next.amount, next.currency) }}</template>
          </span>
        </span>
        <span v-if="own.currency === 'KZT'" class="shrink-0 font-semibold num text-ink">{{ money(tenge) }}</span>
        <span v-else class="shrink-0 text-right num">
          <span class="block font-semibold text-ink">{{ moneyIn(own.amount, own.currency) }}</span>
          <span class="block type-meta">≈ {{ money(tenge) }}</span>
        </span>
        <PhCaretRight v-if="!authStore.isViewer" :size="16" class="shrink-0 text-ink-3" />
      </component>
      <!-- Сколько курс отнял или добавил за год (Р-76): одна строка, расчёт — в листе -->
      <button
        v-if="year"
        type="button"
        class="press -mt-1 mb-1 flex cursor-pointer items-center gap-1 self-start pl-[42px] text-left text-[12.5px] num"
        :aria-label="`Курс ${CURRENCY_WORD[year.currency].gen} за год`"
        @click="rateFor = p.id"
      >
        <span :class="year.tenge < 0 ? 'text-destructive' : year.tenge > 0 ? 'text-ok' : 'text-ink-3'">
          {{ CURRENCY_WORD[year.currency].nom }} {{ signed(year.perUnit) }} за год · {{ signed(year.tenge) }}
        </span>
        <PhCaretRight :size="12" class="text-ink-3" />
      </button>
      </template>
    </div>
    <SalaryDialog v-if="!authStore.isViewer" :id="salaryFor" @close="salaryFor = null" />
    <FxRateSheet :person-id="rateFor" @close="rateFor = null" />
  </Card>
</template>
