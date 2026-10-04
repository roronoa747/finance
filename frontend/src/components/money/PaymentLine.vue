<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn } from '@/lib/money'
import { MONTHS_PRE } from '@/lib/dates'
import { amountAt, amountIn, dueIn, nextChange } from '@/lib/finance'
import type { Credit, Obligation } from '@/types/finance'
import Row from '@/components/kit/Row.vue'
import PaidRow from '@/components/PaidRow.vue'

/**
 * Строка списка «Платежи» (пивот 3, Р-32): кредит или обязательство с «Оплатил» за месяц `period`
 * (`PaidRow`), мета — «<день>-го · <чьё>», сумма в валюте у валютного (Р-75: «Netflix · 15 $ · 7 700 ₸»), «≈ оценка», «сумма изменится». Годовое не в свой месяц —
 * без кнопки: «раз в год · в <месяце>». Ставка, доли платежа и переплата — только в листе кредита.
 */
const props = defineProps<{
  item: { kind: 'credit'; credit: Credit } | { kind: 'obligation'; obligation: Obligation }
  period: string
  dense?: boolean
}>()
const emit = defineEmits<{ (e: 'open'): void }>()

const financeStore = useFinanceStore()
const fx = useFxStore()

const target = computed(() => (props.item.kind === 'credit' ? props.item.credit : props.item.obligation))
const due = computed(() => props.item.kind === 'credit' || dueIn(props.item.obligation, props.period))

/** Годовое не в свой месяц — сумма за год (кредит списывается каждый месяц). */
const yearly = computed(() => (props.item.kind === 'obligation' ? amountAt(props.item.obligation, props.period, fx.book) : 0))

const note = computed(() => {
  const it = props.item
  if (it.kind === 'credit') return [`${it.credit.day}-го`, it.credit.rateUnknown ? 'ставку уточните' : ''].filter(Boolean).join(' · ')
  const o = it.obligation
  const owner = o.who ? financeStore.people.find((p) => p.id === o.who)?.name : null
  const own = amountIn(o, props.period)
  const fxText = own.currency === 'KZT' ? '' : moneyIn(own.amount, own.currency)
  if (!due.value) return [`раз в год · в ${MONTHS_PRE[(o.month ?? 1) - 1]}`, fxText].filter(Boolean).join(' · ')
  return [`${o.day}-го`, owner, fxText, o.estimate ? '≈ оценка' : '', nextChange(o, props.period) ? 'сумма изменится' : '']
    .filter(Boolean)
    .join(' · ')
})
</script>

<template>
  <PaidRow
    v-if="due"
    compact
    :dense="dense"
    :kind="item.kind"
    :target-id="target.id"
    :period="period"
    :title="target.name"
    :note="note"
    clickable
    @open="emit('open')"
  />
  <Row
    v-else
    :dense="dense"
    :title="target.name"
    :note="note"
    :value="money(yearly)"
    clickable
    @click="emit('open')"
  />
</template>
