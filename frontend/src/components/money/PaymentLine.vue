<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, moneyIn } from '@/lib/money'
import { MONTHS_PRE } from '@/lib/dates'
import { amountAt, amountIn, creditDueAmount, nextChange, payerOf } from '@/lib/finance'
import type { Credit, Obligation } from '@/types/finance'
import Avatar from '@/components/kit/Avatar.vue'
import Row from '@/components/kit/Row.vue'

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
  <Row :dense="dense" :title="target.name" :note="note" clickable data-payment @click="emit('open')">
    <template #value>
      <span class="flex items-center gap-2">
        <Avatar v-if="payer" :id="payer" :name="payerName" :size="24" />
        <span class="block text-[14.5px] font-semibold num text-ink">{{ money(amount) }}</span>
      </span>
    </template>
  </Row>
</template>
