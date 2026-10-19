<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn } from '@/lib/money'
import { MONTHS_PRE } from '@/lib/dates'
import { amountAt, amountIn, creditDueAmount, nextChange, payerOf } from '@/lib/finance'
import type { Credit, Obligation } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'

/**
 * Строка справочника «Платежи» в «Деньгах» (Р-91, Р-94; макет week-month.html «Деньги · Капитал»): кредит или
 * обязательство — название, «<день>-го», кружок плательщика и сумма; у валютного — сумма в валюте (Р-75), «≈ оценка»,
 * «сумма изменится», годовое — «раз в год · в <месяце>». Отметок месяца и «Оплатил» здесь нет: ✓ ставит выписка или
 * нажатие платежа в «Месяце». Нажатие — лист платежа (изменить).
 */
const props = defineProps<{
  item: { kind: 'credit'; credit: Credit } | { kind: 'obligation'; obligation: Obligation }
  /** Месяц, на который берётся сумма (версия суммы, курс). */
  period: string
  dense?: boolean
  /** Номер совета ИИ про этот платёж (`ai.markFor`, бэклог «Разбор», RZ-10) — ✦ после названия; нет — ничего. */
  mark?: number | null
}>()
const emit = defineEmits<{ (e: 'open'): void }>()

const financeStore = useFinanceStore()
const fx = useFxStore()

const target = computed(() => (props.item.kind === 'credit' ? props.item.credit : props.item.obligation))
const amount = computed(() => (props.item.kind === 'credit' ? creditDueAmount(props.item.credit) : amountAt(props.item.obligation, props.period, fx.book)))
const payer = computed(() => payerOf(target.value, financeStore.people.filter((p) => !p.deletedAt)))
const payerName = computed(() => financeStore.people.find((p) => p.id === payer.value)?.name ?? '')

const note = computed(() => {
  const it = props.item
  if (it.kind === 'credit') return [`${it.credit.day}-го`, it.credit.rateUnknown ? 'ставку уточните' : ''].filter(Boolean).join(' · ')
  const o = it.obligation
  const own = amountIn(o, props.period)
  const fxText = own.currency === 'KZT' ? '' : moneyIn(own.amount, own.currency)
  const when = o.every === 'year' ? `раз в год · в ${MONTHS_PRE[(o.month ?? 1) - 1]}` : `${o.day}-го`
  return [when, fxText, o.estimate ? '≈ оценка' : '', nextChange(o, props.period) ? 'сумма изменится' : ''].filter(Boolean).join(' · ')
})
</script>

<template>
  <!-- Вид строки `Row`; кнопка строки — название, растянутое на строку (`row-open`), ✦ совета ИИ — рядом своей кнопкой (RZ-10). -->
  <div class="border-b border-line last:border-b-0" data-payment>
    <div
      class="press relative flex w-full cursor-pointer items-center gap-3 text-left hover:bg-surface-2 active:bg-surface-3"
      :class="dense ? 'py-2.5' : 'px-4 py-3'"
      @click="emit('open')"
    >
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center">
          <button type="button" class="row-open min-w-0 truncate text-left text-[14.5px] font-medium text-ink">{{ target.name }}</button>
          <AdviceMark :n="mark ?? null" />
        </span>
        <span v-if="note" class="block text-[12.5px] text-ink-2">{{ note }}</span>
      </span>
      <span class="flex shrink-0 items-center gap-2">
        <Avatar v-if="payer" :id="payer" :name="payerName" :size="24" />
        <span class="block text-[14.5px] font-semibold num text-ink">{{ money(amount) }}</span>
      </span>
      <svg width="6" height="11" viewBox="0 0 8 14" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ml-0.5 shrink-0 text-ink-3">
        <path d="M1 1l5.5 6L1 13" />
      </svg>
    </div>
  </div>
</template>
