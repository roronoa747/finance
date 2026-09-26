<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money } from '@/lib/money'
import { MONTHS_NOM, addMonths, monthFrom, monthIn, parseMonthKey } from '@/lib/dates'
import { monthSummary } from '@/lib/finance'
import { plural } from '@/lib/utils'
import Card from '@/components/kit/Card.vue'

/**
 * «Наш <месяц>» (RP-13, Р-22) — итог месяца на двоих: что оплатили, что закрыли, сколько
 * отложили и насколько приблизились к желаниям. Числа — `monthSummary` (finance.ts);
 * разрезов по участникам и оценок «хорошо/плохо» нет — оба видят одно и то же. Можно
 * посмотреть месяц раньше — без нового экрана. Действие к итогу (RP-28 «Разобрать») —
 * слотом.
 */
const props = defineProps<{
  /** Месяц итога по умолчанию — `summaryMonth()`. */
  month: string
}>()

const finance = useFinanceStore()

// Месяц раньше — переключатель внутри карточки.
const earlier = ref(false)
const key = computed(() => (earlier.value ? addMonths(props.month, -1) : props.month))
const other = computed(() => (earlier.value ? props.month : addMonths(props.month, -1)))

const title = computed(() => `Наш ${MONTHS_NOM[parseMonthKey(key.value).month].toLowerCase()}`)

// Кредиты — из документа (база сверки): закрытие ищется по записям, как в «Истории семьи».
const summary = computed(() =>
  monthSummary(
    {
      credits: finance.householdDoc.credits,
      goals: finance.goals,
      payments: finance.payments,
      wishlist: finance.wishlist,
    },
    key.value,
  ),
)

const lines = computed(() => {
  const s = summary.value
  const out: { label: string; value: string; note?: string }[] = []
  if (s.paid.count) {
    out.push({ label: `Оплатили ${s.paid.count} ${plural(s.paid.count, 'платёж', 'платежа', 'платежей')}`, value: money(s.paid.amount) })
  }
  if (s.income) out.push({ label: 'Пришло зарплатой', value: money(s.income) })
  if (s.closed.length) {
    out.push({ label: s.closed.length > 1 ? 'Закрыли долги' : 'Закрыли долг', value: s.closed.map((c) => `«${c.name}»`).join(', ') })
  }
  if (s.prepaid.count) {
    out.push({
      label: 'Внесли досрочно',
      value: money(s.prepaid.amount),
      note: s.prepaid.saved ? `не отдадим банку ${money(s.prepaid.saved)}` : undefined,
    })
  }
  if (s.toGoals) out.push({ label: 'Отложили в цели', value: money(s.toGoals) })
  if (s.fromGoals) out.push({ label: 'Взяли из целей', value: money(s.fromGoals) })
  if (s.closest) out.push({ label: `«${s.closest.name}»`, value: `${s.closest.from}% → ${s.closest.to}%` })
  if (s.bought.count) {
    out.push({
      label: `Купили из списка: ${s.bought.count} ${plural(s.bought.count, 'покупка', 'покупки', 'покупок')}`,
      value: money(s.bought.amount),
    })
  }
  return out
})
</script>

<template>
  <Card>
    <div class="text-[12.5px] text-ink-3">Итог месяца</div>
    <div class="mt-0.5 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">{{ title }}</div>

    <div v-if="lines.length" class="mt-2 flex flex-col">
      <div
        v-for="l in lines"
        :key="l.label"
        class="flex items-baseline gap-3 border-b border-line py-2 last:border-b-0"
      >
        <span class="min-w-0 flex-1 text-[13.5px] text-ink-2">
          {{ l.label }}
          <span v-if="l.note" class="block text-[12px] text-ink-3 num">{{ l.note }}</span>
        </span>
        <b class="shrink-0 text-right text-[14px] font-semibold text-ink num">{{ l.value }}</b>
      </div>
    </div>
    <p v-else class="mt-2 text-[13px] leading-relaxed text-ink-3">
      В {{ monthIn(key, false) }} отметок пока нет.
    </p>

    <slot />

    <button
      type="button"
      class="mt-2 text-[12.5px] text-brand hover:underline cursor-pointer"
      @click="earlier = !earlier"
    >
      Итог {{ monthFrom(other, false) }}
    </button>
  </Card>
</template>
